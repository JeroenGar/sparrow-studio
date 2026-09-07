import {useState} from 'react';
import type {RotationRule} from '../model';

export default function RotationControl({rule,mixed,disabled,onChange}:{rule:RotationRule;mixed:boolean;disabled:boolean;onChange:(rule:RotationRule)=>void}) {
  const presets=['[0]','[0,180]','[0,90,180,270]'];
  const value=rule.kind==='continuous'?'free':JSON.stringify(rule.degrees);
  const [custom,setCustom]=useState(!mixed&&value!=='free'&&!presets.includes(value));
  const [text,setText]=useState(rule.kind==='discrete'?rule.degrees.join(', '):'0, 180');
  const degrees=text.split(',').map(s=>s.trim()===''?NaN:Number(s));
  const valid=degrees.every(Number.isFinite);
  function apply() {
    if(!disabled&&valid&&(mixed||JSON.stringify(degrees)!==value))onChange({kind:'discrete',degrees});
  }
  return <><label>Permitted rotations<select disabled={disabled} value={custom?'custom':mixed?'mixed':value} onChange={e=>{
    setCustom(e.target.value==='custom');
    if(e.target.value!=='custom')onChange(e.target.value==='free'?{kind:'continuous'}:{kind:'discrete',degrees:JSON.parse(e.target.value)});
  }}>
    {mixed&&<option value="mixed" disabled>Mixed</option>}
    <option value="[0]">Fixed 0°</option><option value="[0,180]">Half-turns · 0°, 180°</option><option value="[0,90,180,270]">Quarter-turns</option><option value="free">Free rotation</option><option value="custom">Custom degrees…</option>
  </select></label>
  {custom&&<label>Allowed degrees<input autoFocus disabled={disabled} value={text} aria-invalid={!valid} aria-describedby={!valid?'rotation-error':undefined} onChange={e=>setText(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>{!valid&&<small id="rotation-error" className="field-error" role="alert">Enter finite degrees separated by commas, such as 0, 180.</small>}</label>}</>;
}
