import { describe, expect, it } from 'vitest';
import { newPart, type Part } from '../src/engine/model';
import { parseProject, projectFileName, serializeProject } from '../src/project/file';
import { arrangeParts } from '../src/project/layout';
import {
  addJob,
  addParts,
  commonRotations,
  endJob,
  jobNames,
  nextJobNumber,
  runningJobs,
  differsFromDefaults,
  newMachine,
  newProject,
  newSheet,
  resolvedParts,
  setPartDefault,
  setPartSetting,
  followDefaults,
  startBlockers,
  INPUT_TABS,
  unseenTabs,
} from '../src/project/model';
import {
  drawable,
  isStale,
  projectInput,
  projectRequest,
  sideBySide,
} from '../src/project/solution';
import { historyReducer, initialHistory } from '../src/ui/history';
import { nextRotation, parseAngles, rotationKind, rotationRule } from '../src/ui/rotations';
import { outline, polygonShape } from '../src/engine/geometry/contour';
import { worldParts } from '../src/engine/geometry/world';

const square = (size: number, quantity = 1): Part => ({
  ...newPart(
    polygonShape([
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ]),
  ),
  quantity,
});

describe('project document', () => {
  it('round-trips through a project file', () => {
    const project = addParts(newProject('Shop job'), [square(10, 3)]);
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it('keeps its jobs, numbered, each with the fields of its stage', () => {
    const project = addParts(newProject('Shop job'), [square(10, 3)]);
    const request = projectRequest(project);
    const names = jobNames(project);
    let withJobs = addJob(addJob(project, 'job_1', request, names), 'job_2', request, names);
    expect(withJobs.jobs.map((job) => [job.number, job.stage, job.id])).toEqual([
      [1, 'running', 'job_1'],
      [2, 'running', 'job_2'],
    ]);
    expect(withJobs.jobs[0].names).toEqual({ [project.parts[0].id]: 'Part' });
    const document = { ...request, schema_version: 1, state: { status: 'cancelled' as const } };
    withJobs = endJob(endJob(withJobs, 'job_1', document as never), 'job_2');
    expect(withJobs.jobs.map((job) => job.stage)).toEqual(['ended', 'lost']);
    expect(withJobs.jobs[0]).toMatchObject({ number: 1, id: 'job_1', document });
    expect(withJobs.jobs[0]).not.toHaveProperty('request');
    // A job that is no longer running stays as it ended.
    expect(endJob(withJobs, 'job_1')).toBe(withJobs);
    expect(runningJobs(withJobs)).toEqual([]);
    expect(nextJobNumber(withJobs)).toBe(3);
    expect(parseProject(JSON.parse(serializeProject(withJobs)))).toEqual(withJobs);
    const [first, second] = withJobs.jobs;
    expect(() => parseProject({ ...withJobs, jobs: [first, { ...second, number: 1 }] })).toThrow(
      'same number',
    );
    expect(() => parseProject({ ...withJobs, jobs: [{ ...second, stage: 'ended' }] })).toThrow(
      'invalid jobs',
    );
    expect(() => parseProject({ ...withJobs, jobs: [{ ...first, number: 0 }] })).toThrow(
      'invalid jobs',
    );
    // A job that ended has a document that says so, with an input and outcome studio can draw.
    const ended = (change: object) => ({ ...withJobs, jobs: [{ ...first, ...change }] });
    expect(() =>
      parseProject(ended({ document: { ...document, state: { status: 'running' } } })),
    ).toThrow('invalid jobs');
    expect(() => parseProject(ended({ document: { ...document, input: {} } }))).toThrow(
      'invalid jobs',
    );
    const outcome = {
      solution: { layouts: [{ sheet_id: 'strip', placements: [] }] },
      stats: { consumed_area: 1, placed_area: 1, density: 1, layouts: [] },
      unplaced: [],
      diagnostics: [],
    };
    const completed = { ...document, outcome };
    expect(parseProject(ended({ document: completed })).jobs[0]).toMatchObject({
      document: completed,
    });
    const stray = { part_id: 'gone', transformation: { rotation: 0, translation: [0, 0] } };
    const layouts = [{ sheet_id: 'strip', placements: [stray] }];
    expect(() =>
      parseProject(
        ended({ document: { ...completed, outcome: { ...outcome, solution: { layouts } } } }),
      ),
    ).toThrow('invalid jobs');
  });

  it('rejects other formats and versions', () => {
    const project = newProject('Shop job');
    expect(() => parseProject({ ...project, format: 'other' })).toThrow('unknown format');
    expect(() => parseProject({ ...project, version: 7 })).toThrow('version 7');
  });

  it('upgrades version 2, whose parts store polygons as outer and holes', () => {
    const project = addParts(newProject('Shop job'), [square(10)]);
    const { shape, ...part } = project.parts[0];
    const old = {
      ...project,
      version: 2,
      parts: [{ ...part, outer: outline(shape).outer, holes: [] }],
    };
    expect(parseProject(old)).toEqual(project);
  });

  it('upgrades version 3, whose parts neither reflect nor nest inside holes', () => {
    const project = addParts(newProject('Shop job'), [square(10)]);
    const { rotations } = project.partDefaults;
    const upgraded = parseProject({ ...project, version: 3, partDefaults: { rotations } });
    expect(upgraded.partDefaults).toEqual({ rotations, reflection: false, nestInHoles: false });
    expect(projectInput(upgraded).parts[0].hole_mode).toBe('solid');
    expect(() =>
      parseProject({ ...project, parts: [{ ...project.parts[0], reflection: 'yes' }] }),
    ).toThrow('part settings');
  });

  it('upgrades version 5, whose latest solution becomes job #1', () => {
    const project = addParts(newProject('Shop job'), [square(10)]);
    const { jobs: _, ...rest } = project;
    const document = {
      ...projectRequest(project),
      schema_version: 1,
      state: { status: 'cancelled' },
    };
    const old = {
      ...rest,
      version: 5,
      solutions: [{ id: 's', createdAt: 'then', document }],
      runningJobId: 'job_7',
    };
    expect(parseProject(old)).toEqual({
      ...project,
      jobs: [
        {
          number: 1,
          submittedAt: 'then',
          names: { [project.parts[0].id]: 'Part' },
          stage: 'ended',
          document,
        },
      ],
    });
    expect(parseProject({ ...old, solutions: [] }).jobs).toEqual([]);
  });

  it('upgrades version 1, keeping its time limit and dropping its solutions', () => {
    const project = newProject('Shop job');
    const old = {
      ...project,
      version: 1,
      settings: { solveWith: 'local', timeLimitSeconds: 30, preset: 'fast', threads: 2 },
      solutions: [{ job: {}, result: {} }],
    };
    expect(parseProject(old)).toEqual({
      ...project,
      settings: { timeLimitSeconds: 30, autoTermination: true },
    });
    const unlimited = { ...old, settings: { ...old.settings, timeLimitSeconds: null } };
    expect(parseProject(unlimited).settings.timeLimitSeconds).toBe(600);
  });

  it('builds the job request from the strip, the active machine and the settings', () => {
    const machine = newMachine('Laser', 0.5);
    const project = addParts(newProject('Job', machine), [square(10, 2), square(20, 0)]);
    const { input, settings } = projectRequest(project);
    expect(input.problem).toEqual({ type: 'minimize_strip_length', height: 1000 });
    expect(input.minimum_separation_distance).toEqual({ parts: 0.5, boundary: 0.5 });
    // A part without copies is left out; the format counts copies from one.
    expect(input.parts).toEqual([
      {
        id: project.parts[0].id,
        geometry_id: project.parts[0].id,
        quantity: 2,
        orientation: { rotation: { type: 'discrete', angles: [0, 180] } },
        hole_mode: 'nestable',
      },
    ]);
    expect(input.geometries.map((geometry) => geometry.id)).toEqual([project.parts[0].id]);
    // No seed: the backend picks one per job, while studio is developed.
    expect(settings).toEqual({ time_limit_seconds: 120, auto_termination: true });
    expect(project.machines[0].id).not.toBe(machine.id);
  });

  it('treats renamed projects and parts as the same job, and a quantity change as a new one', () => {
    const project = addParts(newProject('Job'), [square(10)]);
    const document = { input: projectInput(project) } as Parameters<typeof isStale>[1];
    expect(isStale({ ...project, name: 'Renamed' }, document)).toBe(false);
    expect(
      isStale({ ...project, parts: [{ ...project.parts[0], name: 'Bracket' }] }, document),
    ).toBe(false);
    expect(isStale({ ...project, parts: [{ ...project.parts[0], quantity: 2 }] }, document)).toBe(
      true,
    );
  });

  it('draws a layout in the format as copies of the project parts', () => {
    const project = addParts(newProject('Job'), [{ ...square(10, 2), name: 'Plate' }]);
    const input = projectInput(project);
    const id = project.parts[0].id;
    const at = (x: number) => ({
      part_id: id,
      transformation: { reflection: 'none' as const, rotation: 90, translation: [x, 0] },
    });
    const { job, layouts } = drawable(
      input,
      { layouts: [{ sheet_id: 'strip', placements: [at(10), at(30)] }] },
      new Map([[id, 'Plate']]),
    );
    const { result } = layouts[0];
    expect(job.parts.map((part) => part.name)).toEqual(['Plate']);
    expect(result.placements.map((p) => [p.copyIndex, p.xMm, p.angleDeg])).toEqual([
      [0, 10, 90],
      [1, 30, 90],
    ]);
    // Turned a quarter, the second copy reaches from x = 20 to 30.
    expect(result.usedLengthMm).toBeCloseTo(30);
  });

  it('draws mirrored copies mirrored across their own x-axis before turning them', () => {
    const triangle = newPart(
      polygonShape([
        [0, 0],
        [10, 0],
        [0, 5],
      ]),
    );
    const project = addParts(newProject('Job'), [triangle]);
    const id = project.parts[0].id;
    const mirrored = {
      part_id: id,
      transformation: { reflection: 'x_axis' as const, rotation: 90, translation: [0, 0] },
    };
    const { job, layouts } = drawable(projectInput(project), {
      layouts: [{ sheet_id: 'strip', placements: [mirrored] }],
    });
    const { result } = layouts[0];
    expect(result.placements[0].mirrored).toBe(true);
    // (0, 5) mirrors to (0, −5), which a quarter turn takes to (5, 0).
    const [placed] = worldParts(job, result);
    expect(placed.outer[2][0]).toBeCloseTo(5);
    expect(placed.outer[2][1]).toBeCloseTo(0);
    expect(outline(placed.shape).outer[2][0]).toBeCloseTo(5);
  });

  it('nests into the sheets with copies in stock, in the order of the list', () => {
    const first = { ...newSheet('Remnant', 500, 300), quantity: 1 };
    const none = { ...newSheet('Used up', 100, 100), quantity: 0 };
    const plate = { ...newSheet('Plate', 3000, 1500), quantity: 4 };
    let project = addParts(newProject('Job'), [square(10)]);
    project = { ...project, stock: { ...project.stock, sheets: [first, none, plate] } };
    // A project keeps its sheets while it nests into the strip.
    expect(projectInput(project).problem.type).toBe('minimize_strip_length');
    project = { ...project, stock: { ...project.stock, packing: 'sheets' } };
    const input = projectInput(project);
    expect(input.problem).toEqual({
      type: 'minimize_sheets_in_order',
      sheets: [
        { id: first.id, geometry_id: first.id, quantity: 1 },
        { id: plate.id, geometry_id: plate.id, quantity: 4 },
      ],
    });
    expect(input.geometries.map((geometry) => geometry.id)).toEqual([
      project.parts[0].id,
      first.id,
      plate.id,
    ]);
    expect(startBlockers(project)).toEqual([]);
    expect(startBlockers({ ...project, stock: { ...project.stock, sheets: [none] } })).toEqual([
      'Add a sheet in the Sheets tab.',
    ]);
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it('draws each layout on its sheet, numbering copies across sheets', () => {
    const remnant = newSheet('Remnant', 15, 15);
    const plate = { ...newSheet('Plate', 100, 50), quantity: 2 };
    let project = addParts(newProject('Job'), [square(10, 3)]);
    project = {
      ...project,
      stock: { packing: 'sheets', strip: project.stock.strip, sheets: [remnant, plate] },
    };
    const id = project.parts[0].id;
    const at = (x: number) => ({
      part_id: id,
      transformation: { reflection: 'none' as const, rotation: 0, translation: [x, 0] },
    });
    const layout = (
      sheet_id: string,
      placements: ReturnType<typeof at>[],
      cut_x: number | null,
    ) => ({
      layout: { sheet_id, placements },
      stats: { cut_x, consumed_area: 1, placed_area: 1, density: 1 },
    });
    const all = [layout(remnant.id, [at(0)], null), layout(plate.id, [at(0), at(20)], 30)];
    const { layouts } = drawable(
      projectInput(project),
      { layouts: all.map((l) => l.layout) },
      new Map([[plate.id, 'Plate']]),
      { consumed_area: 2, placed_area: 2, density: 1, layouts: all.map((l) => l.stats) },
    );
    expect(layouts.map((l) => [l.name, l.sheet?.cutX, l.result.usedLengthMm])).toEqual([
      [remnant.id, null, 15],
      ['Plate', 30, 30],
    ]);
    expect(layouts.flatMap((l) => l.result.placements.map((p) => p.copyIndex))).toEqual([0, 1, 2]);
  });

  it('sends the defects of a sheet entry with it, and keeps them in project files', () => {
    const flaw = { type: 'rectangle' as const, x_min: 10, y_min: 10, width: 20, height: 5 };
    const plate = { ...newSheet('Plate', 100, 50), defects: [flaw] };
    const bare = newSheet('Bare', 100, 50);
    let project = addParts(newProject('Job'), [square(10)]);
    project = {
      ...project,
      stock: { packing: 'sheets', strip: project.stock.strip, sheets: [plate, bare] },
    };
    const problem = projectInput(project).problem;
    expect(
      problem.type === 'minimize_sheets_in_order' && problem.sheets.map((s) => s.defects),
    ).toEqual([[flaw], undefined]);
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
    const crossing = [
      [0, 0],
      [100, 100],
      [0, 100],
      [100, 0],
    ];
    const crossed = { ...plate, defects: [{ type: 'polygon', points: crossing }] };
    expect(() =>
      parseProject({ ...project, stock: { ...project.stock, sheets: [crossed] } }),
    ).toThrow('invalid sheet');
    const broken = { ...plate, defects: [{ type: 'polygon', points: [[0, 0]] }] };
    expect(() =>
      parseProject({ ...project, stock: { ...project.stock, sheets: [broken] } }),
    ).toThrow('invalid sheet');
  });

  it('refuses sheets it cannot draw', () => {
    const project = newProject('Shop job');
    const sheet = {
      ...newSheet('Bad', 1, 1),
      shape: { outer: { type: 'polygon', points: [0, 1, 2] } },
    };
    expect(() =>
      parseProject({ ...project, stock: { ...project.stock, sheets: [sheet] } }),
    ).toThrow('invalid sheet');
  });

  it('puts every sheet of a solution side by side for downloads, parts and cuts with them', () => {
    const plate = { ...newSheet('Plate', 100, 50), quantity: 2 };
    let project = addParts(newProject('Job'), [square(10, 2)]);
    project = {
      ...project,
      stock: { packing: 'sheets', strip: project.stock.strip, sheets: [plate] },
    };
    const id = project.parts[0].id;
    const at = (x: number) => ({
      part_id: id,
      transformation: { reflection: 'none' as const, rotation: 0, translation: [x, 0] },
    });
    const stats = (cut_x: number | null) => ({
      cut_x,
      consumed_area: 1,
      placed_area: 1,
      density: 1,
    });
    const { layouts } = drawable(
      projectInput(project),
      {
        layouts: [
          { sheet_id: plate.id, placements: [at(0)] },
          { sheet_id: plate.id, placements: [at(0)] },
        ],
      },
      new Map(),
      { consumed_area: 2, placed_area: 2, density: 1, layouts: [stats(null), stats(20)] },
    );
    const { result, sheets } = sideBySide(layouts);
    // The second plate starts a tenth of the plates' height past the first.
    expect(result.placements.map((p) => p.xMm)).toEqual([0, 105]);
    expect(sheets?.map((sheet) => sheet.cutX)).toEqual([null, 125]);
    expect(result.usedLengthMm).toBe(205);
  });

  it('upgrades version 4, which had no sheets', () => {
    const project = newProject('Shop job');
    const { sheets, ...stock } = project.stock;
    expect(sheets).toEqual([]);
    expect(parseProject({ ...project, version: 4, stock })).toEqual(project);
  });

  it('asks for each input tab before the first run of a new project, and only then', () => {
    const project = addParts(newProject('Job'), [square(10)]);
    expect(unseenTabs(project)).toEqual([...INPUT_TABS]);
    expect(unseenTabs({ ...project, seenTabs: ['parts', 'machine', 'settings'] })).toEqual([
      'sheets',
    ]);
    expect(unseenTabs({ ...project, seenTabs: [...INPUT_TABS] })).toEqual([]);
    // Once it has a job, or for a project from before the rule, no tab is asked for.
    expect(unseenTabs(addJob(project, 'job_1', projectRequest(project), {}))).toEqual([]);
    const { seenTabs: _, ...older } = project;
    expect(unseenTabs(older)).toEqual([]);
  });

  it('explains why a job cannot start', () => {
    const empty = newProject('Job');
    expect(startBlockers(empty)).toEqual(['Import parts to nest.']);
    const seen = empty;
    const zero = { ...seen, parts: [square(10, 0)] };
    expect(startBlockers(zero)[0]).toMatch('quantity above zero');
    expect(startBlockers({ ...seen, parts: [square(10)] })).toEqual([]);
    // How many copies a job may have is the backend's to say.
    expect(startBlockers({ ...seen, parts: [square(10, 4000)] })).toEqual([]);
  });

  it('keeps parts the gap away from the material edge, unless the machine has its own distance', () => {
    const machine = newMachine('Laser', 2);
    const project = addParts(newProject('Job', machine), [square(10)]);
    expect(projectInput(project).minimum_separation_distance).toEqual({ parts: 2, boundary: 2 });
    const own = { ...project, machines: [{ ...project.machines[0], boundaryMm: 5 }] };
    expect(projectInput(own).minimum_separation_distance).toEqual({ parts: 2, boundary: 5 });
    expect(parseProject(JSON.parse(serializeProject(own))).machines[0].boundaryMm).toBe(5);
    const negative = { ...project, machines: [{ ...project.machines[0], boundaryMm: -1 }] };
    expect(startBlockers(negative)[0]).toMatch('material edge');
    expect(() =>
      parseProject({ ...project, machines: [{ ...project.machines[0], boundaryMm: 'far' }] }),
    ).toThrow('machine preset');
  });

  it('makes safe file names', () => {
    expect(projectFileName('a/b: c.', 'svg')).toBe('a-b- c.svg');
    expect(projectFileName('   ', 'svg')).toBe('project.svg');
  });
});

describe('parts canvas arrangement', () => {
  it('places every part type once, without overlaps', () => {
    const parts = [square(30), square(10), square(20), square(5), square(25)];
    const { boxes, extent } = arrangeParts(parts);
    expect(boxes.size).toBe(parts.length);
    const all = [...boxes.values()];
    for (let i = 0; i < all.length; i++)
      for (let j = 0; j < i; j++) {
        const [a, b] = [all[i], all[j]];
        const apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
        expect(apart).toBe(true);
      }
    for (const box of all) {
      expect(box[0]).toBeGreaterThanOrEqual(extent[0]);
      expect(box[1]).toBeGreaterThanOrEqual(extent[1]);
      expect(box[2]).toBeLessThanOrEqual(extent[2]);
      expect(box[3]).toBeLessThanOrEqual(extent[3]);
    }
  });

  it('lines the names of a row up on its bottom, below all of its parts', () => {
    const parts = [square(30), square(10), square(20)];
    const { boxes, rowBottoms } = arrangeParts(parts);
    // Small enough to share one row.
    const bottoms = new Set(parts.map((part) => rowBottoms.get(part.id)));
    expect(bottoms.size).toBe(1);
    const [bottom] = bottoms;
    for (const box of boxes.values()) expect(box[1]).toBeGreaterThanOrEqual(bottom!);
  });
});

describe('rotations', () => {
  it('names the common rules and parses custom angles', () => {
    expect(rotationKind(rotationRule('half'))).toBe('half');
    expect(rotationKind({ kind: 'discrete', degrees: [270, 0, 90, 180, 360] })).toBe('quarter');
    expect(rotationKind({ kind: 'discrete', degrees: [0, 45] })).toBe('custom');
    expect(parseAngles('0, 45 , 405')).toEqual({ kind: 'discrete', degrees: [0, 45] });
    expect(parseAngles('a')).toBeUndefined();
  });
});

describe('cycling rotations', () => {
  it('goes from the defaults through every named rule and back', () => {
    const seen: string[] = [];
    let own = undefined as ReturnType<typeof rotationRule> | undefined;
    for (let i = 0; i < 5; i++) {
      const next = nextRotation(own);
      seen.push(next === 'default' ? 'default' : rotationKind(next));
      own = next === 'default' ? undefined : next;
    }
    expect(seen).toEqual(['fixed', 'half', 'quarter', 'free', 'default']);
    expect(nextRotation({ kind: 'discrete', degrees: [0, 45] })).toBe('default');
  });
});

describe('undo history', () => {
  it('coalesces edits with the same key and keeps jobs through undo', () => {
    const start = newProject('Job');
    let state = initialHistory(start);
    const named = (name: string) => ({ ...state.present, name });
    state = historyReducer(state, { type: 'edit', project: named('A'), key: 'name', at: 1000 });
    state = historyReducer(state, { type: 'edit', project: named('AB'), key: 'name', at: 1500 });
    expect(state.past).toHaveLength(1);
    const request = projectRequest(start);
    state = historyReducer(state, {
      type: 'results',
      change: (present) => ({ jobs: addJob(present, 'job_1', request, {}).jobs }),
    });
    const { jobs } = state.present;
    // An edit made from the project before the job arrived keeps it.
    state = historyReducer(state, { type: 'edit', project: start, at: 9000 });
    expect(state.present.jobs).toBe(jobs);
    state = historyReducer(state, { type: 'undo' });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present.name).toBe('Job');
    expect(state.present.jobs).toBe(jobs);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present.name).toBe('AB');
  });
});

describe('part defaults', () => {
  const half = { kind: 'discrete' as const, degrees: [0, 180] };
  const free = { kind: 'continuous' as const };
  const rules = (project: ReturnType<typeof newProject>) =>
    resolvedParts(project).map((part) => part.rotations);

  it('makes added parts follow the defaults, whatever rule they came with', () => {
    let project = addParts(newProject('Job'), [square(10), { ...square(20), rotations: free }]);
    expect(project.parts.map(differsFromDefaults)).toEqual([false, false]);
    expect(project.parts.map((part) => part.rotations)).toEqual([undefined, undefined]);
    project = setPartDefault(project, 'rotations', { kind: 'discrete', degrees: [0] });
    expect(projectInput(project).parts.map((part) => part.orientation.rotation)).toEqual([
      { type: 'discrete', angles: [0] },
      { type: 'discrete', angles: [0] },
    ]);
  });

  it('can give a part its own rule and take it back', () => {
    let project = addParts(newProject('Job'), [square(10)]);
    const id = project.parts[0].id;
    project = setPartSetting(project, [id], 'rotations', free);
    expect(differsFromDefaults(project.parts[0])).toBe(true);
    project = setPartSetting(project, [id], 'rotations', 'default');
    expect(differsFromDefaults(project.parts[0])).toBe(false);
    expect(rules(project)).toEqual([half]);
  });

  it('round-trips parts that follow the defaults through a project file', () => {
    const project = addParts(newProject('Job'), [square(10), { ...square(20), rotations: free }]);
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it('sends reflection and nesting inside holes as each part has them', () => {
    let project = addParts(newProject('Job'), [square(10), square(20)]);
    const [a, b] = project.parts.map((part) => part.id);
    // A new project nests inside holes, and does not reflect.
    expect(projectInput(project).parts.map((part) => [part.orientation, part.hole_mode])).toEqual([
      [{ rotation: { type: 'discrete', angles: [0, 180] } }, 'nestable'],
      [{ rotation: { type: 'discrete', angles: [0, 180] } }, 'nestable'],
    ]);
    project = setPartDefault(project, 'reflection', true);
    project = setPartSetting(project, [b], 'nestInHoles', false);
    const parts = projectInput(project).parts;
    expect(parts.map((part) => part.orientation.reflection)).toEqual([
      ['none', 'x_axis'],
      ['none', 'x_axis'],
    ]);
    expect(parts.map((part) => part.hole_mode)).toEqual(['nestable', 'solid']);
    expect(project.parts.map(differsFromDefaults)).toEqual([false, true]);
    project = followDefaults(project, [a, b]);
    expect(project.parts.map(differsFromDefaults)).toEqual([false, false]);
  });

  it("makes parts taken from another project follow this project's defaults", () => {
    const source = setPartDefault(
      addParts(newProject('Source'), [square(10), square(20)]),
      'reflection',
      true,
    );
    const project = addParts(newProject('Job'), resolvedParts(source));
    expect(project.parts.map(differsFromDefaults)).toEqual([false, false]);
    expect(resolvedParts(project).map((part) => part.reflection)).toEqual([false, false]);
  });

  it('takes the most common rule as the defaults of a set of parts', () => {
    const parts = [square(1), { ...square(2), rotations: free }, { ...square(3), rotations: free }];
    expect(commonRotations(parts, half)).toEqual(free);
  });
});
