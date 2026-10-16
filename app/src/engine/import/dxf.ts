import parseString from 'dxf/lib/parseString';
import {pointSegmentDistance} from '../geometry/world';
import {DEFAULT_SETTINGS,SHEET_LAYER,type Point,type Ring} from '../model';
import {apply,multiply,append,bulge,ellipse,nurbs,type Matrix} from '../geometry/flatten';
import {bounds,normalizeJob,normalizeRing,ringCrosses} from '../geometry/normalize';
import {contoursToParts} from './svg';
import {polygon,type Contour as FormatContour} from '../geometry/contour';
import {contour,lines,moveEnds,reverse,similar,transformPath,type Path} from './paths';
import type {ImportReview} from './sparrow';

type DxfPoint={x:number;y:number;z?:number;bulge?:number};
type DxfEntity={type:string;handle:string;layer?:string;x?:number;y?:number;z?:number;
  start?:DxfPoint;end?:DxfPoint;vertices?:DxfPoint[];closed?:boolean;r?:number;
  startAngle?:number;endAngle?:number;majorX?:number;majorY?:number;axisRatio?:number;
  block?:string;scaleX?:number;scaleY?:number;rotation?:number;rowCount?:number;columnCount?:number;rowSpacing?:number;columnSpacing?:number;
  extrusionZ?:number;controlPoints?:DxfPoint[];knots?:number[];degree?:number;weights?:number[]};
