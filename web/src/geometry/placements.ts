import { LIMITS, type Document, type Part, type Placement, type Point } from '../model';
import { bounds } from './normalize';
import { preparationCopyOffset } from './gestures';

export type CopyRef = { partId: string; copyIndex: number };

export const placementKey = (ref: CopyRef): string => `${ref.partId}:${ref.copyIndex}`;

const copyCount = (part: Part): number => Number.isInteger(part.quantity) && part.quantity >= 0
  ? Math.min(500, part.quantity) : 1;

function fallbackPlacement(part: Part, copyIndex: number, count = copyCount(part), parent?: Placement): Placement {
  const b = bounds(part.outer) as [number, number, number, number];
  const [dx, dy] = preparationCopyOffset(copyIndex, count, b);
  return { partId: part.id, copyIndex, xMm: (parent?.xMm ?? part.preparationPosition[0]) + dx,
    yMm: (parent?.yMm ?? part.preparationPosition[1]) + dy, angleDeg: parent?.angleDeg ?? 0 };
}

function finitePlacement(value: unknown): value is Placement {
  if (!value || typeof value !== 'object') return false;
  const p = value as Placement;
  return typeof p.partId === 'string' && Number.isInteger(p.copyIndex) && p.copyIndex >= 0
    && Number.isFinite(p.xMm) && Math.abs(p.xMm) <= LIMITS.extent
    && Number.isFinite(p.yMm) && Math.abs(p.yMm) <= LIMITS.extent
    && Number.isFinite(p.angleDeg);
}

function storedPlacements(document: Document): Map<string, Placement> {
  const stored = new Map<string, Placement>();
  const parts = new Map(document.parts.map(part => [part.id,part]));
  for (const value of document.placements ?? []) {
    if (!finitePlacement(value) || !parts.has(value.partId)) throw Error('Invalid copy placement.');
    const part = parts.get(value.partId)!;
    if (value.copyIndex >= copyCount(part)) throw Error('Copy placement exceeds its quantity.');
    const key = placementKey(value);
    if (stored.has(key)) throw Error('Copy placements must be unique.');
    stored.set(key, value);
  }
  return stored;
}

/** Expand a legacy per-part preparation position into one placement per copy. */
export function documentPlacements(document: Document): Placement[] {
  const stored = storedPlacements(document);
  return document.parts.flatMap(part => {
    const count = copyCount(part);
    const parent = stored.get(placementKey({ partId: part.id, copyIndex: 0 })) ?? fallbackPlacement(part, 0, count);
    return Array.from({ length: count }, (_, copyIndex) =>
      stored.get(placementKey({ partId: part.id, copyIndex })) ?? fallbackPlacement(part, copyIndex, count, parent));
  });
}

function mirrorPreparationPosition(parts: Part[], placements: Placement[]): Part[] {
  const first = new Map<string, Placement>();
  for (const placement of placements) if (!first.has(placement.partId)) first.set(placement.partId, placement);
  return parts.map(part => {
    const placement = first.get(part.id);
    return placement ? { ...part, preparationPosition: [placement.xMm, placement.yMm] as Point } : part;
  });
}

/** Store a complete copy layout and keep the old position field as a compatibility mirror. */
export function withDocumentPlacements(document: Document, placements?: Placement[]): Document {
  const complete=documentPlacements({...document,placements:placements ?? document.placements});
  return {...document,parts:mirrorPreparationPosition(document.parts,complete),placements:complete};
}

export function copyRefsFor(document: Document, partIds: string[]): CopyRef[] {
  const wanted = new Set(partIds);
  return documentPlacements(document).filter(p => wanted.has(p.partId))
    .map(({ partId, copyIndex }) => ({ partId, copyIndex }));
}

/** Update only the listed copies; every other copy remains byte-for-byte equivalent. */
export function updatePlacements(document: Document, updates: Placement[]): Document {
  const current = documentPlacements(document);
  const available = new Set(current.map(placementKey));
  const changes = new Map<string, Placement>();
  for (const update of updates) {
    if (!finitePlacement(update) || !available.has(placementKey(update))) throw Error('Invalid copy placement update.');
    const key = placementKey(update);
    if (changes.has(key)) throw Error('Copy placements must be unique.');
    changes.set(key, update);
  }
  return withDocumentPlacements(document, current.map(placement => changes.get(placementKey(placement)) ?? placement));
}

export function movePlacements(document: Document, refs: CopyRef[], delta: Point): Document {
  const wanted = new Set(refs.map(placementKey));
  return updatePlacements(document, documentPlacements(document).map(placement => wanted.has(placementKey(placement))
    ? { ...placement, xMm: placement.xMm + delta[0], yMm: placement.yMm + delta[1] } : placement));
}

