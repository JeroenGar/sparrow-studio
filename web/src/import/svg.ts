import { DOMParser, type Element as XMLElement } from '@xmldom/xmldom';
import svgpath from 'svgpath';
import { DEFAULT_SETTINGS,newPart,type Part,type Point,type Ring } from '../model';
import { area,bounds,inside,normalizeDocument,normalizeRing,ringCrosses } from '../geometry/normalize';
import { IDENTITY,apply,multiply,append,bezier,ellipse,svgArc,type Matrix } from '../geometry/flatten';
import { localize,type ImportReview } from './sparrow';

type Contour={ring:Ring;entityId:string;curved:boolean};
export type SVGOptions={scale:number;tolerance:number;enclosed:'holes'|'parts'};
const numeric=/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g;
function numbers(text:string):number[] {
  const matches=text.match(numeric) ?? [];
  if(text.replace(numeric,'').replace(/[\s,]/g,'') || matches.some(v=>!Number.isFinite(Number(v)))) throw Error(`Invalid numeric list: ${text.slice(0,60)}`);
  return matches.map(Number);
}
function length(text:string|undefined,fallback=0):number {
  if(text===undefined || text==='')return fallback;
  const match=text.trim().match(/^([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?)(mm|cm|in|pt|pc|px)?$/);
  if(!match)throw Error(`Unsupported or ambiguous SVG length: ${text}`);
  const factors:Record<string,number>={mm:96/25.4,cm:960/25.4,in:96,pt:96/72,pc:16,px:1};
  const result=Number(match[1])*(factors[match[2]??'px']);
  if(!Number.isFinite(result))throw Error('Non-finite SVG length.');return result;
}
const attr=(e:XMLElement,name:string)=>e.hasAttribute(name)?e.getAttribute(name)!:undefined;
export function parseTransform(text=''):Matrix {
  let result=IDENTITY,consumed='';
  for(const match of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    consumed+=match[0];const v=numbers(match[2]);let next:Matrix;
    const rad=(v[0]??0)*Math.PI/180;
    switch(match[1]) {
      case 'matrix':if(v.length!==6)throw Error('matrix() needs six values.');next=v as Matrix;break;
      case 'translate':if(v.length<1||v.length>2)throw Error('translate() needs one or two values.');next=[1,0,0,1,v[0],v[1]??0];break;
      case 'scale':if(v.length<1||v.length>2)throw Error('scale() needs one or two values.');next=[v[0],0,0,v[1]??v[0],0,0];break;
      case 'rotate': {
        if(v.length!==1&&v.length!==3)throw Error('rotate() needs one or three values.');
        const c=Math.cos(rad),s=Math.sin(rad),x=v[1]??0,y=v[2]??0;next=[c,s,-s,c,x-c*x+s*y,y-s*x-c*y];break;
      }
      case 'skewX':case 'skewY':if(v.length!==1)throw Error('Skew needs one value.');next=match[1]==='skewX'?[1,0,Math.tan(rad),1,0,0]:[1,Math.tan(rad),0,1,0,0];break;
      default:throw Error(`Unsupported transform ${match[1]}.`);
    }
    result=multiply(result,next);
  }
  if(consumed.replace(/[\s,]/g,'')!==text.replace(/[\s,]/g,'') || !result.every(Number.isFinite) || result[0]*result[3]-result[1]*result[2]===0)throw Error('Malformed or singular SVG transform.');
  return result;
}
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
function pathContours(d:string,m:Matrix,tolerance:number,id:string):Contour[] {
  const parsed=svgpath(d).abs().unshort();
  const parseError=(parsed as unknown as {err?:string}).err;if(parseError)throw Error(parseError);
  const contours:Contour[]=[];let ring:Ring=[],start:Point=[0,0],current:Point=[0,0],curved=false,closed=false;
  const finish=()=>{if(ring.length){if(!closed)throw Error('Open path cannot become a part. Close it or remove it in the source drawing.');contours.push({ring,entityId:id,curved});ring=[];}};
  parsed.iterate(segment=>{
    const cmd=segment[0].toUpperCase(),v=segment.slice(1) as number[];
    if(!v.every(Number.isFinite))throw Error('Non-finite path command.');
    switch(cmd) {
      case 'M':finish();start=[v[0],v[1]];current=start;ring=[apply(m,start)];closed=false;curved=false;break;
      case 'L':current=[v[0],v[1]];append(ring,apply(m,current));closed=false;break;
      case 'H':current=[v[0],current[1]];append(ring,apply(m,current));closed=false;break;
      case 'V':current=[current[0],v[0]];append(ring,apply(m,current));closed=false;break;
      case 'C':bezier([current,[v[0],v[1]],[v[2],v[3]],[v[4],v[5]]].map(p=>apply(m,p as Point)),tolerance,ring);current=[v[4],v[5]];curved=true;closed=false;break;
      case 'Q':bezier([current,[v[0],v[1]],[v[2],v[3]]].map(p=>apply(m,p as Point)),tolerance,ring);current=[v[2],v[3]];curved=true;closed=false;break;
      case 'A':svgArc(current,[v[5],v[6]],v[0],v[1],v[2],v[3],v[4],m,tolerance,ring);current=[v[5],v[6]];curved=true;closed=false;break;
      case 'Z':current=start;closed=true;break;
      default:throw Error(`Unsupported path command ${cmd}.`);
    }
  });
  finish();return contours;
}
export function importSVG(text:string,fileName:string,options:SVGOptions):ImportReview {
  if(!Number.isFinite(options.scale)||options.scale<=0||!Number.isFinite(options.tolerance)||options.tolerance<=0||options.tolerance>100)throw Error('Scale and approximation tolerance must be positive finite numbers.');
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG entities and DOCTYPE declarations are forbidden.');
  if(/<\?xml-stylesheet\b/i.test(text))throw Error('SVG stylesheets are unsupported. Remove the stylesheet and use explicit geometry.');
  const document=new DOMParser({onError:(_level,message)=>{throw Error(`Invalid SVG XML: ${message}`);}}).parseFromString(text,'image/svg+xml');
  const root=document.documentElement;if(!root||root.localName!=='svg')throw Error('Expected an SVG root element.');
  const ids=new Map<string,XMLElement>(),warnings:string[]=[],unsupported=new Map<string,number>();
  let nodes=0;
  const inspect=(node:XMLElement,depth:number)=>{
    if(++nodes>10_000||depth>64)throw Error('SVG exceeds 10,000 elements or XML depth 64.');
    if(['script','foreignObject','style','animate','animateTransform','set'].includes((node.localName ?? node.tagName)))throw Error(`SVG ${(node.localName ?? node.tagName)} is forbidden.`);
    if((node.localName ?? node.tagName)==='svg'&&node!==root)throw Error('Nested SVG viewports are not supported.');
    if(node.namespaceURI && node.namespaceURI!=='http://www.w3.org/2000/svg') {
      if((node.localName ?? node.tagName)==='metadata')return;
      throw Error(`Unsupported SVG namespace on ${(node.localName ?? node.tagName)}.`);
    }
    for(let i=0;i<node.attributes.length;i++) {
      const a=node.attributes.item(i)!;
      if(a.name==='xml:base')throw Error('SVG xml:base references are unsupported. Use local references only.');
      if(/^on/i.test(a.name)||/url\s*\(/i.test(a.value)||(['href','xlink:href'].includes(a.name)&&!a.value.startsWith('#')))throw Error(`Forbidden event handler or external reference in ${(node.localName ?? node.tagName)}.`);
      if(['clip-path','mask','filter'].includes(a.name)&&a.value!=='none')throw Error(`${a.name} changes contour interpretation and is unsupported.`);
      if(a.name==='style') {
        for(const entry of a.value.split(';').filter(s=>s.trim())) {
          const [key,value,...extra]=entry.split(':');
          // Root viewport fitting changes presentation, not the declared millimetre geometry.
          if(!extra.length&&node===root&&['width','height'].includes(key.trim())&&value?.trim()==='100%')continue;
          if(extra.length||value===undefined||!['fill','stroke','stroke-width','fill-rule','opacity','stroke-opacity','fill-opacity'].includes(key.trim()))throw Error('CSS-driven geometry, transforms, and unsupported style properties must be removed.');
        }
      }
    }
    const id=attr(node,'id');if(id){if(ids.has(id))throw Error(`Duplicate SVG ID ${id}.`);ids.set(id,node);}
    if((node.localName ?? node.tagName)==='metadata')return;
    for(let child=node.firstChild;child;child=child.nextSibling)if(child.nodeType===1)inspect(child as XMLElement,depth+1);
  };
  inspect(root,0);
  const vb=attr(root,'viewBox')?numbers(attr(root,'viewBox')!):undefined;
  if(vb&&(vb.length!==4||vb[2]<=0||vb[3]<=0))throw Error('viewBox must contain x, y, positive width and height.');
  const rw=attr(root,'width'),rh=attr(root,'height'),ambiguous=(!rw&&!rh)||[rw,rh].some(v=>v?.includes('%'));
  let w:number,h:number,m:Matrix;
  if(vb) {
    w=ambiguous?vb[2]*options.scale:rw?length(rw)*25.4/96:length(rh)*25.4/96*vb[2]/vb[3];
    h=ambiguous?vb[3]*options.scale:rh?length(rh)*25.4/96:w*vb[3]/vb[2];
    const par=attr(root,'preserveAspectRatio')??'xMidYMid meet';
    let sx=w/vb[2],sy=h/vb[3],tx=-vb[0]*sx,ty=-vb[1]*sy;
    if(par.trim()!=='none') {
      const match=par.trim().match(/^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/);if(!match)throw Error('Unsupported preserveAspectRatio value.');
      sx=sy=match[3]==='slice'?Math.max(sx,sy):Math.min(sx,sy);tx=-vb[0]*sx+(w-vb[2]*sx)*({xMin:0,xMid:.5,xMax:1}[match[1]]!);ty=-vb[1]*sy+(h-vb[3]*sy)*({YMin:0,YMid:.5,YMax:1}[match[2]]!);
      if(match[3]==='slice')warnings.push('preserveAspectRatio slice scaling is honored. Complete cutting contours are imported; viewport cropping is not applied.');
    }
    m=[sx,0,0,sy,tx,ty];
  } else {
    if(!ambiguous && (!rw||!rh))throw Error('SVG without viewBox needs both root dimensions or an explicit drawing-unit scale.');
    w=ambiguous?0:length(rw)*25.4/96;h=ambiguous?0:length(rh)*25.4/96;
    const scale=ambiguous?options.scale:25.4/96;m=[scale,0,0,scale,0,0];
  }
  if(ambiguous)warnings.push(`Root SVG size is ambiguous. Using the selected ${options.scale} mm per drawing unit.`);
  else if(w<=0||h<=0)throw Error('SVG root dimensions must be positive.');
  m=multiply([1,0,0,-1,0,h],m);
  const entities:Contour[][]=[];let expanded=0,totalVertices=0;
  const walk=(node:XMLElement,parent:Matrix,inheritedRule:'evenodd'|'nonzero',stack:string[],referenced=false)=>{
    if(++expanded>10_000||stack.length>32)throw Error('SVG references exceed depth 32 or 10,000 expanded entities.');
    const tag=(node.localName ?? node.tagName),id=attr(node,'id')??`${tag} ${expanded}`,matrix=multiply(parent,parseTransform(attr(node,'transform')));
    let rule=attr(node,'fill-rule')??inheritedRule;
    const inline=attr(node,'style')?.match(/(?:^|;)\s*fill-rule\s*:\s*([^;]+)/);if(inline)rule=inline[1].trim();
    if(rule!=='evenodd'&&rule!=='nonzero')throw Error(`${id}: invalid fill-rule.`);
    if(tag==='g'&&attr(node,'data-sparrow-decoration')==='true')return;
    if(['metadata','title','desc'].includes(tag)||tag==='defs'&&!referenced)return;
    if(tag==='use') {
      const href=attr(node,'href')??attr(node,'xlink:href');if(!href?.startsWith('#'))throw Error(`${id}: use requires a local reference.`);
      if(stack.includes(href))throw Error(`${id}: cyclic SVG reference.`);
      const target=ids.get(href.slice(1));if(!target)throw Error(`${id}: missing reference ${href}.`);
      walk(target,multiply(matrix,[1,0,0,1,length(attr(node,'x')),length(attr(node,'y'))]),rule,[...stack,href],true);return;
    }
    if(['svg','g','defs'].includes(tag)) {
      const before=entities.length;
      for(let child=node.firstChild;child;child=child.nextSibling)if(child.nodeType===1)walk(child as XMLElement,matrix,rule,stack);
      if(tag==='g'&&entities.length-before>1)warnings.push(`${id}: group contours are independent parts, not a rigid assembly.`);
      return;
    }
    let contours:Contour[]=[];
    try {
      if(tag==='path') contours=pathContours(attr(node,'d')??'',matrix,options.tolerance,id);
      else if(tag==='polygon'||tag==='polyline') {
        const v=numbers(attr(node,'points')??'');if(v.length%2)throw Error('Odd coordinate count.');
        const ring:Ring=[];for(let i=0;i<v.length;i+=2)append(ring,apply(matrix,[v[i],v[i+1]]));
        if(tag==='polyline'&&(ring.length<2||ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1]))throw Error('Open polyline cannot become a part.');
        contours=[{ring,entityId:id,curved:false}];
      } else if(tag==='rect') {
        const x=length(attr(node,'x')),y=length(attr(node,'y')),width=length(attr(node,'width')),height=length(attr(node,'height'));
        if(width<=0||height<=0)throw Error('Rectangle dimensions must be positive.');
        let rx=length(attr(node,'rx'),length(attr(node,'ry'))),ry=length(attr(node,'ry'),rx);
        if(rx<0||ry<0)throw Error('Rounded rectangle radii must be nonnegative.');rx=Math.min(rx,width/2);ry=Math.min(ry,height/2);
        if(rx===0||ry===0)contours=[{ring:[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(p=>apply(matrix,p as Point)),entityId:id,curved:false}];
        else contours=pathContours(`M${x+rx} ${y}H${x+width-rx}A${rx} ${ry} 0 0 1 ${x+width} ${y+ry}V${y+height-ry}A${rx} ${ry} 0 0 1 ${x+width-rx} ${y+height}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+height-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`,matrix,options.tolerance,id);
      } else if(tag==='circle'||tag==='ellipse') {
        const cx=length(attr(node,'cx')),cy=length(attr(node,'cy')),rx=length(attr(node,tag==='circle'?'r':'rx')),ry=tag==='circle'?rx:length(attr(node,'ry'));
        if(rx<=0||ry<=0)throw Error('Ellipse radii must be positive.');
        const center=apply(matrix,[cx,cy]),origin=apply(matrix,[0,0]),u=apply(matrix,[rx,0]),v=apply(matrix,[0,ry]),ring:Ring=[apply(matrix,[cx+rx,cy])];
        ellipse(center,[u[0]-origin[0],u[1]-origin[1]],[v[0]-origin[0],v[1]-origin[1]],0,2*Math.PI,options.tolerance,ring);ring.pop();contours=[{ring,entityId:id,curved:true}];
      } else {unsupported.set(tag,(unsupported.get(tag)??0)+1);return;}
      totalVertices+=contours.reduce((n,c)=>n+c.ring.length,0);if(totalVertices>100_000)throw Error('SVG exceeds 100,000 vertices.');
      entities.push(compound(contours,rule));
    } catch(error) {throw Error(`${id}: ${error instanceof Error?error.message:String(error)}`);}
  };
  walk(root,m,'nonzero',[]);
  for(const [tag,count] of unsupported)warnings.push(`Excluded ${count} unsupported ${tag} element${count===1?'':'s'}.`);
  warnings.push('Closed contour interpretation: closed stroke-only outlines count; stroke thickness is not part size or kerf.');
  const parts=options.enclosed==='holes'?contoursToParts(entities.flat(),fileName,'svg',options.tolerance,'holes'):
    entities.flatMap(contours=>contoursToParts(contours,fileName,'svg',options.tolerance,'holes'));
  if(entities.some(e=>e.length>1))warnings.push('Compound contours may produce separate part types. Holes follow the source fill rule.');
  if(parts.some(p=>p.holes.length))warnings.push('Holes are preserved; nesting inside holes is not supported.');
  let offset=0;for(const p of parts){p.preparationPosition=[offset,0];offset+=bounds(p.outer)[2]+10;}
  return {document:normalizeDocument({name:fileName.replace(/\.svg$/i,''),parts,settings:{...DEFAULT_SETTINGS}}),warnings,replace:false};
}
