import type { Job, Result, Sheet } from '../model';
import type { ImportReview } from '../import/sparrow';
import type { Role } from '../import/drawing';
import type { ExportBundle } from '../export/svg';
import type { LiveGeometry } from '../geometry/live';
export type Identity = { runId: number; documentRevision: number };
export type ImportFile = { name: string; text: string };
export type GeometryRequest = Identity & (
  // Drawings are read by the roles of their layers: those given, else suggested, with `kind` for
  // layers whose names say nothing; identical outlines merge unless `merge` is false.
  | { type:'import'; files:ImportFile[]; scale:number; tolerance?:number; curves?:'keep'|'flatten'; kind?:'parts'|'sheets'; roles?:Record<string,Role>; merge?:boolean }
  | { type:'export'; document:Job; result:Result; utilization:number; sheets?:Sheet[] }
  // One result per layout: parts on different sheets never overlap.
  | { type:'live-preview'; sequence:number; document:Job; results:Result[] }
);
export type GeometryReply = Identity & (
  | { type:'import-review'; review:ImportReview }
  | { type:'export-result'; bundle:ExportBundle }
  | { type:'live-frame'; sequence:number; geometry:LiveGeometry[] }
  | { type:'error'; message:string }
);
