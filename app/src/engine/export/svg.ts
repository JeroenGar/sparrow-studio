import type { Job, Result, Sheet } from '../model';
import { worldParts, type WorldPart } from '../geometry/world';
import { exportDXF, STUDIO_CREDIT } from './dxf';
import {DOMImplementation,XMLSerializer,type Element} from '@xmldom/xmldom';
import {shapePath} from '../geometry/path';
import {outline} from '../geometry/contour';
import {bounds} from '../geometry/normalize';
import {colors} from '../colors';
const SVG_NS='http://www.w3.org/2000/svg';
export type ExportBundle = { svg: string; dxf:string; world: WorldPart[] };
/** The layout as SVG and DXF, on its sheet or else the strip; `utilization` is the backend's, in percent. */
export function exportSVG(doc: Job,result: Result,utilization: number,sheet?: Sheet): ExportBundle {
  // JS's shortest round-trip decimal preserves each f64 exactly. Both formats
  // consume these same numbers, including every hole, without display rounding.
  const world=JSON.parse(JSON.stringify(worldParts(doc,result))) as WorldPart[];
  if(world.some(part=>[part.outer,...part.holes].some(ring=>ring.some(point=>point.some(value=>!Number.isFinite(value))))))throw Error('Layout contains invalid coordinates.');
  // The frame is the material: the strip up to its cut, or the sheet's bounds.
  const [minX,minY,maxX,maxY]=sheet?bounds(outline(sheet.shape).outer):[0,0,result.usedLengthMm,doc.settings.materialWidthMm];
  const height=maxY-minY,width=maxX-minX;
  const left=minX,top=0,frameWidth=width,frameHeight=height;
  const padX=frameWidth*.05,padY=frameHeight*.05,pageWidth=frameWidth+2*padX,pageHeight=frameHeight+2*padY;
  const viewBox=`${left-padX} ${top-padY} ${pageWidth} ${pageHeight}`;
  const summary=`${doc.name} · ${Number(width.toFixed(2))} × ${Number(height.toFixed(2))} mm · ${utilization.toFixed(2)}% used`;
  const fontSize=Math.min(padY*.3,frameWidth/(summary.length*.65));
  const creditFontSize=Math.min(padY*.3,frameWidth/(STUDIO_CREDIT.length*.65));
  const partIndex=new Map(doc.parts.map((part,i)=>[part.id,i]));

  const svgDocument=new DOMImplementation().createDocument(SVG_NS,'svg',null),root=svgDocument.documentElement!;
  const add=(parent:Element,name:string,attributes:Record<string,string|number>,text?:string)=>{
    const element=svgDocument.createElementNS(SVG_NS,name);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    if(text!==undefined)element.textContent=text;
    parent.appendChild(element);
    return element;
  };
  for(const [key,value] of Object.entries({width:`${pageWidth}mm`,height:`${pageHeight}mm`,viewBox,preserveAspectRatio:'xMidYMid meet',style:'width:100%;height:100%',role:'img','aria-labelledby':'layout-title layout-description'}))root.setAttribute(key,value);
  add(root,'title',{id:'layout-title'},`${doc.name} — sparrow studio`);
  add(root,'desc',{id:'layout-description'},`${summary}. Valid nesting layout; geometry is in millimetres.`);
  const decoration=add(root,'g',{'data-sparrow-decoration':'true','aria-hidden':'true'});
  add(decoration,'rect',{x:left-padX,y:top-padY,width:pageWidth,height:pageHeight,fill:'#ffffff'});
  // Material coordinates have y up; the SVG's run down from the material's top.
  const flip=`translate(0 ${maxY}) scale(1 -1)`;
  const materialStroke=Math.min(width,height)*.0025;
  if(!sheet)add(decoration,'rect',{x:0,y:0,width,height,fill:'#f1f5f9',stroke:'#64748b','stroke-width':materialStroke});
  else {
    const material=add(decoration,'g',{transform:flip,'stroke-width':materialStroke});
    add(material,'path',{d:shapePath(sheet.shape),fill:'#f1f5f9',stroke:'#64748b','fill-rule':'evenodd'});
    for(const defect of sheet.defects)add(material,'path',{d:shapePath({outer:defect}),fill:'#cbd5e1',stroke:'#94a3b8'});
    if(sheet.cutX!==null)add(material,'path',{d:`M${sheet.cutX} ${minY}V${maxY}`,fill:'none',stroke:'#64748b','stroke-dasharray':`${materialStroke*4} ${materialStroke*3}`});
  }
  add(decoration,'text',{x:left,y:top-padY*.6,'font-family':'monospace','font-size':fontSize,fill:'#334155'},summary);
  const credit=add(decoration,'text',{x:left,y:top-padY*.15,'font-family':'monospace','font-size':creditFontSize,fill:'#334155'});
  add(credit,'a',{href:'https://sparrowstudio.app',target:'_blank'},STUDIO_CREDIT);
  const parts=add(root,'g',{id:'parts',transform:flip,stroke:'#334155','stroke-width':Math.min(width,height)*.0015,'stroke-linejoin':'round'});
  world.forEach((p,i)=>{
    const index=partIndex.get(p.partId)!,part=doc.parts[index];
    const path=add(parts,'path',{id:`part-${i}`,fill:colors[index%colors.length],'fill-rule':'evenodd',d:shapePath(p.shape)});
    add(path,'title',{},`${part.name} · copy ${p.copyIndex+1}`);
  });
  const svg=new XMLSerializer().serializeToString(svgDocument)+'\n';
  return {world,dxf:exportDXF(doc,world,result.usedLengthMm,sheet),svg};
}
