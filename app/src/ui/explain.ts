import { ApiError, withCode, type Schemas } from '../api/client';
import { usesSparrowPro } from './client';

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
  if (limit?.name === 'max_projects')
    return 'You have as many projects as your plan allows. Delete one to make room.';
  if (limit) return 'This is more than your plan allows.';
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

/** Why a job failed, in studio's words. */
export function explainJobError(error: Schemas['JobError']): string {
  const field = withCode(error, 'invalid_job_input')?.field_errors[0];
  if (field) return field.message;
  switch (error.code) {
    case 'no_feasible_solution':
      return 'The search ended before it found a layout. Give it more time, or check that every part fits on the strip.';
    case 'import_timeout':
      return 'The time ran out while the parts were being read. Give the job more time.';
    case 'worker_lost':
      return 'The solver stopped responding. Start the job again.';
  }
  return 'The job could not run. Start it again.';
}
