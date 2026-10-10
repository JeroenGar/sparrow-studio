import type { SolverBinary } from '../wasm';
import type { Job, Result } from '../model';
import type { ImportReview } from '../import/sparrow';
import type { ExportBundle } from '../export/svg';
import type { LiveGeometry } from '../geometry/live';
export type Identity = { runId: number; documentRevision: number };
export type Start = Identity & { type: 'start'; document: Job; seed: string; threads?: number; control?: SharedArrayBuffer };
export type Placement = { item_id: number; transformation: { rotation: number; translation: [number, number] } };
export type SolverMessage = Identity & (
  | { type: 'ready'; threads: number; solverBinary: SolverBinary; simd: boolean; canSkip: boolean; fallbackReason?: string }
  | { type: 'phase'; phase: string; workers: number; initializationMs: number }
  | (({ type:'candidate' }|{ type:'live' }) & { sequence:number; report:string; elapsedMs:number;
      solution: { strip_width: number; layout: { placed_items: Placement[] } } })
  | { type: 'solver-log'; line:string; timestamp:number }
  | { type:'run-input'; input:string; seed:string; seconds:number|null; clearance:number; preset:string; threads:number; solverBinary:SolverBinary }
  | { type:'configuration'; configuration:string }
  | { type: 'finished' }
  | { type: 'error'; message: string }
);
export type Candidate = Extract<SolverMessage,{sequence:number}>;
export type ImportFile = { name: string; text: string };
export type GeometryRequest = Identity & (
  | { type:'normalize'; document:Job }
  | { type:'import'; files:ImportFile[]; scale:number; tolerance?:number; enclosed?:'holes'|'parts'; layers?:string[] }
  | { type:'export'; document:Job; result:Result }
  | { type:'live-preview'; sequence:number; document:Job; result:Result }
);
export type GeometryReply = Identity & (
  | { type:'normalized'; document:Job }
  | { type:'import-review'; review:ImportReview }
  | { type:'export-result'; bundle:ExportBundle }
  | { type:'live-frame'; sequence:number; geometry:LiveGeometry }
  | { type:'error'; message:string }
);
