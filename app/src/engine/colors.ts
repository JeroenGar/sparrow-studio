// Pastel part colours. Hues step by the golden angle, so neighbours in a list never look alike,
// and lightness alternates between two levels. Each colour has a darker shade for patterns.
const hex=(h:number,s:number,l:number)=>{
  const f=(n:number)=>{const k=(n+h/30)%12,c=l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(c*255).toString(16).padStart(2,'0');};
  return `#${f(0)}${f(8)}${f(4)}`;
};
const COUNT=30;
const hues=Array.from({length:COUNT},(_,i)=>(i*137.508)%360);
export const colors=hues.map((h,i)=>hex(h,.62,i%2?.76:.84));
export const shades=hues.map((h,i)=>hex(h,.45,i%2?.5:.56));
