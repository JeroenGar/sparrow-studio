import DxfParser from 'dxf-parser';
import type {IPoint} from 'dxf-parser/dist/entities/geomtry';
import type {ILwpolylineEntity} from 'dxf-parser/dist/entities/lwpolyline';
import type {IPolylineEntity} from 'dxf-parser/dist/entities/polyline';
import type {ILineEntity} from 'dxf-parser/dist/entities/line';
import type {IArcEntity} from 'dxf-parser/dist/entities/arc';
import {DEFAULT_SETTINGS,type Point,type Ring} from '../model';
import {append,ellipse} from '../geometry/flatten';
import {bounds,normalizeDocument,normalizeRing,ringCrosses} from '../geometry/normalize';
import {contoursToParts} from './svg';
import type {ImportReview} from './sparrow';

type Group=[number,string];
type DxfRecord={type:string;groups:Group[];children:DxfRecord[];id:string;layer:string};
type Contour={ring:Ring;entityId:string;curved:boolean};
type Chain={points:Ring;id:string;curved:boolean};
export type DXFOptions={scale:number;tolerance:number;enclosed:'holes'|'parts';layers?:string[]};
const value=(r:DxfRecord,code:number)=>r.groups.find(g=>g[0]===code)?.[1];
function finite(text:string|undefined,fallback?:number):number {
  if(text===undefined&&fallback!==undefined)return fallback;
  if(text===undefined||!text.trim()||!Number.isFinite(Number(text)))throw Error('Missing or non-finite DXF number.');
  return Number(text);
}
function scan(text:string):{records:DxfRecord[];units:number} {
  if(text.startsWith('AutoCAD Binary DXF')||text.includes('\0'))throw Error('Binary DXF is unsupported. Export ASCII DXF.');
  const lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r\n|\n|\r/);
  if(lines.length%2)throw Error('ASCII DXF must contain complete group-code/value pairs.');
  const groups:Group[]=[];
  for(let i=0;i<lines.length;i+=2) {
    const code=Number(lines[i].trim());
    if(!lines[i].trim()||!Number.isInteger(code)||code<0||code>1071)throw Error(`Invalid DXF group code at line ${i+1}.`);
    groups.push([code,lines[i+1].trim()]);
  }
  if(groups[groups.length-1]?.[0]!==0||groups[groups.length-1]?.[1]!=='EOF')throw Error('DXF is missing its EOF record.');
  let section='',units=0;const raw:DxfRecord[]=[];
  for(let i=0;i<groups.length;i++) {
    const [code,v]=groups[i];
    if(code===0&&v==='SECTION') {if(groups[i+1]?.[0]!==2)throw Error('Malformed DXF section.');section=groups[++i][1];continue;}
    if(code===0&&v==='ENDSEC') {section='';continue;}
    if(section==='HEADER'&&code===9&&v==='$INSUNITS')units=finite(groups[i+1]?.[1]);
    if(section!=='ENTITIES'||code!==0)continue;
    const body:Group[]=[];while(groups[i+1]&&groups[i+1][0]!==0)body.push(groups[++i]);
    const r:DxfRecord={type:v,groups:body,children:[],id:'',layer:''};r.id=value(r,5)??`${v} ${raw.length+1}`;r.layer=value(r,8)??'0';raw.push(r);
    if(raw.length>10_000)throw Error('DXF exceeds 10,000 entities including vertices.');
  }
  const records:DxfRecord[]=[];
  for(let i=0;i<raw.length;i++) {
    const r=raw[i];
    if(r.type==='POLYLINE') {
      while(raw[i+1]?.type==='VERTEX')r.children.push(raw[++i]);
      if(raw[i+1]?.type!=='SEQEND')throw Error(`${r.id}: POLYLINE lacks a terminating SEQEND.`);
      r.children.push(raw[++i]);
    }else if(['VERTEX','SEQEND'].includes(r.type))throw Error(`${r.id}: orphan ${r.type}.`);
    records.push(r);
  }
  return {records,units};
}
function guard(r:DxfRecord) {
  for(const entity of [r,...r.children]) {
    for(const [code,v] of entity.groups) {
      if(code>=10&&code<=59)finite(v);
      if((code>=30&&code<=38||code===39)&&finite(v)!==0)throw Error('Nonzero elevation, z coordinates, or thickness are unsupported.');
      if([210,220].includes(code)&&finite(v)!==0)throw Error('Non-XY extrusion is unsupported.');
      if(code===230&&![1,-1].includes(finite(v)))throw Error('Non-XY extrusion is unsupported.');
    }
    const flags=finite(value(entity,70),0);
    if(entity.type==='POLYLINE'&&(flags&~129)!==0)throw Error('Only ordinary 2D POLYLINE is supported; spline-fit, mesh and 3D flags are excluded.');
    if(entity.type==='VERTEX'&&flags!==0)throw Error('Only ordinary 2D VERTEX records are supported.');
  }
  if(r.type==='LWPOLYLINE') {
    const count=finite(value(r,90));
    if(!Number.isInteger(count)||count<2||count>5000||count!==r.groups.filter(g=>g[0]===10).length)throw Error('Invalid LWPOLYLINE vertex count.');
  }
}
const serialize=(r:DxfRecord):string=>`0\n${r.type}\n${r.groups.map(g=>g.join('\n')+'\n').join('')}${r.children.map(serialize).join('')}`;
function bulge(from:Point,to:Point,b:number,tolerance:number,output:Ring) {
  if(!Number.isFinite(b))throw Error('Non-finite polyline bulge.');
  const dx=to[0]-from[0],dy=to[1]-from[1],chord=Math.hypot(dx,dy);
  if(b===0||chord*Math.abs(b)/2<=tolerance) {append(output,to);return;}
  if(chord===0)throw Error('A bulged edge has coincident endpoints.');
  const k=(1-b*b)/(4*b),center:Point=[(from[0]+to[0])/2-dy*k,(from[1]+to[1])/2+dx*k],radius=chord*(1+b*b)/(4*Math.abs(b));
  ellipse(center,[radius,0],[0,radius],Math.atan2(from[1]-center[1],from[0]-center[0]),4*Math.atan(b),tolerance,output);
  output[output.length-1]=to;
}
function join(chains:Chain[],issues:string[]):{contours:Contour[];gaps:number;adjustment:number} {
  const endpoints=chains.flatMap((c,i)=>[{p:c.points[0],edge:i,end:0},{p:c.points[c.points.length-1],edge:i,end:1}]);
  const neighbors=endpoints.map(()=>[] as number[]),cells=new Map<string,number[]>();
  const tolerance=.01;
  for(let i=0;i<endpoints.length;i++) {
    const p=endpoints[i].p,x=Math.floor(p[0]/tolerance),y=Math.floor(p[1]/tolerance);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of cells.get(`${x+dx},${y+dy}`)??[]) {
      const q=endpoints[j].p;if(Math.hypot(p[0]-q[0],p[1]-q[1])<=tolerance){neighbors[i].push(j);neighbors[j].push(i);}
    }
    const key=`${x},${y}`;cells.set(key,[...(cells.get(key)??[]),i]);
  }
  const visited=new Set<number>(),contours:Contour[]=[];let gaps=0,adjustment=0;
  for(let i=0;i<chains.length;i++) {
    if(visited.has(i))continue;
    const component=new Set<number>([i]),queue=[i];
    for(let at=0;at<queue.length;at++)for(const e of [queue[at]*2,queue[at]*2+1])for(const neighbor of neighbors[e]) {
      const edge=endpoints[neighbor].edge;if(!component.has(edge)){component.add(edge);queue.push(edge);}
    }
    for(const edge of component)visited.add(edge);
    if([...component].some(edge=>neighbors[edge*2].length!==1||neighbors[edge*2+1].length!==1)) {
      issues.push(`${[...component].map(e=>chains[e].id).join(', ')}: open ends or ambiguous junctions within 0.01 mm. Exclude these contours or repair the source.`);continue;
    }
    let current=i*2;const ring:Ring=[];let curved=false,componentAdjustment=0;
    const walked=new Set<number>();
    do {
      const edge=endpoints[current].edge;if(walked.has(edge))throw Error('DXF chain traversal revisited an edge.');walked.add(edge);
      const chain=chains[edge],points=current%2?[...chain.points].reverse():chain.points;
      const entryNeighbor=endpoints[neighbors[current][0]].p,entry=points[0];
      const exitIndex=edge*2+(current%2?0:1),exit=points[points.length-1],exitNeighbor=endpoints[neighbors[exitIndex][0]].p;
      const entryPoint:Point=[(entry[0]+entryNeighbor[0])/2,(entry[1]+entryNeighbor[1])/2];
      const exitPoint:Point=[(exit[0]+exitNeighbor[0])/2,(exit[1]+exitNeighbor[1])/2];
      const gap=Math.hypot(exit[0]-exitNeighbor[0],exit[1]-exitNeighbor[1]);
      if(gap>0){gaps++;adjustment=Math.max(adjustment,gap/2);componentAdjustment=Math.max(componentAdjustment,gap/2);}
      for(const p of [entryPoint,...points.slice(1,-1),exitPoint])append(ring,p);
      curved ||= chain.curved;current=neighbors[exitIndex][0];
    }while(current!==i*2);
    if(walked.size!==component.size)throw Error('DXF component did not form a single closed chain.');
    contours.push({ring,entityId:[...component].map(e=>chains[e].id).join(' + '),curved:curved||componentAdjustment>0});
  }
  return {contours,gaps,adjustment};
}
export function importDXF(text:string,fileName:string,options:DXFOptions):ImportReview {
  if(!Number.isFinite(options.scale)||options.scale<=0||!Number.isFinite(options.tolerance)||options.tolerance<=0)throw Error('Choose positive scale and approximation tolerance.');
  const {records,units}=scan(text),unitScales:Record<number,number>={1:25.4,2:304.8,4:1,5:10,6:1000,7:1_000_000,9:.0254,10:914.4,13:.001,14:100,15:10000};
  const scale=unitScales[units]??options.scale,warnings:string[]=[],issues:string[]=[],unsupported=new Map<string,number>();
  warnings.push(unitScales[units]?`DXF INSUNITS ${units}: one unit = ${scale} mm.`:`Missing or unsupported DXF INSUNITS ${units}. Using the selected ${scale} mm per drawing unit.`);
  const layers=[...new Set(records.map(r=>r.layer))].sort();
  const contours:Contour[]=[],chains:Chain[]=[];let totalVertices=0;
  for(const r of records) {
    if(options.layers&&!options.layers.includes(r.layer))continue;
    if(!['LINE','ARC','CIRCLE','LWPOLYLINE','POLYLINE'].includes(r.type)){unsupported.set(r.type,(unsupported.get(r.type)??0)+1);continue;}
    try {
      guard(r);
      // Parse only guarded entities. In particular malformed POLYLINE sequences
      // never reach dxf-parser's unbounded sequence loop.
      const entity=new DxfParser().parseSync(`0\nSECTION\n2\nENTITIES\n${serialize(r)}0\nENDSEC\n0\nEOF\n`)?.entities[0];
      if(!entity)throw Error('DXF parser returned no entity.');
      const sign=finite(value(r,230),1),point=(p:IPoint):Point=>{
        if(!p||![p.x,p.y,p.z??0].every(Number.isFinite)||p.z&&p.z!==0)throw Error('Invalid or nonplanar coordinates.');
        return [p.x*scale,p.y*scale];
      };
      let ring:Ring,closed=false,curved=false;
      if(r.type==='LINE') {
        const line=entity as ILineEntity;if(line.vertices.length!==2)throw Error('LINE needs two endpoints.');ring=line.vertices.map(point);
      }else if(r.type==='ARC'||r.type==='CIRCLE') {
        const arc=entity as IArcEntity,center=point(arc.center),radius=arc.radius*scale;
        if(!Number.isFinite(radius)||radius<=0)throw Error('Arc radius must be positive.');
        const start=r.type==='CIRCLE'?0:arc.startAngle;
        const delta=r.type==='CIRCLE'?2*Math.PI:((arc.endAngle-start)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
        if(!Number.isFinite(start)||!Number.isFinite(delta)||delta===0)throw Error('ARC needs distinct finite start and end angles.');
        ring=[[center[0]+radius*Math.cos(start),center[1]+radius*Math.sin(start)]];
        ellipse(center,[radius,0],[0,radius],start,delta,options.tolerance,ring);closed=r.type==='CIRCLE';curved=true;if(closed)ring.pop();
      }else {
        const poly=entity as ILwpolylineEntity|IPolylineEntity;
        if(poly.vertices.length<2||poly.vertices.length>5000)throw Error('Polyline needs 2–5,000 vertices.');
        const points=poly.vertices.map(point);closed=poly.shape;ring=[points[0]];
        for(let i=0;i<points.length-(closed?0:1);i++) {const b=poly.vertices[i].bulge??0;bulge(points[i],points[(i+1)%points.length],b,options.tolerance,ring);curved ||= b!==0;}
        if(closed)ring.pop();
        if(r.groups.some(([code,v])=>[40,41,43].includes(code)&&finite(v)!==0))warnings.push(`${r.id}: polyline width is ignored; the centerline is the contour.`);
      }
      if(r.type!=='LINE'&&sign===-1)ring=ring.map(([x,y])=>[-x,y]);
      if(ring.some(p=>!p.every(v=>Number.isFinite(v)&&Math.abs(v)<=100_000)))throw Error('Coordinates exceed the 100,000 mm limit.');
      totalVertices+=ring.length;if(totalVertices>100_000)throw Error('DXF exceeds 100,000 vertices.');
      if(closed)contours.push({ring,entityId:r.id,curved});else chains.push({points:ring,id:r.id,curved});
    }catch(error){issues.push(`${r.id} on ${r.layer}: ${error instanceof Error?error.message:String(error)}`);}
  }
  const joined=join(chains,issues);contours.push(...joined.contours);
  if(joined.gaps)warnings.push(`Joined ${joined.gaps} gaps within 0.01 mm; largest endpoint adjustment ${joined.adjustment} mm. Confirm this preview before importing.`);
  const valid:Contour[]=[];
  for(const c of contours)try{valid.push({...c,ring:normalizeRing(c.ring)});}catch(e){issues.push(`${c.entityId}: ${String(e)}`);}
  const rejected=new Set<number>();
  for(let i=0;i<valid.length;i++)for(let j=0;j<i;j++)if(ringCrosses(valid[i].ring,valid[j].ring)){rejected.add(i);rejected.add(j);issues.push(`${valid[i].entityId} and ${valid[j].entityId}: intersecting or duplicate loops.`);}
  const parts=contoursToParts(valid.filter((_,i)=>!rejected.has(i)),fileName,'dxf',options.tolerance+joined.adjustment,options.enclosed);
  let offset=0;for(const p of parts){p.preparationPosition=[offset,0];offset+=bounds(p.outer)[2]+10;}
  for(const [type,count] of unsupported)warnings.push(`Excluded ${count} unsupported ${type} entities.`);
  if(parts.some(p=>p.holes.length))warnings.push('Holes are preserved; nesting inside holes is not supported.');
  const document={name:fileName.replace(/\.dxf$/i,''),parts,settings:{...DEFAULT_SETTINGS}};
  return {document:parts.length?normalizeDocument(document):document,warnings,issues,layers,replace:false};
}
