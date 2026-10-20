import type { Input } from '../api/client';
import type { DisplayUnit } from '../engine/units';
import { formatLength } from './format';

const SHOWN = 3;

/**
 * What changed between a job's input and the project's input now, in a few short sentences:
 * parts and sheets added, removed or changed, and the material and distances. `names` names the
 * parts and sheets, by ID.
 */
export function describeChanges(
  before: Input,
  now: Input,
  names: (id: string) => string,
  unit: DisplayUnit,
): string[] {
  const changes: string[] = [];
  const length = (mm: number) => `${formatLength(mm, unit, 3)} ${unit}`;
  const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  const geometry = (input: Input) =>
    new Map(input.geometries.map((g) => [g.id, JSON.stringify(g.shape)]));
  const shapes = { before: geometry(before), now: geometry(now) };

  /** The items added, removed and changed, by ID, with how many there are of each. */
  function compare<T extends { id: string; geometry_id: string; quantity?: number }>(
    old: T[],
    current: T[],
    kind: [string, string],
  ) {
    const was = new Map(old.map((item) => [item.id, item]));
    const is = new Map(current.map((item) => [item.id, item]));
    const added = current.filter((item) => !was.has(item.id));
    const removed = old.filter((item) => !is.has(item.id));
    const count = (n: number, verb: string, items: T[]) =>
      n === 1 ? `${names(items[0].id)} ${verb}` : `${n} ${kind[1]} ${verb}`;
    if (added.length) changes.push(count(added.length, 'added', added));
    if (removed.length) changes.push(count(removed.length, 'removed', removed));
    for (const item of current) {
      const previous = was.get(item.id);
      if (!previous) continue;
      const quantity = { was: previous.quantity ?? 1, is: item.quantity ?? 1 };
      if (quantity.was !== quantity.is)
        changes.push(`${names(item.id)}: ${copies(quantity.was)}, now ${quantity.is}`);
      const { quantity: _q, ...rest } = item;
      const { quantity: _p, ...previousRest } = previous;
      if (
        shapes.before.get(previous.geometry_id) !== shapes.now.get(item.geometry_id) ||
        JSON.stringify({ ...rest, geometry_id: '' }) !==
          JSON.stringify({ ...previousRest, geometry_id: '' })
      )
        changes.push(`${names(item.id)} changed`);
    }
  }

  compare(before.parts, now.parts, ['part', 'parts']);
  const problem = { before: before.problem, now: now.problem };
  if (
    problem.before.type === 'minimize_strip_length' &&
    problem.now.type === 'minimize_strip_length'
  ) {
    if (problem.before.height !== problem.now.height)
      changes.push(
        `Strip ${length(problem.before.height)} wide, now ${length(problem.now.height)}`,
      );
  } else if (
    problem.before.type === 'minimize_sheets_in_order' &&
    problem.now.type === 'minimize_sheets_in_order'
  ) {
    compare(problem.before.sheets, problem.now.sheets, ['sheet', 'sheets']);
    // The sheets both have, in each one's order.
    const kept = (from: { id: string }[], other: { id: string }[]) =>
      from
        .map((sheet) => sheet.id)
        .filter((id) => other.some((sheet) => sheet.id === id))
        .join();
    if (
      kept(problem.before.sheets, problem.now.sheets) !==
      kept(problem.now.sheets, problem.before.sheets)
    )
      changes.push('The sheets are in another order');
  } else
    changes.push(
      problem.now.type === 'minimize_sheets_in_order'
        ? 'Nests into sheets now, not a strip'
        : 'Nests into a strip now, not sheets',
    );
  const gap = {
    before: before.minimum_separation_distance,
    now: now.minimum_separation_distance,
  };
  if (gap.before.parts !== gap.now.parts)
    changes.push(`Gap ${length(gap.before.parts)}, now ${length(gap.now.parts)}`);
  if (gap.before.boundary !== gap.now.boundary)
    changes.push(
      `Distance to the edge ${length(gap.before.boundary)}, now ${length(gap.now.boundary)}`,
    );
  if (changes.length > SHOWN + 1)
    return [...changes.slice(0, SHOWN), `and ${changes.length - SHOWN} more changes`];
  return changes;
}
