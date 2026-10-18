import { describe, expect, it } from 'vitest';
import { newPart, type Part } from '../src/engine/model';
import { parseProject, projectFileName, serializeProject } from '../src/project/file';
import { arrangeParts } from '../src/project/layout';
import {
  addParts,
  commonRotations,
  differsFromDefaults,
  newMachine,
  newProject,
  resolvedParts,
  setDefaultRotations,
  setPartRotations,
  startBlockers,
  INPUT_TABS,
  unseenTabs,
} from '../src/project/model';
import { drawable, isStale, projectInput, projectRequest } from '../src/project/solution';
import { historyReducer, initialHistory } from '../src/ui/history';
import { parseAngles, rotationKind, rotationRule } from '../src/ui/rotations';
import { outline, polygonShape } from '../src/engine/geometry/contour';

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

  it('keeps the job running for the project', () => {
    const project = { ...newProject('Shop job'), runningJobId: 'job_7' };
    expect(parseProject(JSON.parse(serializeProject(project))).runningJobId).toBe('job_7');
    expect(() => parseProject({ ...project, runningJobId: 7 })).toThrow('running job');
  });

  it('rejects other formats and versions', () => {
    const project = newProject('Shop job');
    expect(() => parseProject({ ...project, format: 'other' })).toThrow('unknown format');
    expect(() => parseProject({ ...project, version: 4 })).toThrow('version 4');
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
      solutions: [],
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
        hole_mode: 'solid',
      },
    ]);
    expect(input.geometries.map((geometry) => geometry.id)).toEqual([project.parts[0].id]);
    expect(settings).toEqual({ time_limit_seconds: 120, auto_termination: true, seed: 0 });
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
    const { job, result } = drawable(
      input,
      { layouts: [{ sheet_id: 'strip', placements: [at(10), at(30)] }] },
      new Map([[id, 'Plate']]),
    );
    expect(job.parts.map((part) => part.name)).toEqual(['Plate']);
    expect(result.placements.map((p) => [p.copyIndex, p.xMm, p.angleDeg])).toEqual([
      [0, 10, 90],
      [1, 30, 90],
    ]);
    // Turned a quarter, the second copy reaches from x = 20 to 30.
    expect(result.usedLengthMm).toBeCloseTo(30);
  });

  it('asks for each input tab before the first run of a new project, and only then', () => {
    const project = addParts(newProject('Job'), [square(10)]);
    expect(unseenTabs(project)).toEqual([...INPUT_TABS]);
    expect(unseenTabs({ ...project, seenTabs: ['parts', 'machine', 'settings'] })).toEqual([
      'sheets',
    ]);
    expect(unseenTabs({ ...project, seenTabs: [...INPUT_TABS] })).toEqual([]);
    // Once it has a solution, or for a project from before the rule, no tab is asked for.
    expect(
      unseenTabs({ ...project, solutions: [{ id: 's', createdAt: '', document: {} as never }] }),
    ).toEqual([]);
    const { seenTabs: _, ...older } = project;
    expect(unseenTabs(older)).toEqual([]);
  });

  it('explains why a job cannot start', () => {
    const empty = newProject('Job');
    expect(startBlockers(empty)).toEqual(['Import parts to nest.']);
    const seen = empty;
    const zero = { ...seen, parts: [square(10, 0)] };
    expect(startBlockers(zero)[0]).toMatch('quantity above zero');
    const wide = {
      ...seen,
      parts: [square(10)],
      machines: [{ ...seen.machines[0], gapMm: 2000 }],
    };
    expect(startBlockers(wide)).toEqual(['The gap must be smaller than the strip width.']);
    expect(startBlockers({ ...seen, parts: [square(10)] })).toEqual([]);
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

describe('undo history', () => {
  it('coalesces edits with the same key and keeps solutions through undo', () => {
    const start = newProject('Job');
    let state = initialHistory(start);
    const named = (name: string) => ({ ...state.present, name });
    state = historyReducer(state, { type: 'edit', project: named('A'), key: 'name', at: 1000 });
    state = historyReducer(state, { type: 'edit', project: named('AB'), key: 'name', at: 1500 });
    expect(state.past).toHaveLength(1);
    const solution = { id: 's', createdAt: '', document: {} as never };
    state = historyReducer(state, {
      type: 'results',
      results: { solutions: [solution], runningJobId: 'job_1' },
    });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present.name).toBe('Job');
    expect(state.present.solutions).toEqual([solution]);
    // The job running for the project is no edit either.
    expect(state.present.runningJobId).toBe('job_1');
    state = historyReducer(state, { type: 'redo' });
    expect(state.present.name).toBe('AB');
  });
});

describe('part defaults', () => {
  const half = { kind: 'discrete' as const, degrees: [0, 180] };
  const free = { kind: 'continuous' as const };
  const rules = (project: ReturnType<typeof newProject>) =>
    resolvedParts(project).map((part) => part.rotations);

  it('stores a rule only on parts that have their own', () => {
    let project = addParts(newProject('Job'), [square(10), { ...square(20), rotations: free }]);
    expect(project.parts.map(differsFromDefaults)).toEqual([false, true]);
    expect(project.parts[0].rotations).toBeUndefined();
    project = setDefaultRotations(project, { kind: 'discrete', degrees: [0] });
    expect(rules(project)).toEqual([{ kind: 'discrete', degrees: [0] }, free]);
    expect(projectInput(project).parts.map((part) => part.orientation.rotation)).toEqual([
      { type: 'discrete', angles: [0] },
      { type: 'continuous' },
    ]);
  });

  it('can give a part its own rule and take it back', () => {
    let project = addParts(newProject('Job'), [square(10)]);
    const id = project.parts[0].id;
    project = setPartRotations(project, [id], free);
    expect(differsFromDefaults(project.parts[0])).toBe(true);
    project = setPartRotations(project, [id], 'default');
    expect(differsFromDefaults(project.parts[0])).toBe(false);
    expect(rules(project)).toEqual([half]);
  });

  it('round-trips parts that follow the defaults through a project file', () => {
    const project = addParts(newProject('Job'), [square(10), { ...square(20), rotations: free }]);
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it('takes the most common rule as the defaults of a set of parts', () => {
    const parts = [square(1), { ...square(2), rotations: free }, { ...square(3), rotations: free }];
    expect(commonRotations(parts, half)).toEqual(free);
  });
});
