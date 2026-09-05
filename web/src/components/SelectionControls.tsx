import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {displayLength,unitScale,type DisplayUnit} from '../units';
export default function SelectionControls({box,disabled,onPosition,onSize,onRotate,onValidity,unit='mm'}:{box:number[];disabled:boolean;onPosition:(axis:0|1,value:number)=>void;onSize:(axis:0|1,value:number)=>void;onRotate:(degrees:number)=>void;onValidity:(valid:boolean)=>void;unit?:DisplayUnit}) {
  const values=[box[0],box[1],box[2]-box[0],box[3]-box[1]];
  const scale=unitScale(unit),initial=values.map(v=>displayLength(v,unit));
  const [fields,setFields]=useState(initial),[angle,setAngle]=useState('90');
  const previous=useRef({values,unit});
  useLayoutEffect(()=>{
    const old=previous.current;
    setFields(fields=>values.map((value,i)=>old.unit!==unit||old.values[i]!==value?displayLength(value,unit):fields[i]));
    previous.current={values,unit};
  },[...values,unit]);
  const valid=(text:string,i:number)=>!!text.trim()&&Number.isFinite(Number(text))&&Math.abs(Number(text)*scale)<=100_000&&(i<2||Number(text)>0);
  const invalid=fields.some((text,i)=>!valid(text,i));
  useEffect(()=>{onValidity(!invalid);return()=>onValidity(true);},[invalid,onValidity]);
  function apply(i:number) {
    if(!valid(fields[i],i)||fields[i]===initial[i]||Number(fields[i])===Number(initial[i]))return;
    if(i<2)onPosition(i as 0|1,Number(fields[i])*scale);else onSize((i-2) as 0|1,Number(fields[i])*scale);
  }
  return <><div className="size-controls">{['X','Y','Width','Height'].map((label,i)=><label key={label}>{label}, {unit}<input type="number" step="any" min={(i<2?-100000:.000001)/scale} max={100000/scale} required disabled={disabled} aria-invalid={!valid(fields[i],i)} value={fields[i]} onChange={e=>setFields(f=>f.map((v,j)=>j===i?e.target.value:v))} onBlur={()=>apply(i)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}<small>Position and rotation affect selected copies. Resizing changes every copy of this shape; aspect ratio is locked.</small>{invalid&&<small className="field-error" role="alert">Enter finite positions and positive dimensions up to {unit==='mm'?'100,000':displayLength(100000,unit)} {unit}.</small>}</div>
    <div className="rotation-control"><label>Rotate by, degrees<input type="number" step="any" value={angle} disabled={disabled} onChange={e=>setAngle(e.target.value)}/></label><button disabled={disabled||!angle.trim()||!Number.isFinite(Number(angle))} onClick={()=>onRotate(Number(angle))}>Rotate</button></div></>;
}
