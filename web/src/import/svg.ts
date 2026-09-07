import { DOMParser, XMLSerializer, type Element as XMLElement } from '@xmldom/xmldom';
import { loadSerialWasm } from '../wasm';
import { DEFAULT_SETTINGS,newPart,type Part,type Point,type Ring } from '../model';
import { area,bounds,inside,normalizeDocument,normalizeRing,ringCrosses } from '../geometry/normalize';
import { apply,multiply,append,bezier,type Matrix } from '../geometry/flatten';
import { localize,type ImportReview } from './sparrow';

// Initialized only for SVG imports, not other geometry-worker tasks.
let svg_paths: typeof import('../../wasm/pkg/sparrow_web').svg_paths;
export const initializeSVG=async()=>{const wasm=await loadSerialWasm();await wasm.default();svg_paths=wasm.svg_paths;};
type Contour={ring:Ring;entityId:string;curved:boolean};
type Command=['M'|'L'|'Q'|'C'|'Z',...number[]];
type ResolvedSVG={height:number;paths:{id:string;commands:Command[];transform:Matrix;rule:'evenodd'|'nonzero'}[]};
export type SVGOptions={scale:number;tolerance:number};
const attr=(e:XMLElement,name:string)=>e.hasAttribute(name)?e.getAttribute(name)!:undefined;

