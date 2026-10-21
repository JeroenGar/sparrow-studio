import { withCode, type Input, type Schemas } from '../api/client';
import { colors } from '../engine/colors';
import { outline } from '../engine/geometry/contour';
import { bounds } from '../engine/geometry/normalize';
import { worldParts } from '../engine/geometry/world';
import { arrangeParts, type Box } from './layout';
import {
  copyCount,
  jobInput,
  resolvedParts,
  runningJobs,
  type ProjectDocument,
  type ProjectJob,
} from './model';
import { canonical, drawable, normalInput, projectInput } from './solution';
import { MATERIAL, packThumb, unpackThumb, type Thumb } from './thumb';

/** Identifies studio's summaries of its projects, which the API stores beside each project. */
export const SUMMARY_FORMAT = 'sparrow-studio-summary';
export const SUMMARY_VERSION = 1;
/** The largest summary the API takes, as sent. */
export const SUMMARY_BYTES = 16 * 1024;
/** How many of a project's newest jobs its summary lists. */
export const RECENT_JOBS = 4;
/** How many of a project's largest parts its card draws. */
const CARD_PARTS = 10;

/**
 * How a job stands, as lists show it, without its layout: running, or how it ended. Studio works
 * it out from a stored job, and a project's summary keeps it for the newest jobs.
 */
export type JobFacts = {
  number: number;
  submittedAt: string;
  /** Whether it nests into sheets rather than a strip. */
  onSheets: boolean;
} & (
  | { stage: 'running'; id: string }
  /** The backend no longer has it, and studio did not keep how it ended. */
  | { stage: 'lost' }
  | {
      stage: 'completed';
      stopped: boolean;
      solverSeconds: number;
      /** Of the layout, in percent. */
      utilization: number;
      /** The sheets used, or the strip's length used. */
      used: { sheets: number } | { lengthMm: number } | undefined;
    }
  | { stage: 'cancelled' }
  | { stage: 'failed'; error: Schemas['JobError'] }
);

/** A job as a project's summary lists it: its facts, its input's key, and its first sheet. */
export type JobListing = JobFacts & {
  /** The key of what its input asks, to tell whether the project changed since. */
  input: string;
  thumb?: Thumb;
  /** How many more sheets than the one drawn. */
  more?: number;
};

/** What Home shows of a project, kept with it so Home needs no project's document. */
export type Summary = {
  format: typeof SUMMARY_FORMAT;
  version: typeof SUMMARY_VERSION;
  copies: number;
  packing: 'strip' | 'sheets';
  sheets: number;
  jobs: number;
  /** The API's IDs of the jobs running: their project is opened to follow them. */
  running: string[];
  /** The key of what a job of the project would ask now. */
  input: string;
  /** The largest parts, laid out side by side. */
  thumb?: Thumb;
  /** The newest jobs, newest first. */
  recent: JobListing[];
};

/** A job's facts from its stored record. */
export function jobFacts(job: ProjectJob): JobFacts {
  const base = {
    number: job.number,
    submittedAt: job.submittedAt,
    onSheets: jobInput(job).problem.type === 'minimize_sheets_in_order',
  };
  if (job.stage === 'running') return { ...base, stage: 'running', id: job.id };
  if (job.stage === 'lost') return { ...base, stage: 'lost' };
  const { state, outcome } = job.document;
  if (state.status === 'cancelled') return { ...base, stage: 'cancelled' };
  if (state.status === 'failed') return { ...base, stage: 'failed', error: state.error };
  return {
    ...base,
    stage: 'completed',
    stopped: state.termination === 'stopped',
    solverSeconds: state.solver_seconds,
    utilization: (outcome?.stats.density ?? 0) * 100,
    used: outcome && usedBy(outcome, base.onSheets),
  };
}

/** The sheets a layout uses, or the strip's length. */
export function usedBy(
  best: Pick<Schemas['Outcome'], 'solution' | 'stats'>,
  onSheets: boolean,
): { sheets: number } | { lengthMm: number } | undefined {
  if (onSheets) return { sheets: best.solution.layouts.length };
  const cut = best.stats.layouts[0]?.cut_x;
  return cut != null ? { lengthMm: cut } : undefined;
}

