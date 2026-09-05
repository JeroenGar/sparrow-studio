export type DisplayUnit='mm'|'in';
export const unitScale=(unit:DisplayUnit)=>unit==='in'?25.4:1;
export const displayLength=(mm:number,unit:DisplayUnit)=>Number((mm/unitScale(unit)).toPrecision(9)).toString();
