import polylabel from 'polylabel';
import polygonClipping from 'polygon-clipping';
import {DEFAULT_SETTINGS,LIMITS,POLICY,type Document,type Part,type Point} from '../model';
import {area,bounds,inside,normalizeDocument,normalizePart} from './normalize';

export type LabelPoint={id:string;point:Point;radius:number};
type Box={x:number;y:number;w:number;h:number};
const overlaps=(a:Box,b:Box,gap:number)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
const within=(b:Box)=>b.x>=-LIMITS.extent&&b.y>=-LIMITS.extent&&b.x+b.w<=LIMITS.extent&&b.y+b.h<=LIMITS.extent;

export function arrangePreparation(document:Document,pinnedIds:string[]=[],compact=false):Document {
  if(typeof document.name!=='string'||!Array.isArray(document.parts))throw Error('Invalid preparation document.');
  if(new Set(pinnedIds).size!==pinnedIds.length||pinnedIds.some(id=>!document.parts.some(p=>p.id===id)))throw Error('Select existing parts to keep in place.');
  if(!document.parts.length)return {...document,parts:[]};
  // Preparation is independent of a temporarily invalid nesting form.
  normalizeDocument({...document,settings:DEFAULT_SETTINGS,parts:document.parts.map(p=>({...p,quantity:1}))});
  const items=document.parts.map(part=>{const b=bounds(part.outer);return {part,b,box:{x:b[0]+part.preparationPosition[0],y:b[1]+part.preparationPosition[1],w:b[2]-b[0],h:b[3]-b[1]}};});
  const sizes=items.map(i=>Math.min(i.box.w,i.box.h)).sort((a,b)=>a-b);
  const gap=Math.max(1e-5,Math.min(20,sizes[Math.floor(sizes.length/2)]*.06));
  const placements=new Map<string,Box>();
  if(compact) {
    const width=Math.min(2*LIMITS.extent,Math.max(...items.map(i=>i.box.w),Math.sqrt(items.reduce((n,i)=>n+(i.box.w+gap)*(i.box.h+gap),0))*1.25));
    let x=0,y=0,rowHeight=0;
    for(const item of [...items].sort((a,b)=>b.box.h-a.box.h)) {
      if(x>0&&x+item.box.w>width){x=0;y+=rowHeight+gap;rowHeight=0;}
      placements.set(item.part.id,{...item.box,x,y});x+=item.box.w+gap;rowHeight=Math.max(rowHeight,item.box.h);
    }
    const maxX=Math.max(...[...placements.values()].map(b=>b.x+b.w)),maxY=y+rowHeight;
    const dx=maxX>LIMITS.extent?-maxX/2:0,dy=maxY>LIMITS.extent?-maxY/2:0;
    for(const b of placements.values()){b.x+=dx;b.y+=dy;}
  }else {
    for(const item of items.filter(i=>pinnedIds.includes(i.part.id))) {
      if(!within(item.box))throw Error('Selected parts lie outside the preparation area.');
      const world=(p:Part)=>[p.outer,...p.holes].map(r=>r.map(([x,y]):Point=>[x+p.preparationPosition[0],y+p.preparationPosition[1]]));
      for(const other of items.filter(i=>placements.has(i.part.id)&&overlaps(item.box,i.box,0))) {
        const intersection=polygonClipping.intersection(world(item.part),world(other.part));
        if(intersection.reduce((n,p)=>n+Math.abs(area(p[0]))-p.slice(1).reduce((m,r)=>m+Math.abs(area(r)),0),0)>POLICY.overlapMm2)throw Error('Selected parts overlap.');
      }
      placements.set(item.part.id,item.box);
    }
    const displaced:typeof items=[];
    for(const item of items.filter(i=>!pinnedIds.includes(i.part.id))) {
      if(within(item.box)&&![...placements.values()].some(b=>overlaps(item.box,b,gap*(1-1e-9))))placements.set(item.part.id,item.box);
      else displaced.push(item);
    }
    for(const item of displaced) {
      const occupied=[...placements.values()],free=(b:Box)=>within(b)&&!occupied.some(other=>overlaps(b,other,gap*(1-1e-9)));
      // ponytail: bounding-box separation reserves concave gaps; at 500 parts,
      // edge candidates keep this deterministic without a second nesting engine.
      const candidates:Box[]=[];
      const x=Math.max(-LIMITS.extent,Math.min(LIMITS.extent-item.box.w,item.box.x));
      const y=Math.max(-LIMITS.extent,Math.min(LIMITS.extent-item.box.h,item.box.y));
      candidates.push({...item.box,x,y});
      for(const b of occupied) {
        for(const px of [b.x-item.box.w-gap,b.x+b.w+gap]) {
          candidates.push({...item.box,x:px,y});
          for(const py of [b.y-item.box.h-gap,b.y+b.h+gap])candidates.push({...item.box,x:px,y:py});
        }
        for(const py of [b.y-item.box.h-gap,b.y+b.h+gap])candidates.push({...item.box,x,y:py});
      }
      candidates.sort((a,b)=>(a.x-item.box.x)**2+(a.y-item.box.y)**2-((b.x-item.box.x)**2+(b.y-item.box.y)**2));
      const placement=candidates.find(free);
      if(!placement) {
        if(!pinnedIds.length)return arrangePreparation(document,[],true);
        throw Error('Could not separate parts within the preparation area. Try arranging all parts or reducing their size.');
      }
      placements.set(item.part.id,placement);
    }
  }
  if([...placements.values()].some(b=>!within(b)))throw Error('Parts do not fit within the preparation area. Reduce their size.');
  return {...document,parts:items.map(({part,b})=>{const placed=placements.get(part.id)!;return {...part,preparationPosition:[placed.x-b[0],placed.y-b[1]]};})};
}