// Keys and summaries are worked out once per input and per document: neither ever changes.
const keys = new WeakMap<Input, string>();
const summaries = new WeakMap<ProjectDocument, Summary>();

/** A short key of what an input asks, however it was written. */
export function inputKey(input: Input): string {
  let key = keys.get(input);
  if (key === undefined) {
    key = hash(canonical(normalInput(input)));
    keys.set(input, key);
  }
  return key;
}

/**
 * What Home shows of the project, within `SUMMARY_BYTES` as sent as far as dropping drawings
 * goes: the drawings of the oldest jobs listed go first, then the card's.
 */
export function summarize(project: ProjectDocument): Summary {
  const known = summaries.get(project);
  if (known) return known;
  const order = new Map(project.parts.map((part, index) => [part.id, index]));
  const summary: Summary = {
    format: SUMMARY_FORMAT,
    version: SUMMARY_VERSION,
    copies: copyCount(project.parts),
    packing: project.stock.packing,
    sheets: copyCount(project.stock.sheets),
    jobs: project.jobs.length,
    running: runningJobs(project).map((job) => job.id),
    input: inputKey(projectInput(project)),
    thumb: cardThumb(project),
    recent: [...project.jobs]
      .reverse()
      .slice(0, RECENT_JOBS)
      .map((job) => ({
        ...listed(jobFacts(job)),
        input: inputKey(jobInput(job)),
        ...firstSheet(job, order),
      })),
  };
  const fits = () => bytes(summary) <= SUMMARY_BYTES;
  for (let i = summary.recent.length - 1; i >= 0 && !fits(); i--) {
    const { thumb: _, more: __, ...rest } = summary.recent[i];
    summary.recent[i] = rest;
  }
  if (!fits()) delete summary.thumb;
  summaries.set(project, summary);
  return summary;
}

/**
 * The summary saved with the project, when it fits within `SUMMARY_BYTES`; otherwise none, and
 * Home opens the project to show it.
 */
