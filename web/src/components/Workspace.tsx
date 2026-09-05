import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Document, Part, Point, Result } from '../model';
import { bounds } from '../geometry/normalize';
import { worldParts } from '../geometry/validate';
import { pathData } from '../geometry/path';
import type {LiveGeometry} from '../geometry/live';
import {selectionBounds,type GeometryEdit} from '../geometry/manipulate';
import {moveDelta,resizeEdit,rotationEdit,screenTransform,pinchCamera,type Camera} from '../geometry/gestures';
import {geometryTask} from '../workers/geometryTask';
import type {LabelPoint} from '../geometry/preparation';
import {displayLength,unitScale,type DisplayUnit} from '../units';
import './Workspace.css';
import {coordinateGrid} from '../geometry/grid';

type Gesture={backgroundStart?:Point;pointer:number;start:Point;parts:{id:string;position:Point}[];delta:Point;anchor:Point;transform?:{kind:'scale'|'rotate';pivot:Point;edit?:GeometryEdit}};

import {colors} from '../colors';
export {colors} from '../colors';
export default function Workspace({document:doc,result,live,view,selected,onSelect,onMove,onTransform,disabled,polygon,onDraw,fitRequest,unit:displayUnit='mm',materialWidthFocused=false}: {
  materialWidthFocused?:boolean;unit?:DisplayUnit;fitRequest:number;document:Document;result?:Result;view:'prepare'|'result';selected:string[];
  live?:LiveGeometry & {sequence:number};
  onSelect:(id?:string,toggle?:boolean)=>void;onMove:(positions:{id:string;position:Point}[])=>void|Promise<void>;disabled:boolean;
  onTransform:(edit:GeometryEdit)=>void|Promise<void>;
  polygon?:Point[];onDraw?:(point:Point)=>void;
}) {
  const svg=useRef<SVGSVGElement>(null),space=useRef(false);
  const touches=useRef(new Map<number,Point>());
  const pinch=useRef<{camera:Camera;size:{width:number;height:number};start:[Point,Point]}|undefined>(undefined);
  const touchDraw=useRef<{pointer:number;screen:Point;world:Point}|undefined>(undefined);
  const [outlines,setOutlines]=useState(false);
  const [labels,setLabels]=useState(new Map<string,LabelPoint>());
  const labelCache=useRef(new Map<string,{outer:Part['outer'];holes:Part['holes'];label:LabelPoint}>());
  useEffect(()=>{
    const missing=doc.parts.filter(p=>{const cached=labelCache.current.get(p.id);return !cached||cached.outer!==p.outer||cached.holes!==p.holes;});
    const ids=new Set(doc.parts.map(p=>p.id));
    for(const id of labelCache.current.keys())if(!ids.has(id))labelCache.current.delete(id);
    if(!missing.length)return;
    let cancelled=false;
    void geometryTask({type:'label-points',runId:0,documentRevision:0,parts:missing}).then(reply=>{
      if(cancelled||reply.type!=='label-points')return;
      reply.points.forEach((label,i)=>labelCache.current.set(label.id,{outer:missing[i].outer,holes:missing[i].holes,label}));
      setLabels(new Map([...labelCache.current].map(([id,value])=>[id,value.label])));
    }).catch(()=>{/* Degenerate labels do not block editing; quantities remain in the parts list. */});
    return()=>{cancelled=true;};
  },[doc.parts]);
  const [snapping,setSnapping]=useState(true),[grid,setGrid]=useState(1),[angleStep,setAngleStep]=useState(15);
  const [size,setSize]=useState({width:800,height:500});
  const [camera,setCamera]=useState({x:-20,y:-120,w:220,h:160});
  const [drag,setDrag]=useState<Gesture>(),[pending,setPending]=useState<Gesture>();
  const displayedDrag=drag??pending;
  const selection=selectionBounds(doc,selected),unit=Math.max(camera.w/size.width,camera.h/size.height);
  const coordinates=coordinateGrid(camera,size.width,size.height,unitScale(displayUnit));
  const showWidth=materialWidthFocused&&Number.isFinite(doc.settings.materialWidthMm)&&doc.settings.materialWidthMm>0;
  const preview=displayedDrag?.transform?.edit,hit=(size.width<700?22:11)*unit;
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(svg.current!);return()=>observer.disconnect();},[]);
  const moved=useMemo(()=>new Map(displayedDrag?.parts.map(p=>[p.id,[p.position[0]+displayedDrag.delta[0],p.position[1]+displayedDrag.delta[1]] as Point])),[displayedDrag]);
  const world=useMemo(()=>view==='result'&&result?(live?.world??worldParts(doc,result)):undefined,[view,result,live?.world,doc]);
  const drawings=useMemo(()=>{
    const parts=world?.map(p=>({...p,position:[0,0] as Point})) ?? doc.parts.map(p=>({...p,partId:p.id,copyIndex:0,position:p.preparationPosition}));
    return parts.map(p=>({...p,index:doc.parts.findIndex(part=>part.id===p.partId),path:pathData([p.outer,...p.holes]),box:bounds(p.outer)}));
  },[world,doc.parts]);
  function fit() {
    const all=drawings.flatMap(p=>p.outer.map(([x,y])=>[x+p.position[0],-y-p.position[1]] as Point));
    if(world) all.push([0,0],[result!.usedLengthMm,-doc.settings.materialWidthMm]);
    if(!all.length) return;
    const [x0,y0,x1,y1]=bounds(all),pad=Math.max(x1-x0,y1-y0)*0.07+2;
    setCamera({x:x0-pad,y:y0-pad,w:x1-x0+2*pad,h:y1-y0+2*pad});
  }
  useEffect(fit,[view,doc.parts.length,!!world,fitRequest]);
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDrag(undefined);touches.current.clear();pinch.current=undefined;touchDraw.current=undefined;}if(e.code==='Space' && e.target===document.body) {space.current=true;e.preventDefault();}};
    const up=(e:KeyboardEvent)=>{if(e.code==='Space') space.current=false;};
    const blur=()=>{space.current=false;setDrag(undefined);touches.current.clear();pinch.current=undefined;touchDraw.current=undefined;};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
    return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
  },[]);
  function point(x:number,y:number):Point {
    const p=new DOMPoint(x,y).matrixTransform(svg.current!.getScreenCTM()!.inverse());return [p.x,p.y];
  }
  function zoom(factor:number,at:Point=[camera.x+camera.w/2,camera.y+camera.h/2]) {
    const fx=(at[0]-camera.x)/camera.w,fy=(at[1]-camera.y)/camera.h;
    setCamera(previous=>previous.w*factor<0.01||previous.w*factor>1e7?previous:({x:previous.x+fx*previous.w*(1-factor),y:previous.y+fy*previous.h*(1-factor),w:previous.w*factor,h:previous.h*factor}));
  }
  useEffect(()=>{
    const element=svg.current!;
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom(Math.exp(Math.max(-1,Math.min(1,e.deltaY/500))),point(e.clientX,e.clientY));};
    element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
  },[camera]);
  const shapes=useMemo(()=>drawings.map(p=>{
        const index=p.index,active=selected.includes(p.partId);
        const pos=moved.get(p.partId)??p.position;
        const [x0,y0,x1,y1]=p.box,label=!world?labels.get(p.partId):undefined;
        const quantity=doc.parts[index]?.quantity,copyText=Number.isInteger(quantity)&&quantity>0?`×${quantity}`:'—';
        const labelSize=label?`min(calc(var(--camera-unit) * 14), ${label.radius>0?label.radius*1.4/Math.max(1,copyText.length*.55):1e9}px)`:0;
        return <g key={`${p.partId}:${p.copyIndex}`} opacity={selected.length&&!active?0.5:1} transform={active?screenTransform(preview):undefined}><g data-part={p.partId} transform={`translate(${pos[0]} ${-pos[1]}) scale(1 -1)`}>
          <path d={p.path} fillRule="evenodd" fill={outlines?'white':colors[index%colors.length]} fillOpacity={outlines ? 0.1 : 1} pointerEvents="all" stroke={outlines?(active?'var(--accent)':'var(--muted)'):active?'var(--ink)':`light-dark(#334155, color-mix(in srgb, ${colors[index%colors.length]} 60%, white))`} strokeWidth={outlines?(active?1.5:1):(active?3:2)} vectorEffect="non-scaling-stroke"/>
          {label&&<text data-copy-count={quantity} x={label.point[0]} y={-label.point[1]} transform="scale(1 -1)" textAnchor="middle" dominantBaseline="central" fontSize={labelSize} fontWeight="650" fill={outlines?'var(--ink)':'#172029'} pointerEvents="none">{copyText}</text>}
          {active && <rect x={x0} y={y0} width={x1-x0} height={y1-y0} fill="none" stroke="var(--accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
          <title>{doc.parts[index]?.name}{world?` · copy ${p.copyIndex+1}`:''}{active?' · selected':''}</title>
        </g></g>;
      }),[drawings,selected,preview,moved,outlines,labels,world,doc.parts]);
  return <div className="canvas-wrap">
    <div className="canvas-tools">{view==='prepare'&&<details className="cad-snapping"><summary>Snap{snapping?' on':' off'}</summary><div><label className="checkbox"><input type="checkbox" checked={snapping} onChange={e=>setSnapping(e.target.checked)}/>Enable snapping</label><label>Grid, {displayUnit}<select value={grid} onChange={e=>setGrid(Number(e.target.value))}>{[.1,1,5,10].map(v=><option key={v} value={v}>{displayLength(v,displayUnit)}</option>)}</select></label><label>Angle step<select value={angleStep} onChange={e=>setAngleStep(Number(e.target.value))}>{[1,5,15,45,90].map(v=><option key={v} value={v}>{v}°</option>)}</select></label><small>Hold Alt to bypass. Numeric fields stay exact.</small></div></details>}<button aria-pressed={outlines} title="Show outlines with a faint fill" onClick={()=>setOutlines(!outlines)}>👻 mode</button><button onClick={fit}>Fit</button><button aria-label="Zoom out" onClick={()=>zoom(1.25)}>−</button><button aria-label="Zoom in" onClick={()=>zoom(.8)}>+</button></div>
    <svg ref={svg} className="workspace-svg" aria-label={view==='prepare'?'Preparation drawing':live?'Live nesting search':'Checked nesting result'} role="img" data-live-sequence={live?.sequence}
      style={{'--camera-unit':`${unit}px`} as CSSProperties} viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
      onPointerDown={e=>{
        if(e.pointerType==='touch'){
          if(touches.current.size>=2)return;
          e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();
          touches.current.set(e.pointerId,[e.clientX-rect.left,e.clientY-rect.top]);
          e.currentTarget.setPointerCapture(e.pointerId);
          if(touches.current.size===2){
            pinch.current={camera,size,start:[...touches.current.values()] as [Point,Point]};
            touchDraw.current=undefined;setDrag(undefined);return;
          }
          if(pinch.current)return;
        }
        if((e.button!==0&&e.button!==1)||drag||pending)return;
        const handle=(e.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
        if(handle&&selection&&!disabled&&view==='prepare'&&e.button===0&&!space.current){
          e.preventDefault();const [x0,y0,x1,y1]=selection;
          const pivot:Point=handle==='rotate'?[(x0+x1)/2,(y0+y1)/2]:[handle.includes('e')?x0:x1,handle.includes('n')?y0:y1];
          const p=point(e.clientX,e.clientY);
          const start:Point=handle==='rotate'?[p[0],-p[1]]:[handle.includes('e')?x1:x0,handle.includes('n')?y1:y0];
          setDrag({pointer:e.pointerId,start,parts:[],delta:[0,0],anchor:[0,0],transform:{kind:handle==='rotate'?'rotate':'scale',pivot}});
          e.currentTarget.setPointerCapture(e.pointerId);return;
        }
        const cursor=point(e.clientX,e.clientY);
        const id=(e.target as Element).closest('[data-part]')?.getAttribute('data-part') ?? undefined;
        const outsideBin=!world||cursor[0]<0||cursor[0]>result!.usedLengthMm||cursor[1]>0||cursor[1]<-doc.settings.materialWidthMm;
        const pan=space.current||e.button===1||(!id&&!polygon&&outsideBin);
        if(polygon&&!pan) {const p=point(e.clientX,e.clientY);if(e.pointerType==='touch')touchDraw.current={pointer:e.pointerId,screen:[e.clientX,e.clientY],world:[p[0],-p[1]]};else onDraw?.([p[0],-p[1]]);return;}
        if(!pan&&e.shiftKey){onSelect(id,true);return;}
        if(!pan&&(!id||!selected.includes(id)))onSelect(id);
        if(pan || (!disabled && view==='prepare' && id)) {
          e.preventDefault();
          const ids=id&&selected.includes(id)?selected:[id];
          const parts=pan?[]:doc.parts.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,position:p.preparationPosition}));
          const box=selectionBounds(doc,parts.map(p=>p.id));
          setDrag({backgroundStart:pan&&!id&&e.button===0&&!space.current?[e.clientX,e.clientY]:undefined,pointer:e.pointerId,parts,start:point(e.clientX,e.clientY),delta:[0,0],anchor:box?[box[0],box[1]]:[0,0]});
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={e=>{
        if(touches.current.has(e.pointerId)){
          const rect=e.currentTarget.getBoundingClientRect();
          touches.current.set(e.pointerId,[e.clientX-rect.left,e.clientY-rect.top]);
          if(pinch.current){
            if(touches.current.size===2)setCamera(pinchCamera(pinch.current.camera,pinch.current.size,pinch.current.start,[...touches.current.values()] as [Point,Point]));
            return;
          }
          if(touchDraw.current&&Math.hypot(e.clientX-touchDraw.current.screen[0],e.clientY-touchDraw.current.screen[1])>6)touchDraw.current=undefined;
        }
        if(!drag||e.pointerId!==drag.pointer) return;
        if(drag.transform){
          const p=point(e.clientX,e.clientY),current:Point=[p[0],-p[1]],enabled=snapping&&!e.altKey;
          const edit=drag.transform.kind==='scale'?resizeEdit(drag.start,current,drag.transform.pivot,enabled?grid:0):rotationEdit(drag.start,current,drag.transform.pivot,enabled?angleStep:0);
          setDrag({...drag,transform:{...drag.transform,edit}});return;
        }
        const p=point(e.clientX,e.clientY),dx=p[0]-drag.start[0],dy=p[1]-drag.start[1];
        if(drag.parts.length) setDrag({...drag,delta:moveDelta([drag.start[0],-drag.start[1]],[p[0],-p[1]],drag.anchor,snapping&&!e.altKey?grid:0)});
        else setCamera({...camera,x:camera.x-dx,y:camera.y-dy});
      }}
      onPointerUp={e=>{
        touches.current.delete(e.pointerId);
        if(pinch.current){
          if(!touches.current.size)pinch.current=undefined;
          setDrag(undefined);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);return;
        }
        if(touchDraw.current?.pointer===e.pointerId){onDraw?.(touchDraw.current.world);touchDraw.current=undefined;}
        if(!drag||e.pointerId!==drag.pointer)return;const edit=drag.transform?.edit;
        if(drag.backgroundStart&&Math.hypot(e.clientX-drag.backgroundStart[0],e.clientY-drag.backgroundStart[1])<3)onSelect();
        const transformed=edit&&(edit.kind==='scale'?edit.factor!==1:edit.degrees!==0),translated=drag.parts.length&&drag.delta.some(v=>v!==0);
        if(transformed||translated){
          setPending(drag);
          void Promise.resolve(transformed?onTransform(edit):onMove([...moved].map(([id,position])=>({id,position})))).finally(()=>setPending(undefined));
        }
        setDrag(undefined);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={e=>{touches.current.delete(e.pointerId);if(!touches.current.size)pinch.current=undefined;touchDraw.current=undefined;setDrag(undefined);}}
      onLostPointerCapture={e=>{touches.current.delete(e.pointerId);if(!touches.current.size)pinch.current=undefined;touchDraw.current=undefined;setDrag(undefined);}}>
      {world && <><rect x="0" y={-doc.settings.materialWidthMm} width={result!.usedLengthMm} height={doc.settings.materialWidthMm} fill={outlines?'none':'var(--material-fill)'} stroke="var(--secondary)" vectorEffect="non-scaling-stroke"/>
        <text x="0" y={-doc.settings.materialWidthMm-2} fontSize={camera.w/70} fill="var(--muted)">{(result!.usedLengthMm/unitScale(displayUnit)).toFixed(2)} {displayUnit} × {displayLength(doc.settings.materialWidthMm,displayUnit)} {displayUnit}</text></>}
      {showWidth&&<g className="material-width-band" data-material-width-band={doc.settings.materialWidthMm} pointerEvents="none" aria-hidden="true">
        <rect x={coordinates.left} y={-doc.settings.materialWidthMm} width={size.width*unit} height={doc.settings.materialWidthMm}/>
        <path d={`M${coordinates.left},0h${size.width*unit}M${coordinates.left},${-doc.settings.materialWidthMm}h${size.width*unit}`} vectorEffect="non-scaling-stroke"/>
      </g>}
      <g className="coordinate-grid" aria-hidden="true" pointerEvents="none" data-grid-step={coordinates.major}>
        {(['minor','major','origin'] as const).map(kind=><path key={kind} className={kind} fill="none" vectorEffect="non-scaling-stroke" d={[
          ...coordinates.x.filter(t=>(t.value===0?'origin':t.major?'major':'minor')===kind).map(t=>`M${t.mm},${coordinates.top}v${size.height*unit}`),
          ...coordinates.y.filter(t=>(t.value===0?'origin':t.major?'major':'minor')===kind).map(t=>`M${coordinates.left},${-t.mm}h${size.width*unit}`),
        ].join(' ')}/>)}
      </g>
      {shapes}
      {showWidth&&<g className="material-width-outside" pointerEvents="none" aria-hidden="true">
        <rect x={coordinates.left} y={coordinates.top} width={size.width*unit} height={Math.max(0,-doc.settings.materialWidthMm-coordinates.top)}/>
        <rect x={coordinates.left} y="0" width={size.width*unit} height={Math.max(0,coordinates.top+size.height*unit)}/>
      </g>}
      {!world&&!disabled&&!polygon&&selection&&<g transform={screenTransform(preview)} className="cad-handles">
        <rect x={selection[0]+(drag?.parts.length?drag.delta[0]:0)} y={-selection[3]-(drag?.parts.length?drag.delta[1]:0)} width={selection[2]-selection[0]} height={selection[3]-selection[1]} fill="none" stroke="var(--accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
        {!drag?.parts.length&&<>{(['sw','se','nw','ne'] as const).map(corner=>{const x=corner.includes('e')?selection[2]:selection[0],y=-(corner.includes('n')?selection[3]:selection[1]);return <g key={corner} data-handle={corner} style={{cursor:corner==='ne'||corner==='sw'?'nesw-resize':'nwse-resize'}}><rect x={x-hit} y={y-hit} width={2*hit} height={2*hit} fill="transparent"/><rect x={x-4*unit} y={y-4*unit} width={8*unit} height={8*unit} fill="var(--panel)" stroke="var(--accent)" vectorEffect="non-scaling-stroke"/><title>Resize {corner} corner</title></g>;})}
          <g data-handle="rotate" style={{cursor:'grab'}}><line x1={(selection[0]+selection[2])/2} x2={(selection[0]+selection[2])/2} y1={-selection[3]} y2={-selection[3]-28*unit} stroke="var(--accent)" vectorEffect="non-scaling-stroke"/><circle cx={(selection[0]+selection[2])/2} cy={-selection[3]-28*unit} r={hit} fill="transparent"/><circle cx={(selection[0]+selection[2])/2} cy={-selection[3]-28*unit} r={5*unit} fill="var(--panel)" stroke="var(--accent)" vectorEffect="non-scaling-stroke"/><title>Rotate selection</title></g></>}
      </g>}
      {world&&live&&<g transform="scale(1 -1)" pointerEvents="none" aria-label="Overlapping areas">{live.overlaps.map((rings,i)=><path key={i} data-overlap="true" d={pathData(rings)} fillRule="evenodd" fill={outlines?'none':'#e34e4e'} stroke="#c72b36" strokeWidth={outlines?2:1} vectorEffect="non-scaling-stroke"/>)}</g>}
      {polygon&&<g transform="scale(1 -1)"><polyline points={polygon.map(p=>p.join(',')).join(' ')} fill="none" stroke="#176b58" strokeWidth="2" vectorEffect="non-scaling-stroke"/>{polygon.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={camera.w/250} fill="#176b58"/>)}</g>}
    </svg>
    <svg className="coordinate-rulers" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-label={`Coordinate rulers, ${displayUnit}`} role="img">
      <rect x="0" y="0" width={size.width} height="20"/><rect x="0" y="0" width="20" height={size.height}/>
      <path fill="none" d={[
        ...coordinates.x.map(t=>{const x=(t.mm-coordinates.left)/unit;return x<22?'':`M${x},${t.major?14:17}V20`;}),
        ...coordinates.y.map(t=>{const y=(-t.mm-coordinates.top)/unit;return y<22?'':`M${t.major?14:17},${y}H20`;}),
      ].join(' ')}/>
      {coordinates.x.filter(t=>t.major).map(t=>{const x=(t.mm-coordinates.left)/unit;return x<22?null:<text key={t.value} x={x+3} y="10" data-axis="x" data-value={t.value}>{t.value}</text>;})}
      {coordinates.y.filter(t=>t.major).map(t=>{const y=(-t.mm-coordinates.top)/unit;return y<22?null:<text key={t.value} transform={`translate(10 ${y-3}) rotate(-90)`} data-axis="y" data-value={t.value}>{t.value}</text>;})}
      <rect width="20" height="20"/><text x="10" y="12" textAnchor="middle">{displayUnit}</text>
    </svg>
    <p className="canvas-hint">{polygon?'Click vertices · Enter to finish · Escape to cancel':view==='prepare'?'Select a part to adjust it. Drag to arrange.':live?'Live search · overlapping areas shown in red.':'Geometry checked against the imported polygons.'} <span>Drag outside the bin to pan · scroll or pinch to zoom</span></p>
  </div>;
}