function hierarchy(contours:Contour[]):number[] {
  const rings=contours.map(c=>normalizeRing(c.ring)),areas=rings.map(r=>Math.abs(area(r))),parent=rings.map(()=>-1);
  for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++) {
    if(ringCrosses(rings[i],rings[j]))throw Error(`Contours ${contours[i].entityId} and ${contours[j].entityId} touch or intersect; topology is ambiguous.`);
    const a=inside(rings[i][0],rings[j]),b=inside(rings[j][0],rings[i]);
    if(a&&(parent[i]===-1||areas[j]<areas[parent[i]]))parent[i]=j;
    if(b&&(parent[j]===-1||areas[i]<areas[parent[j]]))parent[j]=i;
  }
  return parent;
}
function compound(contours:Contour[],rule:'evenodd'|'nonzero'):Contour[] {
  const parents=hierarchy(contours);
  return contours.filter((c,i)=>{
    let winding=0,depth=0,p=parents[i];
    while(p!==-1){winding+=Math.sign(area(contours[p].ring));depth++;p=parents[p];}
    return rule==='evenodd' || (winding===0)!==(winding+Math.sign(area(c.ring))===0);
  });
}
export function contoursToParts(contours:Contour[],fileName:string,format:'svg'|'dxf',tolerance:number,enclosed:'holes'|'parts'):Part[] {
  const parent=hierarchy(contours),depth=parent.map((p)=>{let d=0;while(p!==-1){d++;p=parent[p];}return d;});
  return contours.flatMap((c,i)=>{
    if(enclosed==='holes'&&depth[i]%2===1)return [];
    const holes=enclosed==='holes'?contours.filter((_,j)=>parent[j]===i).map(h=>h.ring):[];
    const part=localize({...newPart(c.ring,c.entityId),holes,source:{format,fileName,entityId:c.entityId},
      approximationToleranceMm:c.curved||contours.some((h,j)=>parent[j]===i&&h.curved)?tolerance:0});
    return [part];
  });
}
function pathContours(commands:Command[],m:Matrix,tolerance:number,id:string):Contour[] {
  const contours:Contour[]=[];let ring:Ring=[],start:Point=[0,0],current:Point=[0,0],curved=false,closed=false;
  const finish=()=>{if(ring.length){if(!closed)throw Error('Open path cannot become a part. Close it or remove it in the source drawing.');contours.push({ring,entityId:id,curved});ring=[];}};
  for(const segment of commands) {
    const cmd=segment[0].toUpperCase(),v=segment.slice(1) as number[];
    if(!v.every(Number.isFinite))throw Error('Non-finite path command.');
    switch(cmd) {
      case 'M':finish();start=[v[0],v[1]];current=start;ring=[apply(m,start)];closed=false;curved=false;break;
      case 'L':current=[v[0],v[1]];append(ring,apply(m,current));closed=false;break;
      case 'C':bezier([current,[v[0],v[1]],[v[2],v[3]],[v[4],v[5]]].map(p=>apply(m,p as Point)),tolerance,ring);current=[v[4],v[5]];curved=true;closed=false;break;
      case 'Q':bezier([current,[v[0],v[1]],[v[2],v[3]]].map(p=>apply(m,p as Point)),tolerance,ring);current=[v[2],v[3]];curved=true;closed=false;break;
      case 'Z':current=start;closed=true;break;
      default:throw Error(`Unsupported path command ${cmd}.`);
    }
  }
  finish();return contours;
}
export function importSVG(text:string,fileName:string,options:SVGOptions):ImportReview {
  if(!Number.isFinite(options.scale)||options.scale<=0||!Number.isFinite(options.tolerance)||options.tolerance<=0||options.tolerance>100)throw Error('Scale and approximation tolerance must be positive finite numbers.');
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG entities and DOCTYPE declarations are forbidden.');
  if(/<\?xml-stylesheet\b/i.test(text))throw Error('External SVG stylesheets are unsupported. Embed styles in the SVG.');
  const document=new DOMParser({onError:(_level,message)=>{throw Error(`Invalid SVG XML: ${message}`);}}).parseFromString(text,'image/svg+xml');
  const root=document.documentElement;if(!root||root.localName!=='svg')throw Error('Expected an SVG root element.');
  const warnings:string[]=[],ids=new Set<string>();let nodes=0;
  // Keep resource limits and Studio-specific decorations outside SVG interpretation.
  const inspect=(node:XMLElement,depth:number)=>{
    if(++nodes>10_000||depth>64)throw Error('SVG exceeds 10,000 elements or XML depth 64.');
    const tag=node.localName??node.tagName;
    if(['script','foreignObject','animate','animateTransform','set'].includes(tag))throw Error(`SVG ${tag} is forbidden.`);
    for(let i=0;i<node.attributes.length;i++) {
      const a=node.attributes.item(i)!;
      if(a.name==='xml:base')throw Error('SVG xml:base references are unsupported. Use local references only.');
      if(/^on/i.test(a.name)||(['href','xlink:href'].includes(a.name)&&!a.value.startsWith('#')))throw Error(`Forbidden event handler or external reference in ${tag}.`);
    }
    const id=attr(node,'id');if(id){if(ids.has(id))throw Error(`Duplicate SVG ID ${id}.`);ids.add(id);}
    if(tag==='metadata'||attr(node,'data-sparrow-decoration')==='true') {node.parentNode?.removeChild(node);return;}
    if(['text','image','line'].includes(tag)) {warnings.push(`${id??tag}: excluded ${tag}; only closed vector outlines become parts.`);node.parentNode?.removeChild(node);return;}
    for(const child of Array.from(node.childNodes))if(child.nodeType===1)inspect(child as XMLElement,depth+1);
  };
  inspect(root,0);
  // Studio exports use responsive CSS sizing around explicit physical dimensions.
  const style=attr(root,'style');
  if(style)root.setAttribute('style',style.split(';').filter(entry=>!/^\s*(width|height)\s*:\s*100%\s*$/.test(entry)).join(';'));
  if(attr(root,'preserveAspectRatio')?.includes('slice'))warnings.push('preserveAspectRatio slice scaling is honored; viewport cropping is not applied to the root cutting outlines.');
  const rw=attr(root,'width'),rh=attr(root,'height'),ambiguous=(!rw&&!rh)||[rw,rh].some(v=>v?.includes('%'));
  const scale=ambiguous?options.scale:25.4/96;
  if(ambiguous)warnings.push(`Root SVG size is ambiguous. Using the selected ${scale} mm per drawing unit.`);
  let resolved:ResolvedSVG;
  try {resolved=JSON.parse(svg_paths(new XMLSerializer().serializeToString(document)));}
  catch(error){throw Error(`SVG could not be resolved: ${String(error)}`);}
  const matrix:Matrix=[scale,0,0,-scale,0,resolved.height*scale];
  const entities:Contour[][]=[];let totalVertices=0;
  for(const [i,path] of resolved.paths.entries()) {
    const id=path.id||`path ${i+1}`;
    const contours=pathContours(path.commands,multiply(matrix,path.transform),options.tolerance,id);
    totalVertices+=contours.reduce((n,c)=>n+c.ring.length,0);
    if(totalVertices>100_000)throw Error('SVG exceeds 100,000 vertices.');
    entities.push(compound(contours,path.rule));
  }
  warnings.push('Closed contour interpretation: closed stroke-only outlines count; stroke thickness is not part size or kerf.');
  const parts=entities.flatMap(contours=>contoursToParts(contours,fileName,'svg',options.tolerance,'holes'));
  if(entities.some(e=>e.length>1))warnings.push('Compound contours may produce separate part types. Holes follow the source fill rule.');
  if(parts.some(p=>p.holes.length))warnings.push('Holes are preserved; nesting inside holes is not supported.');
  if(!parts.length)throw Error('No visible closed vector outlines found.');
  let offset=0;for(const p of parts){p.preparationPosition=[offset,0];offset+=bounds(p.outer)[2]+10;}
  return {document:normalizeDocument({name:fileName.replace(/\.svg$/i,''),parts,settings:{...DEFAULT_SETTINGS}}),warnings,replace:false};
}
