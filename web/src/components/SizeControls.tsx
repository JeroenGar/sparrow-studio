import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Part} from '../model';
import {bounds} from '../geometry/normalize';
import {displayLength,unitScale,type DisplayUnit} from '../units';
export default function SizeControls({part,disabled,onApply,onValidity,unit='mm'}:{part:Part;disabled:boolean;onApply:(axis:0|1,value:number)=>void;onValidity:(valid:boolean)=>void;unit?:DisplayUnit}) {
  const b=bounds(part.outer),w=b[2]-b[0],h=b[3]-b[1];
  const scale=unitScale(unit),initial=[displayLength(w,unit),displayLength(h,unit)];
  const [width,setWidth]=useState(initial[0]),[height,setHeight]=useState(initial[1]);
  const valid=(value:string)=>!!value.trim()&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)*scale<=100_000;
  const invalid=!valid(width)||!valid(height);
  useEffect(()=>{onValidity(!invalid);return()=>onValidity(true);},[invalid,onValidity]);
  const previous=useRef({id:part.id,w,h,unit});
  useLayoutEffect(()=>{
    const old=previous.current,reset=old.id!==part.id||old.unit!==unit;
    if(reset||old.w!==w)setWidth(displayLength(w,unit));
    if(reset||old.h!==h)setHeight(displayLength(h,unit));
    previous.current={id:part.id,w,h,unit};
  },[part.id,w,h,unit]);
  const apply=(axis:0|1,value:string)=>{
    if(valid(value)&&value!==initial[axis]&&Number(value)!==Number(initial[axis]))onApply(axis,Number(value)*scale);
  };
  return <div className="size-controls"><label>Width, {unit}<input type="number" min={.000001/scale} max={100000/scale} step="any" required aria-invalid={!valid(width)} disabled={disabled} value={width} onChange={e=>setWidth(e.target.value)} onBlur={()=>apply(0,width)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
    <label>Height, {unit}<input type="number" min={.000001/scale} max={100000/scale} step="any" required aria-invalid={!valid(height)} disabled={disabled} value={height} onChange={e=>setHeight(e.target.value)} onBlur={()=>apply(1,height)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label><small>Aspect ratio locked</small>{invalid&&<small className="field-error" role="alert">Enter positive dimensions up to {unit==='mm'?'100,000':displayLength(100000,unit)} {unit}.</small>}</div>;
}
