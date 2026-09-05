import type {Point} from '../model';
import type {GeometryEdit} from './manipulate';

export function snap(value:number,step:number):number {return step>0?Math.round(value/step)*step:value;}
export function moveDelta(start:Point,current:Point,anchor:Point,grid:number):Point {
  return [snap(anchor[0]+current[0]-start[0],grid)-anchor[0],snap(anchor[1]+current[1]-start[1],grid)-anchor[1]];
}
export function resizeEdit(start:Point,current:Point,pivot:Point,grid:number):GeometryEdit {
  const dx=start[0]-pivot[0],dy=start[1]-pivot[1];
  // Project onto the original diagonal: preserve aspect ratio without introducing reflection.
  let factor=((current[0]-pivot[0])*dx+(current[1]-pivot[1])*dy)/(dx*dx+dy*dy);
  const size=Math.max(Math.abs(dx),Math.abs(dy));
  if(grid>0)factor=snap(size*factor,grid)/size;
  return {kind:'scale',factor:Math.max(grid>0?Math.min(1,grid/size):.001,factor),pivot};
}
export function rotationEdit(start:Point,current:Point,pivot:Point,step:number):GeometryEdit {
  const angle=(Math.atan2(current[1]-pivot[1],current[0]-pivot[0])-Math.atan2(start[1]-pivot[1],start[0]-pivot[0]))*180/Math.PI;
  return {kind:'rotate',degrees:snap((angle+540)%360-180,step),pivot};
}
export function screenTransform(edit?:GeometryEdit):string|undefined {
  if(!edit)return undefined;
  const [x,y]=edit.pivot;
  return `translate(${x} ${-y}) ${edit.kind==='rotate'?`rotate(${-edit.degrees})`:`scale(${edit.factor})`} translate(${-x} ${y})`;
}
