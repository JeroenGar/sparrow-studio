import { describe, expect, it } from 'vitest';
import { newPart, type Part } from '../src/engine/model';
import { parseProject, projectFileName, serializeProject } from '../src/project/file';
import { arrangeParts } from '../src/project/layout';
import { jobKey, newMachine, newProject, projectJob, startBlockers } from '../src/project/model';
import { historyReducer, initialHistory } from '../src/ui/history';
import { parseAngles, rotationKind, rotationRule } from '../src/ui/rotations';

const square = (size: number, quantity = 1): Part => ({
  ...newPart([
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ]),
  quantity,
});

describe('project document', () => {
  it('round-trips through a project file', () => {
    const project = { ...newProject('Shop job'), parts: [square(10, 3)] };
    expect(parseProject(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it('rejects other formats and versions', () => {
    const project = newProject('Shop job');
    expect(() => parseProject({ ...project, format: 'other' })).toThrow('unknown format');
    expect(() => parseProject({ ...project, version: 2 })).toThrow('version 2');
  });

  it('builds the solver job from the strip, the active machine and the settings', () => {
    const machine = newMachine('Laser', 0.5);
    const project = { ...newProject('Job', machine), parts: [square(10)] };
    const job = projectJob(project);
    expect(job.settings.materialWidthMm).toBe(1000);
    expect(job.settings.clearanceMm).toBe(0.5);
    expect(project.machines[0].id).not.toBe(machine.id);
  });

  it('treats a renamed project as the same job, and a quantity change as a new one', () => {
    const project = { ...newProject('Job'), parts: [square(10)] };
    const key = jobKey(projectJob(project));
    expect(jobKey(projectJob({ ...project, name: 'Renamed' }))).toBe(key);
    expect(
      jobKey(projectJob({ ...project, parts: [{ ...project.parts[0], quantity: 2 }] })),
    ).not.toBe(key);
  });

  it('explains why a job cannot start', () => {
    const empty = newProject('Job');
    expect(startBlockers(empty)).toEqual(['Import parts to nest.']);
    const zero = { ...empty, parts: [square(10, 0)] };
    expect(startBlockers(zero)[0]).toMatch('quantity above zero');
    const wide = {
      ...empty,
      parts: [square(10)],
      machines: [{ ...empty.machines[0], gapMm: 2000 }],
    };
    expect(startBlockers(wide)).toEqual(['The gap must be smaller than the strip width.']);
    expect(startBlockers({ ...empty, parts: [square(10)] })).toEqual([]);
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
    const solution = {
      id: 's',
      createdAt: '',
      job: projectJob(start),
      result: {} as never,
      stopReason: 'Complete' as const,
    };
    state = historyReducer(state, { type: 'solutions', solutions: [solution] });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present.name).toBe('Job');
    expect(state.present.solutions).toEqual([solution]);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present.name).toBe('AB');
  });
});
