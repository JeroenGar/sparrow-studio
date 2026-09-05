import type { Document, Result, Ring } from '../model';
import { validate, worldParts, type WorldPart } from '../geometry/validate';
import { exportDXF } from './dxf';
import {DOMParser} from '@xmldom/xmldom';
import {pathData} from '../geometry/path';
export type ExportBundle = { svg: string; dxf:string; world: WorldPart[] };
export function exportSVG(doc: Document,result: Result): ExportBundle {
  if(result.validation.status!=='passed') throw Error('Only a checked result can be exported.');
  // JS's shortest round-trip decimal preserves each f64 exactly. Both formats
  // consume these same numbers, including every hole, without display rounding.
  const world=JSON.parse(JSON.stringify(worldParts(doc,result))) as WorldPart[];
  const check=validate(doc,result,world);
  if(check.status!=='passed') throw Error(`Serialized geometry failed validation: ${check.errors.join(' ')}`);
  const paths=world.map(p=>`<path fill-rule="evenodd" d="${pathData([p.outer,...p.holes])}"/>`).join('\n');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${result.usedLengthMm}mm" height="${doc.settings.materialWidthMm}mm" viewBox="0 0 ${result.usedLengthMm} ${doc.settings.materialWidthMm}">\n<g transform="translate(0 ${doc.settings.materialWidthMm}) scale(1 -1)">\n${paths}\n</g>\n</svg>\n`;
  const xml=new DOMParser({onError:(_level,message)=>{throw Error(message);}}).parseFromString(svg,'image/svg+xml');
  const root=xml.documentElement!,group=root.getElementsByTagName('g'),elements=Array.from(root.getElementsByTagName('path'));
  if(root.getAttribute('width')!==`${result.usedLengthMm}mm`||root.getAttribute('height')!==`${doc.settings.materialWidthMm}mm`||root.getAttribute('viewBox')!==`0 0 ${result.usedLengthMm} ${doc.settings.materialWidthMm}`||group.length!==1||group[0].getAttribute('transform')!==`translate(0 ${doc.settings.materialWidthMm}) scale(1 -1)`||elements.length!==world.length)throw Error('Serialized SVG dimensions, axes or copy count changed.');
  const reparsed=elements.map((element,i)=>{
    const d=element.getAttribute('d')??'',commands=d.match(/M[^MZ]+Z/g)??[];
    if(commands.join('')!==d||element.getAttribute('fill-rule')!=='evenodd')throw Error('Serialized SVG lost its closed contour structure.');
    const rings=commands.map(command=>command.slice(1,-1).split('L').map(point=>point.split(',').map(Number)) as Ring);
    return {...world[i],outer:rings[0],holes:rings.slice(1)};
  });
  const svgCheck=validate(doc,result,reparsed);
  if(svgCheck.status!=='passed')throw Error(`Serialized SVG failed validation: ${svgCheck.errors.join(' ')}`);
  return {world,dxf:exportDXF(doc,result,world),svg};
}
