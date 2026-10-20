import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { explain, explainJobError } from '../src/ui/explain';

vi.mock('../src/ui/client', () => ({ usesSparrowPro: true }));

const refusal = (status: number, error: object) =>
  new ApiError(new Response(null, { status }), {
    error: { message: 'For developers.', param: null, doc_url: null, ...error },
  });

describe('errors in studio’s words', () => {
  it('never shows the API’s messages for the codes it knows', () => {
    expect(explain(refusal(412, { code: 'version_conflict' }))).toMatch(/changed somewhere else/);
    expect(explain(refusal(402, { code: 'insufficient_credits' }))).toMatch(/not enough credits/);
    expect(
      explain(refusal(422, { code: 'limit_exceeded', limit: { name: 'max_projects', value: 5 } })),
    ).toMatch(/Delete one/);
    expect(
      explain(
        refusal(422, { code: 'limit_exceeded', limit: { name: 'max_part_copies', value: 5000 } }),
      ),
    ).toBe('Reduce the quantities to 5,000 copies or fewer, as many as your plan allows.');
    expect(explain(refusal(503, { code: 'unavailable' }))).toMatch(/Sparrow Pro had a problem/);
    expect(explain(new TypeError('Failed to fetch'))).toMatch(/cannot be reached/);
  });
  it('keeps the message of a refused field, which says what to change', () => {
    const field = { param: '/input/parts/0', message: 'Reflecting parts needs Sparrow Pro.' };
    expect(explain(refusal(422, { code: 'feature_unavailable', field_errors: [field] }))).toBe(
      field.message,
    );
  });
  it('explains failed jobs', () => {
    expect(
      explainJobError({
        code: 'no_feasible_solution',
        termination: 'time_limit',
        message: '',
        param: null,
        doc_url: null,
      }),
    ).toMatch(/before it found a layout/);
  });
});
