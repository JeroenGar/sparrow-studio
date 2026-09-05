import type { Document, Result, Ring } from '../model';
import { validate, worldParts, netArea, type WorldPart } from '../geometry/validate';
import { exportDXF } from './dxf';
import {DOMParser} from '@xmldom/xmldom';
import {pathData} from '../geometry/path';
import {colors} from '../colors';
const xmlText=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export type ExportBundle = { svg: string; dxf:string; world: WorldPart[] };
export function exportSVG(doc: Document,result: Result): ExportBundle {
  if(result.validation.status!=='passed') throw Error('Only a checked result can be exported.');
  // JS's shortest round-trip decimal preserves each f64 exactly. Both formats
  // consume these same numbers, including every hole, without display rounding.
  const world=JSON.parse(JSON.stringify(worldParts(doc,result))) as WorldPart[];
  const check=validate(doc,result,world);
  if(check.status!=='passed') throw Error(`Serialized geometry failed validation: ${check.errors.join(' ')}`);
  const width=result.usedLengthMm,height=doc.settings.materialWidthMm;
  const padX=width*.05,padY=height*.05,pageWidth=width+2*padX,pageHeight=height+2*padY;
  const viewBox=`${-padX} ${-padY} ${pageWidth} ${pageHeight}`;
  const utilization=doc.parts.reduce((sum,part)=>sum+netArea(part)*part.quantity,0)/(width*height)*100;
  const summary=`${doc.name} · ${Number(width.toFixed(2))} × ${Number(height.toFixed(2))} mm · ${utilization.toFixed(2)}% used`;
  const fontSize=Math.min(Math.min(width,height)*.025,width/(summary.length*.65));
  const partIndex=new Map(doc.parts.map((part,i)=>[part.id,i]));
  const paths=world.map((p,i)=>{
    const index=partIndex.get(p.partId)!,part=doc.parts[index];
    return `<path id="part-${i}" fill="${colors[index%colors.length]}" fill-rule="evenodd" d="${pathData([p.outer,...p.holes])}"><title>${xmlText(part.name)} · copy ${p.copyIndex+1}</title></path>`;
  }).join('\n');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}mm" height="${pageHeight}mm" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-labelledby="layout-title layout-description">
<title id="layout-title">${xmlText(doc.name)} — sparrow / studio</title>
<desc id="layout-description">${xmlText(summary)}. Checked nesting layout; geometry is in millimetres.</desc>
<g data-sparrow-decoration="true" aria-hidden="true">
<rect x="${-padX}" y="${-padY}" width="${pageWidth}" height="${pageHeight}" fill="#ffffff"/>
<rect x="0" y="0" width="${width}" height="${height}" fill="#f1f5f9" stroke="#64748b" stroke-width="${Math.min(width,height)*.0025}"/>
<text x="0" y="${-padY*.35}" font-family="monospace" font-size="${fontSize}" fill="#334155">${xmlText(summary)}</text>
</g>
<g id="parts" transform="translate(0 ${height}) scale(1 -1)" stroke="#334155" stroke-width="${Math.min(width,height)*.0015}" stroke-linejoin="round">
${paths}
</g>
</svg>
`;
  const xml=new DOMParser({onError:(_level,message)=>{throw Error(message);}}).parseFromString(svg,'image/svg+xml');
  const root=xml.documentElement!,group=Array.from(root.getElementsByTagName('g')).find(g=>g.getAttribute('id')==='parts'),elements=Array.from(root.getElementsByTagName('path'));
  if(root.getAttribute('width')!==`${pageWidth}mm`||root.getAttribute('height')!==`${pageHeight}mm`||root.getAttribute('viewBox')!==viewBox||!group||group.getAttribute('transform')!==`translate(0 ${doc.settings.materialWidthMm}) scale(1 -1)`||elements.length!==world.length)throw Error('Serialized SVG dimensions, axes or copy count changed.');
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
