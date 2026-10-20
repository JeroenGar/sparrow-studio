import { describe, expect, it } from 'vitest';
import { newProjectName } from '../src/project/names';

describe('project names', () => {
  it('names a new project after the day, with two words picked at random', () => {
    expect(newProjectName(new Date(2026, 9, 21), () => 0)).toBe('2026-10-21 amber acorn');
    expect(newProjectName(new Date(2026, 0, 5), () => 0.999)).toBe('2026-01-05 young wren');
  });
});