export function rotatePlacements(document: Document, refs: CopyRef[], degrees: number, pivot?: Point): Document {
  if (!Number.isFinite(degrees)) throw Error('Rotation must be finite.');
  const wanted = new Set(refs.map(placementKey));
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const center = pivot ?? [0, 0] as Point;
  return updatePlacements(document, documentPlacements(document).map(placement => {
    if (!wanted.has(placementKey(placement))) return placement;
    const dx = placement.xMm - center[0], dy = placement.yMm - center[1];
    return { ...placement, xMm: center[0] + dx * c - dy * s, yMm: center[1] + dx * s + dy * c,
      angleDeg: placement.angleDeg + degrees };
  }));
}

/** Retain every old index and create only newly demanded copies using the normal stack offset. */
export function syncQuantity(document: Document): Document {
  // A quantity decrease intentionally removes trailing copies. Validate the
  // stored records first, then retain only indices still demanded; this keeps
  // malformed records rejected while allowing the normal edit path to drop
  // copies that no longer exist.
  const parts = new Map(document.parts.map(part => [part.id, part]));
  const kept: Placement[] = [];
  const seen = new Set<string>();
  for (const value of document.placements ?? []) {
    if (!finitePlacement(value) || !parts.has(value.partId)) throw Error('Invalid copy placement.');
    const key = placementKey(value);
    if (seen.has(key)) throw Error('Copy placements must be unique.');
    seen.add(key);
    if (value.copyIndex < copyCount(parts.get(value.partId)!)) kept.push(value);
  }
  return withDocumentPlacements({ ...document, placements: kept }, kept);
}

export function samePlacement(a: Placement | undefined, b: Placement | undefined): boolean {
  return !!a && !!b && a.partId === b.partId && a.copyIndex === b.copyIndex
    && a.xMm === b.xMm && a.yMm === b.yMm && a.angleDeg === b.angleDeg;
}

export function placementLayoutsEqual(a: Document, b: Document): boolean {
  const aa = documentPlacements(a), bb = documentPlacements(b);
  return aa.length === bb.length && aa.every((placement, index) => samePlacement(placement, bb[index]));
}

export function removeCopies(document: Document, refs: CopyRef[]): Document {
  const removed=new Set(refs.map(placementKey)),counts=new Map<string,number>();
  const placements=documentPlacements(document).filter(copy=>!removed.has(placementKey(copy))).map(copy=>{
    const copyIndex=counts.get(copy.partId)??0;counts.set(copy.partId,copyIndex+1);
    return {...copy,copyIndex};
  });
  return withDocumentPlacements({...document,parts:document.parts.map(part=>({...part,quantity:counts.get(part.id)??0}))},placements);
}

export function duplicateCopies(document: Document, refs: CopyRef[]): Document {
  const wanted=new Set(refs.map(placementKey)),placements=documentPlacements(document),counts=new Map(document.parts.map(part=>[part.id,part.quantity]));
  const added=placements.filter(copy=>wanted.has(placementKey(copy))).map(copy=>{
    const part=document.parts.find(part=>part.id===copy.partId)!,copyIndex=counts.get(part.id)!;
    counts.set(part.id,copyIndex+1);
    const [dx,dy]=preparationCopyOffset(1,2,bounds(part.outer) as [number,number,number,number]);
    return {...copy,copyIndex,xMm:copy.xMm+dx,yMm:copy.yMm+dy};
  });
  if(placements.length+added.length>LIMITS.copies)throw Error('Project exceeds 500 copies.');
  return withDocumentPlacements({...document,parts:document.parts.map(part=>({...part,quantity:counts.get(part.id)!}))},[...placements,...added]);
}

export function rotateToNextOrientation(document: Document, refs: CopyRef[]): Document {
  const wanted=new Set(refs.map(placementKey));
  return updatePlacements(document,documentPlacements(document).filter(copy=>wanted.has(placementKey(copy))).map(copy=>{
    const part=document.parts.find(part=>part.id===copy.partId)!,current=((copy.angleDeg%360)+360)%360;
    const allowed=part.rotations.kind==='discrete'?[...new Set(part.rotations.degrees.map(angle=>((angle%360)+360)%360))].sort((a,b)=>a-b):undefined;
    const next=allowed?(allowed.find(angle=>angle>current+1e-7)??allowed[0]):current+90;
    if(Math.abs(next-current)<1e-7)return copy;
    const b=bounds(part.outer),x=(b[0]+b[2])/2,y=(b[1]+b[3])/2;
    const before=copy.angleDeg*Math.PI/180,after=next*Math.PI/180;
    return {...copy,angleDeg:next,xMm:copy.xMm+x*(Math.cos(before)-Math.cos(after))-y*(Math.sin(before)-Math.sin(after)),
      yMm:copy.yMm+x*(Math.sin(before)-Math.sin(after))+y*(Math.cos(before)-Math.cos(after))};
  }));
}
