import { ApiError, withCode, withKind, type Schemas } from '../api/client';
import { usesSparrowPro } from './client';
import type { DisplayUnit } from '../engine/units';
import { formatLength, formatSeconds } from './format';

/**
 * What went wrong, in studio's words. The API's messages are written for developers, so studio
 * says it its own way for every code it knows. A refused input keeps the message of the field at
 * fault, which says what to change.
 */
export function explain(reason: unknown): string {
  if (!(reason instanceof ApiError)) {
    // A request that never reached the backend.
    if (reason instanceof TypeError && usesSparrowPro)
      return 'Sparrow Pro cannot be reached. Check the connection and try again.';
    return reason instanceof Error ? reason.message : String(reason);
  }
  const error = reason.error;
  const field =
    withCode(error, 'feature_unavailable')?.field_errors[0] ??
    withCode(error, 'invalid_job_input')?.field_errors[0];
  if (field) return field.message;
  const limit = withCode(error, 'limit_exceeded')?.limit;
  const allows = usesSparrowPro ? 'your plan allows' : 'nesting in this browser allows';
  switch (limit?.name) {
    case 'max_projects':
      return 'You have as many projects as your plan allows. Delete one to make room.';
    case 'max_part_copies':
      return `Reduce the quantities to ${limit.value.toLocaleString('en')} copies or fewer, as many as ${allows}.`;
    case 'max_time_limit_seconds':
      return `Choose a time limit of ${formatSeconds(limit.value)} or less, the longest ${allows}.`;
  }
  if (limit) return `This is more than ${allows}.`;
  switch (error?.code) {
    case 'version_conflict':
      return 'This project was changed somewhere else, such as in another tab. Reload it to continue; changes made here since then are not saved.';
    case 'not_found':
    case 'expired':
      return 'This no longer exists.';
    case 'unauthenticated':
      return 'You are signed out. Sign in again to continue.';
    case 'account_suspended':
      return 'This account is suspended.';
    case 'insufficient_credits':
      return 'There are not enough credits left for this job.';
    case 'rate_limited':
      return 'Too much is going on at once. Try again in a moment.';
    case 'request_too_large':
      return 'This project is too large to send.';
  }
  if (reason.status >= 500)
    return usesSparrowPro
      ? 'Sparrow Pro had a problem. Try again in a moment.'
      : 'Something went wrong in this browser. Reload the page and try again.';
  return reason.message;
}

/** Why a job failed, in studio's words; `onSheets` when it nested into sheets rather than a strip. */
export function explainJobError(error: Schemas['JobError'], onSheets = false): string {
  const field = withCode(error, 'invalid_job_input')?.field_errors[0];
  if (field) return field.message;
  switch (error.code) {
    case 'no_feasible_solution':
      return onSheets
        ? 'The search ended before every part had a place on the sheets. Add sheets or give it more time, and check that every part fits on a sheet.'
        : 'The search ended before it found a layout. Give it more time, or check that every part fits on the strip.';
    case 'import_timeout':
      return 'The time ran out while the parts were being read. Give the job more time.';
    case 'worker_lost':
      return 'The solver stopped responding. Start the job again.';
  }
  return 'The job could not run. Start it again.';
}

/**
 * A fallback the backend took while reading the job, in studio's words; undefined for one studio
 * does not know. `names` holds the project's part names.
 */
export function explainDiagnostic(
  diagnostic: Schemas['Diagnostic'],
  names: Map<string, string>,
  unit: DisplayUnit,
): string | undefined {
  const name = (id: string) => names.get(id) ?? 'A part';
  const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  const length = (mm: number) => `${formatLength(mm, unit, 3)} ${unit}`;
  const unplaced = withKind(diagnostic, 'no_valid_placement');
  if (unplaced)
    return `${name(unplaced.part_id)}: no place was found for ${copies(unplaced.quantity)}, not even on empty material. Check that the part fits with the gap and the distance to the edge.`;
  const hole = withKind(diagnostic, 'hole_ignored');
  if (hole)
    return `${name(hole.part_id)}: hole ${hole.hole_index + 1} crosses the outline or another hole, so the part was treated as solid there.`;
  const raised = withKind(diagnostic, 'boundary_separation_raised');
  if (raised)
    return `The distance to the material edge was raised from ${length(raised.requested)} to ${length(raised.used)}, half the gap.`;
  if (withKind(diagnostic, 'locked_placement_conflict'))
    return 'A placement given in advance overlaps something or lies too close to it; it was kept as given.';
  return undefined;
}