export function labelPoints(parts:Part[]):LabelPoint[] {
  if(!Array.isArray(parts)||parts.length>500||new Set(parts.map(p=>p.id)).size!==parts.length)throw Error('Invalid label parts.');
  let vertices=0;
  return parts.map(source=>{
    // Quantity can be temporarily blank while editing; only geometry matters here.
    const part=normalizePart({...source,quantity:1}),rings=[part.outer,...part.holes],b=bounds(part.outer);
    vertices+=rings.reduce((n,r)=>n+r.length,0);if(vertices>LIMITS.verticesTotal)throw Error('Label geometry exceeds 100,000 vertices.');
    const short=Math.min(b[2]-b[0],b[3]-b[1]),long=Math.max(b[2]-b[0],b[3]-b[1]);
    let point:Point,radius=0;
    if(long/short<=10000) {
      const p=polylabel(rings,short/100);point=[p[0],p[1]];radius=p.distance;
      if(radius>0&&inside(point,part.outer)&&!part.holes.some(h=>inside(point,h)))return {id:part.id,point,radius};
    }
    // Very thin parts would create millions of polylabel seed cells. A center
    // section gives an interior fallback; radius zero tells the UI not to fit text.
    const major=b[2]-b[0]>=b[3]-b[1]?0:1,minor=1-major,center=(b[major]+b[major+2])/2,crossings:number[]=[];
    for(const ring of rings)for(let i=0;i<ring.length;i++) {
      const a=ring[i],c=ring[(i+1)%ring.length];
      if((a[major]>center)!==(c[major]>center))crossings.push(a[minor]+(center-a[major])*(c[minor]-a[minor])/(c[major]-a[major]));
    }
    crossings.sort((a,c)=>a-c);let span=-1,coordinate=0;
    for(let i=0;i+1<crossings.length;i+=2)if(crossings[i+1]-crossings[i]>span){span=crossings[i+1]-crossings[i];coordinate=(crossings[i+1]+crossings[i])/2;}
    point=major===0?[center,coordinate]:[coordinate,center];
    if(span<=0||!inside(point,part.outer)||part.holes.some(h=>inside(point,h)))throw Error(`Could not locate an interior label for ${part.name}.`);
    return {id:part.id,point,radius};
  });
}
