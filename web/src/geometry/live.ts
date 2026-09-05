import polygonClipping from 'polygon-clipping';
import type {Document,Result,Ring} from '../model';
import {bounds} from './normalize';
import {worldParts,type WorldPart} from './validate';

export type LiveGeometry={world:WorldPart[];overlaps:Ring[][]};
// Display only: a live frame never grants validation or export authority.
export function liveGeometry(doc:Document,result:Result):LiveGeometry {
  const world=worldParts(doc,result),boxes=world.map(p=>bounds(p.outer)),overlaps:Ring[][]=[];
  for(let i=0;i<world.length;i++)for(let j=0;j<i;j++) {
    const a=boxes[i],b=boxes[j];
    if(a[0]>=b[2]||b[0]>=a[2]||a[1]>=b[3]||b[1]>=a[3])continue;
    overlaps.push(...polygonClipping.intersection([world[i].outer],[world[j].outer]));
  }
  return {world,overlaps};
}
