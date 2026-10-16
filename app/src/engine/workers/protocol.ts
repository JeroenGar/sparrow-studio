import type { Job, Result } from '../model';
import type { ImportReview } from '../import/sparrow';
import type { ExportBundle } from '../export/svg';
import type { LiveGeometry } from '../geometry/live';
export type Identity = { runId: number; documentRevision: number };
export type ImportFile = { name: string; text: string };
export type GeometryRequest = Identity & (
  | { type:'import'; files:ImportFile[]; scale:number; tolerance?:number; enclosed?:'holes'|'parts'; layers?:string[]; curves?:'keep'|'flatten' }
  | { type:'export'; document:Job; result:Result; utilization:number }
  | { type:'live-preview'; sequence:number; document:Job; result:Result }
);
export type GeometryReply = Identity & (
  | { type:'import-review'; review:ImportReview }
  | { type:'export-result'; bundle:ExportBundle }
  | { type:'live-frame'; sequence:number; geometry:LiveGeometry }
  | { type:'error'; message:string }
);
