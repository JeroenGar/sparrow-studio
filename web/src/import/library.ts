import {netArea} from '../geometry/validate';
import {normalizeDocument,scalePart} from '../geometry/normalize';
import {importSparrow} from './sparrow';

export const LIBRARY_MEDIAN_MM2=2500;
export function libraryDocument(text:string,fileName:string) {
  const {document}=importSparrow(text,fileName,1);
  const areas=document.parts.map(netArea).sort((a,b)=>a-b),middle=Math.floor(areas.length/2);
  const median=areas.length%2?areas[middle]:(areas[middle-1]+areas[middle])/2;
  const factor=Math.sqrt(LIBRARY_MEDIAN_MM2/median);
  return normalizeDocument({...document,parts:document.parts.map(p=>scalePart({...p,quantity:1},factor))});
}
