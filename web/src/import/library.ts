import {netArea} from '../geometry/validate';
import {normalizeDocument,scalePart} from '../geometry/normalize';
import {importSparrow} from './sparrow';
import type {Document, Part} from '../model';

/** The reference area for each source instance in the reusable library. */
export const LIBRARY_MEDIAN_MM2=100;

export function median(values:number[]):number {
  if(!values.length)throw Error('A shape library source needs at least one shape.');
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

/** Scale every shape in one source by one factor, independent of demand. */
export function normalizeLibraryParts(parts:Part[]):Part[] {
  const reference=median(parts.map(netArea));
  if(!Number.isFinite(reference)||reference<=0)throw Error('A shape library source has no measurable area.');
  const factor=Math.sqrt(LIBRARY_MEDIAN_MM2/reference);
  return parts.map(part=>scalePart({...part,quantity:1},factor));
}

export function libraryDocument(text:string,fileName:string):Document {
  const {document}=importSparrow(text,fileName,1);
  return normalizeDocument({...document,parts:normalizeLibraryParts(document.parts)});
}
