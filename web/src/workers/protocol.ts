import type { Document, Part, Point, Result, Validation } from '../model';
import type { ImportReview } from '../import/sparrow';
import type { ExportBundle } from '../export/svg';
import type { LiveGeometry } from '../geometry/live';
import type {GeometryEdit} from '../geometry/manipulate';
import type {LabelPoint} from '../geometry/preparation';
export type Identity = { runId: number; documentRevision: number };
export type Start = Identity & { seed: string; threads?: number } & (
  | { type: 'start'; document: Document }
  | { type: 'bridge'; input: string; seconds: 10 }
);
export type Placement = { item_id: number; transformation: { rotation: number; translation: [number, number] } };
export type SolverMessage = Identity & (
  | { type: 'ready'; threads: number; fallbackReason?: string }
  | { type: 'phase'; phase: string; initializationMs: number }
  | (({ type:'candidate' }|{ type:'live' }) & { sequence:number; report:string; elapsedMs:number;
      solution: { strip_width: number; layout: { placed_items: Placement[] } } })
  | { type: 'finished' }
  | { type: 'error'; message: string }
);
export type Candidate = Extract<SolverMessage,{sequence:number}>;
export type GeometryRequest = Identity & (
  | { type:'shape'; shape:'rectangle'|'circle'|'polygon'; width:number; height:number; points?:Point[] }
  | { type:'normalize'; document:Document }
  | { type:'prepare-layout'; document:Document; pinnedIds?:string[]; compact?:boolean }
  | { type:'label-points'; parts:Part[] }
  | { type:'resize'; document:Document; partId:string; axis:0|1; sizeMm:number }
  | { type:'edit-selection'; document:Document; ids:string[]; edit:GeometryEdit }
  | { type:'library'; text:string; fileName:string }
  | { type:'import'; files:{name:string;text:string}[]; scale:number; tolerance?:number; enclosed?:'holes'|'parts'; layers?:string[] }
  | { type:'validate'; sequence:number; document:Document; result:Result }
  | { type:'export'; document:Document; result:Result }
  | { type:'save-project'; document:Document; result?:Result }
  | { type:'live-preview'; sequence:number; document:Document; result:Result }
);
export type GeometryReply = Identity & (
  | { type:'part'; part:Part }
  | { type:'normalized'; document:Document }
  | { type:'label-points'; points:LabelPoint[] }
  | { type:'import-review'; review:ImportReview }
  | { type:'validation-result'; sequence:number; validation:Validation; elapsedMs:number }
  | { type:'export-result'; bundle:ExportBundle }
  | { type:'project-file'; text:string }
  | { type:'live-frame'; sequence:number; geometry:LiveGeometry }
  | { type:'error'; message:string }
);