export function savedSummary(project: ProjectDocument): Summary | undefined {
  const summary = summarize(project);
  return bytes(summary) <= SUMMARY_BYTES ? summary : undefined;
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * A job's facts as a summary keeps them: a failed job's error with no more than studio says of
 * it, its first field error, cut short, so a long list of them cannot fill the summary.
 */
function listed(facts: JobFacts): JobFacts {
  if (facts.stage !== 'failed') return facts;
  const field = withCode(facts.error, 'invalid_job_input')?.field_errors[0];
  const short = (text: string) => text.slice(0, 500);
  const error = {
    ...facts.error,
    message: '',
    doc_url: null,
    param: null,
    ...(field && { field_errors: [{ param: short(field.param), message: short(field.message) }] }),
  } as Schemas['JobError'];
  return { ...facts, error };
}

/** The project's largest parts as its card draws them, each in the color the Parts tab gives it. */
function cardThumb(project: ProjectDocument): Thumb | undefined {
  const parts = resolvedParts(project);
  if (!parts.length) return undefined;
  const size = (index: number) => {
    const b = bounds(outline(parts[index].shape).outer);
    return (b[2] - b[0]) * (b[3] - b[1]);
  };
  const largest = parts
    .map((_, index) => index)
    .sort((a, b) => size(b) - size(a))
    .slice(0, CARD_PARTS);
  const arrangement = arrangeParts(largest.map((index) => parts[index]));
  return packThumb(
    arrangement.extent,
    largest.map((index) => {
      const { outer, holes } = outline(parts[index].shape);
      const [dx, dy] = arrangement.offsets.get(parts[index].id)!;
      return {
        fill: index % colors.length,
        rings: [outer, ...holes].map((ring) =>
          ring.map(([x, y]): [number, number] => [x + dx, y + dy]),
        ),
      };
    }),
  );
}

/**
 * The first sheet of a job's layout, or of the strip, drawn on its material, with how many more
 * sheets it used; nothing for a job without a layout. `order` gives each part's place in the
 * project, for its color; a part the project no longer has takes its place in the job.
 */
export function firstSheet(
  job: ProjectJob,
  order: Map<string, number>,
  live?: Schemas['Snapshot'],
): { thumb: Thumb; more: number } | Record<string, never> {
  const best = job.stage === 'ended' ? job.document.outcome : live;
  if (!best?.solution.layouts.length) return {};
  return layoutThumb(jobInput(job), best, order);
}

/** The first layout of a solution on its material, with how many more layouts there are. */
export function layoutThumb(
  input: Input,
  best: Pick<Schemas['Outcome'], 'solution' | 'stats'>,
  order: Map<string, number>,
): { thumb: Thumb; more: number } {
  const { job: drawn, layouts } = drawable(
    input,
    { layouts: best.solution.layouts.slice(0, 1) },
    undefined,
    best.stats,
  );
  const layout = layouts[0];
  const material = layout.sheet
    ? outline(layout.sheet.shape)
    : {
        outer: [
          [0, 0],
          [layout.result.usedLengthMm, 0],
          [layout.result.usedLengthMm, drawn.settings.materialWidthMm],
          [0, drawn.settings.materialWidthMm],
        ] as [number, number][],
        holes: [],
      };
  const place = (partId: string) =>
    (order.get(partId) ?? input.parts.findIndex((part) => part.id === partId)) % colors.length;
  const thumb = packThumb(bounds(material.outer) as Box, [
    { fill: MATERIAL, rings: [material.outer, ...material.holes] },
    ...worldParts(drawn, layout.result).map((part) => ({
      fill: place(part.partId),
      rings: [part.outer, ...part.holes],
    })),
  ]);
  return { thumb, more: best.solution.layouts.length - 1 };
}

/**
 * A stored summary, when it is one of studio's that this version reads; anything else counts
 * as none, and its project is opened to show it.
 */
export function readSummary(value: unknown): Summary | undefined {
  if (!isRecord(value) || value.format !== SUMMARY_FORMAT || value.version !== SUMMARY_VERSION)
    return undefined;
  const count = (key: string) => Number.isInteger(value[key]) && (value[key] as number) >= 0;
  const valid =
    ['copies', 'sheets', 'jobs'].every(count) &&
    (value.packing === 'strip' || value.packing === 'sheets') &&
    Array.isArray(value.running) &&
    value.running.every((id) => typeof id === 'string') &&
    typeof value.input === 'string' &&
    (value.thumb === undefined || validThumb(value.thumb)) &&
    Array.isArray(value.recent) &&
    value.recent.every(validListing);
  return valid ? (value as Summary) : undefined;
}

function validListing(listing: unknown): boolean {
  if (
    !isRecord(listing) ||
    !Number.isInteger(listing.number) ||
    typeof listing.submittedAt !== 'string' ||
    typeof listing.onSheets !== 'boolean' ||
    typeof listing.input !== 'string' ||
    (listing.thumb !== undefined && !(validThumb(listing.thumb) && Number.isInteger(listing.more)))
  )
    return false;
  switch (listing.stage) {
    case 'running':
      return typeof listing.id === 'string';
    case 'lost':
    case 'cancelled':
      return true;
    case 'failed':
      return isRecord(listing.error) && typeof listing.error.code === 'string';
    case 'completed':
      return (
        typeof listing.stopped === 'boolean' &&
        Number.isFinite(listing.solverSeconds) &&
        Number.isFinite(listing.utilization) &&
        (listing.used === undefined ||
          (isRecord(listing.used) &&
            (Number.isInteger(listing.used.sheets) || Number.isFinite(listing.used.lengthMm))))
      );
    default:
      return false;
  }
}

const validThumb = (thumb: unknown) =>
  isRecord(thumb) &&
  Number.isInteger(thumb.width) &&
  Number.isInteger(thumb.height) &&
  typeof thumb.shapes === 'string' &&
  !!unpackThumb(thumb as Thumb);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A 53-bit hash of text, in base 36: enough to tell inputs apart, not to keep secrets. */
function hash(text: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    a = Math.imul(a ^ char, 2654435761);
    b = Math.imul(b ^ char, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
