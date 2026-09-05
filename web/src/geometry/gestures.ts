import type {Point} from '../model';
import type {GeometryEdit} from './manipulate';

export type PreparationShortcut='rotate'|'increase-quantity'|'decrease-quantity';
export function preparationShortcut(key:string):PreparationShortcut|undefined {
  if(key.toLowerCase()==='r')return 'rotate';
  if(key==='+'||key==='='||key==='Add')return 'increase-quantity';
  if(key==='-'||key==='_'||key==='Subtract')return 'decrease-quantity';
}
export function isEditableTarget(target:EventTarget|null):boolean {
  if(!(target instanceof HTMLElement))return false;
  return target.isContentEditable||['INPUT','TEXTAREA','SELECT','OPTION'].includes(target.tagName);
}
export function preparationCopyOffset(copyIndex:number,quantity:number,box:[number,number,number,number]):Point {
  const count=Number.isInteger(quantity)&&quantity>0?quantity:1;
  if(copyIndex<=0||count<=1)return [0,0];
  const short=Math.max(0,Math.min(box[2]-box[0],box[3]-box[1]));
  const span=short*.12;
  const progress=Math.min(1,Math.max(0,copyIndex/(count-1)));
  return [-span*progress,-span*progress];
}

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

export type Camera={x:number;y:number;w:number;h:number};
export function pinchCamera(camera:Camera,size:{width:number;height:number},start:[Point,Point],current:[Point,Point]):Camera {
  const distance=(points:[Point,Point])=>Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
  const before=distance(start),after=distance(current);
  if(before===0||after===0)return camera;
  const factor=Math.max(.01/camera.w,Math.min(1e7/camera.w,before/after));
  const unit=Math.max(camera.w/size.width,camera.h/size.height);
  const midpoint:Point=[(start[0][0]+start[1][0])/2,(start[0][1]+start[1][1])/2];
  const anchor:Point=[camera.x+camera.w/2+(midpoint[0]-size.width/2)*unit,camera.y+camera.h/2+(midpoint[1]-size.height/2)*unit];
  return {x:anchor[0]+(camera.x-anchor[0])*factor-((current[0][0]+current[1][0])/2-midpoint[0])*unit*factor,
    y:anchor[1]+(camera.y-anchor[1])*factor-((current[0][1]+current[1][1])/2-midpoint[1])*unit*factor,
    w:camera.w*factor,h:camera.h*factor};
}
