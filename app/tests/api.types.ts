// Compile-time checks of the client's types; `npm run typecheck` fails when one breaks.
import { ApiError, withCode, type Client, type Schemas } from '../src/api/client';

declare const client: Client;
declare const error: ApiError;
declare const jobError: Schemas['JobError'];

// The catch-all variant keeps `code` a plain string, so comparing it narrows nothing...
const body = error.error;
if (body?.code === 'invalid_job_input') {
  // @ts-expect-error field_errors is not known without the guard.
  void body.field_errors;
}
// ...and `withCode` returns the named variant.
withCode(body, 'invalid_job_input')?.field_errors.map((field) => field.param);
withCode(body, 'feature_unavailable')?.field_errors.map((field) => field.message);
void withCode(body, 'limit_exceeded')?.limit.name;
void withCode(jobError, 'no_feasible_solution')?.termination;
// @ts-expect-error Only codes the specification names can be asked for.
withCode(body, 'not_a_code');

// Projects come with their version, and saving or deleting needs one.
void (async () => {
  const { project, version } = await client.getProject('prj_1');
  const { document } = await client.getProjectDocument(project.id);
  await client.saveProject(project.id, { name: project.name, document }, version);
  // @ts-expect-error A save without a version does not compile.
  await client.saveProject(project.id, { name: project.name, document });
  // @ts-expect-error A document is bytes, not JSON.
  await client.saveProject(project.id, { name: project.name, document: {} }, version);
  // @ts-expect-error Submitting needs an idempotency key.
  await client.submitJob({ settings: { time_limit_seconds: 1 }, input: null! });
  for await (const event of client.streamJobEvents('job_1', { search: true })) {
    if (event.type === 'status') void event.data.state.status;
    if (event.type === 'search') void event.data.solution.layouts;
  }
})();
