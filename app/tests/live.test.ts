import {it,expect,vi} from 'vitest';
import polygonClipping from 'polygon-clipping';
import {newPart,DEFAULT_SETTINGS,type Result} from '../src/engine/model';
import {liveGeometry} from '../src/engine/geometry/live';
import {area} from '../src/engine/geometry/normalize';
import { polygonShape } from '../src/engine/geometry/contour';

it('draws the actual intersecting region, with touching edges left unmarked',()=>{
  const part={...newPart(polygonShape([[0,0],[10,0],[10,10],[0,10]])),quantity:2};
  const doc={name:'Overlap',parts:[part],settings:DEFAULT_SETTINGS};
  const result:Result={usedLengthMm:20,placements:[{partId:part.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0},{partId:part.id,copyIndex:1,xMm:5,yMm:3,angleDeg:0}]};
  const live=liveGeometry(doc,result);expect(live.world).toHaveLength(2);expect(live.overlaps).toHaveLength(1);
  expect(Math.abs(area(live.overlaps[0][0]))).toBe(35);
  result.placements[1].xMm=10;expect(liveGeometry(doc,result).overlaps).toEqual([]);
});

it('keeps other live overlaps when one clip fails',()=>{
  const part={...newPart(polygonShape([[0,0],[10,0],[10,10],[0,10]])),quantity:3};
  const doc={name:'Overlap',parts:[part],settings:DEFAULT_SETTINGS};
  const result:Result={usedLengthMm:30,
    placements:[0,1,2].map(copyIndex=>({partId:part.id,copyIndex,xMm:copyIndex*5,yMm:0,angleDeg:0}))};
  const clip=vi.spyOn(polygonClipping,'intersection').mockImplementationOnce(()=>{throw Error('synthetic clip failure');});
  try {
    const live=liveGeometry(doc,result);
    expect(live.overlaps).toHaveLength(1);
    expect(live.errors).toEqual([`Copies ${part.id}:0 and ${part.id}:1: synthetic clip failure`]);
  } finally { clip.mockRestore(); }
});

it('leaves a part inside another part\'s hole unmarked',()=>{
  const frame={...newPart(polygonShape([[0,0],[30,0],[30,30],[0,30]],[[[10,10],[10,20],[20,20],[20,10]]]))};
  const small=newPart(polygonShape([[0,0],[5,0],[5,5],[0,5]]));
  const doc={name:'Holes',parts:[frame,small],settings:DEFAULT_SETTINGS};
  const result:Result={usedLengthMm:30,placements:[{partId:frame.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0},{partId:small.id,copyIndex:0,xMm:12,yMm:12,angleDeg:0}]};
  expect(liveGeometry(doc,result).overlaps).toEqual([]);
  result.placements[1].xMm=8;expect(liveGeometry(doc,result).overlaps).toHaveLength(1);
});