type DxfFile={entities:DxfEntity[];blocks:{name:string;x?:number;y?:number;entities:DxfEntity[]}[]};
type Group=[number,string];
type DxfRecord={type:string;groups:Group[];children:DxfRecord[];id:string;layer:string};
/** A closed outline as a polygon, for topology and checks, and as the format's contour to keep. */
type Contour={ring:Ring;entityId:string;curved:boolean;contour:FormatContour};
/** An open piece of an outline, joined to others at its ends. */
type Chain={points:Ring;id:string;curved:boolean;path:Path};
/** `curves`: keep them as curves, or flatten them into the parts' shapes. */
export type DXFOptions={scale:number;tolerance:number;enclosed:'holes'|'parts';layers?:string[];curves?:'keep'|'flatten'};
const value=(r:DxfRecord,code:number)=>r.groups.find(g=>g[0]===code)?.[1];
function finite(text:string|undefined,fallback?:number):number {
  if(text===undefined&&fallback!==undefined)return fallback;
  if(text===undefined||!text.trim()||!Number.isFinite(Number(text)))throw Error('Missing or non-finite DXF number.');
  return Number(text);
}
function scan(text:string):{records:DxfRecord[];units:number;text:string} {
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
    if(!['ENTITIES','BLOCKS'].includes(section)||code!==0)continue;
    // Stable handles let conversion diagnostics refer back to the guarded source record.
    groups.splice(i+1,0,[5,`studio-${raw.length+1}`]);
    const body:Group[]=[];while(groups[i+1]&&groups[i+1][0]!==0){const group=groups[++i];if(group[0]===5)group[1]=`studio-${raw.length+1}`;body.push(group);}
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
  return {records,units,text:groups.map(g=>g.join('\n')).join('\n')};
}
function guard(r:DxfRecord) {
  for(const entity of [r,...r.children]) {
    for(const [code,v] of entity.groups) {
      if(code>=10&&code<=59)finite(v);
      if(code>=60&&code<=99&&!/^[+-]?\d+$/.test(v))throw Error('Invalid integer DXF field.');
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
function join(chains:Chain[],issues:string[],keep:boolean):{contours:Contour[];gaps:number;adjustment:number} {
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
    const path:Path={start:[0,0],segments:[]};
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
      // The same piece in the format, run the way the walk goes, its ends where the pieces meet.
      const piece=moveEnds(current%2?reverse(chain.path):chain.path,entryPoint,exitPoint);
      if(!path.segments.length)path.start=entryPoint;
      path.segments.push(...piece.segments);
      curved ||= chain.curved;current=neighbors[exitIndex][0];
    }while(current!==i*2);
    if(walked.size!==component.size)throw Error('DXF component did not form a single closed chain.');
    // Closing a gap moves a curve's ends, and with them all of a large arc: contours with gaps over
    // a micrometre keep their approximation.
    contours.push({ring,entityId:[...component].map(e=>chains[e].id).join(' + '),curved:curved||componentAdjustment>0,contour:keep&&componentAdjustment<=1e-6?contour(path,ring):polygon(ring)});
  }
  return {contours,gaps,adjustment};
}
export function importDXF(text:string,fileName:string,options:DXFOptions):ImportReview {
  if(!Number.isFinite(options.scale)||options.scale<=0||!Number.isFinite(options.tolerance)||options.tolerance<=0)throw Error('Choose positive scale and approximation tolerance.');
  const source=scan(text),{records,units}=source,parsed=parseString(source.text) as DxfFile;
  const unitScales:Record<number,number>={1:25.4,2:304.8,4:1,5:10,6:1000,7:1_000_000,9:.0254,10:914.4,13:.001,14:100,15:10000};
  const scale=unitScales[units]??options.scale,warnings:string[]=[],issues:string[]=[],unsupported=new Map<string,number>();
  warnings.push(unitScales[units]?`DXF INSUNITS ${units}: one unit = ${scale} mm.`:`Missing or unsupported DXF INSUNITS ${units}. Using the selected ${scale} mm per drawing unit.`);
  const byHandle=new Map(records.map(r=>[r.id,r])),blocks=new Map(parsed.blocks.map(b=>[b.name,b]));
  const supported=['LINE','ARC','CIRCLE','ELLIPSE','LWPOLYLINE','POLYLINE','SPLINE','INSERT'];
  for(const r of records)if(!supported.includes(r.type)&&!['BLOCK','ENDBLK'].includes(r.type))unsupported.set(r.type,(unsupported.get(r.type)??0)+1);
  const layers:string[]=[],contours:Contour[]=[],chains:Chain[]=[];let totalVertices=0,expanded=0;
  const visit=(entity:DxfEntity,parent:Matrix,inheritedLayer:string,path:string[])=>{
    if(++expanded>10_000)throw Error('DXF exceeds 10,000 expanded entities.');
    const r=byHandle.get(entity.handle);if(!r||!supported.includes(entity.type))return;
    const layer=entity.layer&&entity.layer!=='0'?entity.layer:inheritedLayer;
    if(!layers.includes(layer))layers.push(layer);
    try {
      guard(r);
      if(entity.type==='INSERT') {
        if(!entity.block||path.includes(entity.block)||path.length>=32)throw Error('Missing, cyclic, or excessively nested block reference.');
        const block=blocks.get(entity.block);if(!block)throw Error(`Missing block ${entity.block}.`);
        const blockRecord=records.find(r=>r.type==='BLOCK'&&value(r,2)===block.name);if(blockRecord)guard(blockRecord);
        const rows=entity.rowCount??1,columns=entity.columnCount??1;
        if(![rows,columns].every(n=>Number.isInteger(n)&&n>0)||rows*columns>10_000)throw Error('Invalid or oversized INSERT array.');
        const sx=entity.scaleX??1,sy=entity.scaleY??1,angle=(entity.rotation??0)*Math.PI/180,c=Math.cos(angle),sn=Math.sin(angle);
        if(sx===0||sy===0)throw Error('INSERT scale must be nonzero.');
        // Compose base-point, scale, rotation and array offsets in DXF order.
        // Keep explicit child layers; only layer 0 inherits from its INSERT.
        const reflect:Matrix=[entity.extrusionZ===-1?-1:1,0,0,1,0,0];
        for(let row=0;row<rows;row++)for(let column=0;column<columns;column++) {
          const x=column*(entity.columnSpacing??0),y=row*(entity.rowSpacing??0);
          const transform:Matrix=[c*sx,sn*sx,-sn*sy,c*sy,(entity.x??0)+c*x-sn*y,(entity.y??0)+sn*x+c*y];
          const matrix=multiply(parent,multiply(reflect,multiply(transform,[1,0,0,1,-(block.x??0),-(block.y??0)])));
          for(const child of block.entities)visit(child,matrix,layer,[...path,block.name]);
        }
        return;
      }
      if(options.layers?!options.layers.includes(layer):layer===SHEET_LAYER)return;
      const matrix=entity.extrusionZ===-1&&['CIRCLE','ARC','LWPOLYLINE','POLYLINE'].includes(entity.type)?multiply(parent,[-1,0,0,1,0,0]):parent;
      const tolerance=options.tolerance/Math.hypot(matrix[0],matrix[1],matrix[2],matrix[3]);
      const point=(p:DxfPoint|undefined):Point=>{
        if(!p||![p.x,p.y,p.z??0].every(Number.isFinite)||p.z&&p.z!==0)throw Error('Invalid or nonplanar coordinates.');
        return [p.x,p.y];
      };
      // `local` is the outline in the format, curves kept, in the entity's own coordinates.
      let ring:Ring,closed=false,curved=false,local:Path|undefined,circle:{center:Point;radius:number}|undefined;
      if(entity.type==='LINE'){ring=[point(entity.start),point(entity.end)];local={start:ring[0],segments:[{type:'line',to:ring[1]}]};}
      else if(entity.type==='SPLINE'){const points=(entity.controlPoints??[]).map(point);ring=nurbs({points,knots:entity.knots??[],degree:entity.degree??0,weights:entity.weights},tolerance);curved=true;
        // The job format takes clamped curves only, whose ends are their first and last control points.
        const knots=entity.knots!,degree=entity.degree!,clamped=knots.slice(0,degree+1).every(k=>k===knots[0])&&knots.slice(-degree-1).every(k=>k===knots[knots.length-1]);
        if(clamped)local={start:points[0],segments:[{type:'nurbs',degree,control_points:points.slice(1),knots,...(entity.weights&&{weights:entity.weights})}]};}
      else if(['ARC','CIRCLE','ELLIPSE'].includes(entity.type)) {
        const center=point({x:entity.x!,y:entity.y!});let u:Point,v:Point;
        if(entity.type==='ELLIPSE') {
          u=[entity.majorX!,entity.majorY!];const ratio=entity.axisRatio!;
          if(!Number.isFinite(ratio)||ratio<=0||ratio>1||!Math.hypot(...u))throw Error('Invalid ellipse axes.');
          const sign=entity.extrusionZ===-1?-1:1;v=[-u[1]*ratio*sign,u[0]*ratio*sign];
        }else {
          const radius=entity.r!;if(!Number.isFinite(radius)||radius<=0)throw Error('Arc radius must be positive.');
          u=[radius,0];v=[0,radius];
        }
        const start=entity.type==='CIRCLE'?0:entity.startAngle!,end=entity.type==='CIRCLE'?2*Math.PI:entity.endAngle!;
        closed=entity.type==='CIRCLE'||entity.type==='ELLIPSE'&&Math.abs(end-start)>=2*Math.PI-1e-10;
        const sweep=closed?2*Math.PI:((end-start)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
        if(!Number.isFinite(start)||!Number.isFinite(sweep)||sweep===0)throw Error('Curve needs distinct finite start and end angles.');
        ring=[[center[0]+u[0]*Math.cos(start)+v[0]*Math.sin(start),center[1]+u[1]*Math.cos(start)+v[1]*Math.sin(start)]];
        ellipse(center,u,v,start,sweep,tolerance,ring);curved=true;if(closed)ring.pop();
        if(entity.type==='CIRCLE')circle={center,radius:u[0]};
        else if(entity.type==='ARC')local={start:ring[0],segments:[{type:'arc',to:[center[0]+u[0]*Math.cos(start+sweep),center[1]+u[0]*Math.sin(start+sweep)],bulge:Math.tan(sweep/4)}]};
      }else {
        const vertices=entity.vertices??[];
        if(vertices.length<2||vertices.length>5000)throw Error('Polyline needs 2–5,000 vertices.');
        const points=vertices.map(point);closed=!!entity.closed;ring=[points[0]];local={start:points[0],segments:[]};
        for(let i=0;i<points.length-(closed?0:1);i++) {const b=vertices[i].bulge??0,to=points[(i+1)%points.length];bulge(points[i],to,b,tolerance,ring);curved ||= b!==0;local.segments.push(b?{type:'arc',to,bulge:b}:{type:'line',to});}
        if(closed)ring.pop();
        if(r.groups.some(([code,v])=>[40,41,43].includes(code)&&finite(v)!==0))warnings.push(`${r.id}: polyline width is ignored; the centerline is the contour.`);
      }
      ring=ring.map(p=>apply(matrix,p));
      // Curves are kept where the transformation keeps them exact; otherwise their approximation is.
      const kept=options.curves==='keep'?transformPath(local??lines(ring),matrix)??undefined:undefined;
      const piece=local&&kept?kept:lines(ring);
      const exact=!!kept&&!!local;
      const scale=Math.hypot(matrix[0],matrix[1]);
      const keptCircle=options.curves==='keep'&&circle&&similar(matrix)?{type:'circle' as const,center:apply(matrix,circle.center),radius:circle.radius*scale}:undefined;
      if(ring.some(p=>!p.every(v=>Number.isFinite(v)&&Math.abs(v)<=100_000)))throw Error('Coordinates exceed the 100,000 mm limit.');
      totalVertices+=ring.length;if(totalVertices>100_000)throw Error('DXF exceeds 100,000 vertices.');
      if(closed)contours.push({ring,entityId:r.id,curved:curved&&!exact&&!keptCircle,contour:keptCircle??(exact?contour(piece,ring):polygon(ring))});
      else chains.push({points:ring,id:r.id,curved:curved&&!exact,path:piece});
    }catch(error){if(expanded>10_000||totalVertices>100_000)throw error;issues.push(`${r.id} on ${layer}: ${error instanceof Error?error.message:String(error)}`);}
  };
  for(const entity of parsed.entities)visit(entity,[scale,0,0,scale,0,0],'0',[]);
  layers.sort();
  const joined=join(chains,issues,options.curves==='keep');contours.push(...joined.contours);
  if(joined.gaps)warnings.push(`Joined ${joined.gaps} gaps within 0.01 mm; largest endpoint adjustment ${joined.adjustment} mm. Confirm this preview before importing.`);
  const valid:Contour[]=[];
  for(const c of contours)try{valid.push({...c,ring:normalizeRing(c.ring)});}catch(e){issues.push(`${c.entityId}: ${String(e)}`);}
  const rejected=new Set<number>();
  for(let i=0;i<valid.length;i++)for(let j=0;j<i;j++)if(ringCrosses(valid[i].ring,valid[j].ring)){rejected.add(i);rejected.add(j);issues.push(`${valid[i].entityId} and ${valid[j].entityId}: intersecting or duplicate loops.`);}
  const parts=contoursToParts(valid.filter((_,i)=>!rejected.has(i)),fileName,'dxf',options.tolerance+joined.adjustment,options.enclosed);
  for(const [type,count] of unsupported)warnings.push(`Excluded ${count} unsupported ${type} entities.`);
  if(parts.some(p=>p.shape.holes?.length))warnings.push('Holes are preserved; nesting inside holes is not supported.');
  const document={name:fileName.replace(/\.dxf$/i,''),parts,settings:{...DEFAULT_SETTINGS}};
  return {document:parts.length?normalizeJob(document):document,warnings,issues,layers};
}
