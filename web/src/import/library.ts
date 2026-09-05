import {netArea} from '../geometry/validate';
import {normalizeDocument,scalePart} from '../geometry/normalize';
import {importSparrow} from './sparrow';
import type {Document, Part} from '../model';

/** Median net shape area target for bundled source instances: 10,000 mm². */
export const LIBRARY_MEDIAN_MM2=10_000;

export function median(values:number[]):number {
  if(!values.length)throw Error('A shape library source needs at least one shape.');
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

/** One uniform factor for a source, based on shape types rather than demand. */
export function areaNormalizationFactor(parts:Part[],target=LIBRARY_MEDIAN_MM2):number {
  const reference=median(parts.map(netArea));
  if(!Number.isFinite(reference)||reference<=0||!Number.isFinite(target)||target<=0)throw Error('A shape source has no measurable area.');
  return Math.sqrt(target/reference);
}

/** Scale every shape in one source by one factor, independent of demand. */
export function normalizeLibraryParts(parts:Part[]):Part[] {
  const factor=areaNormalizationFactor(parts);
  return parts.map(part=>scalePart({...part,quantity:1},factor));
}

function normalizeSourceDocument(document:Document,factor:number,resetQuantity=false):Document {
  const parts=document.parts.map(part=>{
    const normalized=scalePart(resetQuantity?{...part,quantity:1}:part,factor);
    return {...normalized,preparationPosition:part.preparationPosition.map(value=>value*factor) as [number,number]};
  });
  const placements=document.placements?.map(placement=>({...placement,xMm:placement.xMm*factor,yMm:placement.yMm*factor}));
  return normalizeDocument({...document,parts,
    settings:{...document.settings,materialWidthMm:document.settings.materialWidthMm*factor,clearanceMm:document.settings.clearanceMm*factor},
    placements,
  });
}

/** Normalize a complete bundled sample while retaining its demands and rules. */
export function normalizeSampleDocument(document:Document):Document {
  if(!document.parts.length)return document;
  return normalizeSourceDocument(document,areaNormalizationFactor(document.parts));
}

export function libraryDocument(text:string,fileName:string):Document {
  const {document}=importSparrow(text,fileName,1);
  return normalizeSourceDocument(document,areaNormalizationFactor(document.parts),true);
}
