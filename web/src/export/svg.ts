import { documentPlacements } from '../geometry/placements';
import type { Document, Result, Ring } from '../model';
import { worldParts, netArea, type WorldPart } from '../geometry/validate';
import { exportDXF, STUDIO_CREDIT } from './dxf';
import {DOMImplementation,DOMParser,XMLSerializer,type Element} from '@xmldom/xmldom';
import {pathData} from '../geometry/path';
import {colors} from '../colors';
const SVG_NS='http://www.w3.org/2000/svg';
export type ExportBundle = { svg: string; dxf:string; world: WorldPart[] };
export function exportSVG(doc: Document,result?: Result): ExportBundle {
  if(result&&result.validation.status!=='passed') throw Error('Only a checked result can be exported.');
  // JS's shortest round-trip decimal preserves each f64 exactly. Both formats
  // consume these same numbers, including every hole, without display rounding.
  const world=JSON.parse(JSON.stringify(worldParts(doc,result??{placements:documentPlacements(doc)}))) as WorldPart[];
  if(world.some(part=>[part.outer,...part.holes].some(ring=>ring.some(point=>point.some(value=>!Number.isFinite(value))))))throw Error('Canvas contains invalid coordinates.');
  const height=doc.settings.materialWidthMm;
  const extent=world.reduce((box,part)=>part.outer.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],box),[0,0,1,height]);
  const width=result?.usedLengthMm??extent[2];
  const left=result?0:extent[0],top=result?0:height-extent[3];
  const frameWidth=result?width:extent[2]-extent[0],frameHeight=result?height:extent[3]-extent[1];
  const padX=frameWidth*.05,padY=frameHeight*.05,pageWidth=frameWidth+2*padX,pageHeight=frameHeight+2*padY;
  const viewBox=`${left-padX} ${top-padY} ${pageWidth} ${pageHeight}`;
  const utilization=doc.parts.reduce((sum,part)=>sum+netArea(part)*part.quantity,0)/(width*height)*100;
  const summary=`${doc.name} · ${Number(width.toFixed(2))} × ${Number(height.toFixed(2))} mm · ${result?`${utilization.toFixed(2)}% used`:'Canvas layout'}`;
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
  add(root,'title',{id:'layout-title'},`${doc.name} — sparrow/studio`);
  add(root,'desc',{id:'layout-description'},`${summary}. ${result?'Checked nesting layout':'Canvas layout (not checked for nesting)'}; geometry is in millimetres.`);
  const decoration=add(root,'g',{'data-sparrow-decoration':'true','aria-hidden':'true'});
  add(decoration,'rect',{x:left-padX,y:top-padY,width:pageWidth,height:pageHeight,fill:'#ffffff'});
  add(decoration,'rect',{x:0,y:0,width,height,fill:'#f1f5f9',stroke:'#64748b','stroke-width':Math.min(width,height)*.0025});
  add(decoration,'text',{x:left,y:top-padY*.6,'font-family':'monospace','font-size':fontSize,fill:'#334155'},summary);
  const credit=add(decoration,'text',{x:left,y:top-padY*.15,'font-family':'monospace','font-size':creditFontSize,fill:'#334155'});
  add(credit,'a',{href:'https://sparrowstudio.app',target:'_blank'},STUDIO_CREDIT);
  const parts=add(root,'g',{id:'parts',transform:`translate(0 ${height}) scale(1 -1)`,stroke:'#334155','stroke-width':Math.min(width,height)*.0015,'stroke-linejoin':'round'});
  world.forEach((p,i)=>{
    const index=partIndex.get(p.partId)!,part=doc.parts[index];
    const path=add(parts,'path',{id:`part-${i}`,fill:colors[index%colors.length],'fill-rule':'evenodd',d:pathData([p.outer,...p.holes])});
    add(path,'title',{},`${part.name} · copy ${p.copyIndex+1}`);
  });
  const svg=new XMLSerializer().serializeToString(svgDocument)+'\n';
  const xml=new DOMParser({onError:(_level,message)=>{throw Error(message);}}).parseFromString(svg,'image/svg+xml');
  const parsedRoot=xml.documentElement!,group=Array.from(parsedRoot.getElementsByTagName('g')).find(g=>g.getAttribute('id')==='parts'),elements=Array.from(parsedRoot.getElementsByTagName('path'));
  if(parsedRoot.getAttribute('width')!==`${pageWidth}mm`||parsedRoot.getAttribute('height')!==`${pageHeight}mm`||parsedRoot.getAttribute('viewBox')!==viewBox||!group||group.getAttribute('transform')!==`translate(0 ${doc.settings.materialWidthMm}) scale(1 -1)`||elements.length!==world.length)throw Error('Serialized SVG dimensions, axes or copy count changed.');
  const reparsed=elements.map((element,i)=>{
    const d=element.getAttribute('d')??'',commands=d.match(/M[^MZ]+Z/g)??[];
    if(commands.join('')!==d||element.getAttribute('fill-rule')!=='evenodd')throw Error('Serialized SVG lost its closed contour structure.');
    const rings=commands.map(command=>command.slice(1,-1).split('L').map(point=>point.split(',').map(Number)) as Ring);
    return {...world[i],outer:rings[0],holes:rings.slice(1)};
  });
  if(JSON.stringify(reparsed)!==JSON.stringify(world))throw Error('Serialized SVG changed canvas coordinates.');
  return {world,dxf:exportDXF(doc,world,width),svg};
}
