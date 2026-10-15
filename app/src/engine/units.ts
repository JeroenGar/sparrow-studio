export type DisplayUnit='mm'|'in';
export const unitScale=(unit:DisplayUnit)=>unit==='in'?25.4:1;
export const displayLength=(mm:number,unit:DisplayUnit)=>unit==='mm'?(mm!==0&&Math.abs(mm)<.005?mm.toExponential(2):Number(mm.toFixed(2)).toString()):Number((mm/25.4).toPrecision(9)).toString();
