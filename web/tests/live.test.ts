import {it,expect,vi} from 'vitest';
import polygonClipping from 'polygon-clipping';
import {newPart,DEFAULT_SETTINGS,type Result} from '../src/model';
import {liveGeometry} from '../src/geometry/live';
import {area} from '../src/geometry/normalize';

it('draws the actual intersecting region, with touching edges left unmarked',()=>{
  const part={...newPart([[0,0],[10,0],[10,10],[0,10]]),quantity:2};
  const doc={name:'Overlap',parts:[part],settings:DEFAULT_SETTINGS};
  const result:Result={documentRevision:1,solverRevision:'test',seed:'1',elapsedSeconds:0,usedLengthMm:20,placements:[{partId:part.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0},{partId:part.id,copyIndex:1,xMm:5,yMm:3,angleDeg:0}],validation:{status:'pending',overlapAreaMm2:0,maxBoundaryViolationMm:0,minClearanceMm:null,errors:[]}};
  const live=liveGeometry(doc,result);expect(live.world).toHaveLength(2);expect(live.overlaps).toHaveLength(1);
  expect(Math.abs(area(live.overlaps[0][0]))).toBe(35);expect(result.validation.status).toBe('pending');
  result.placements[1].xMm=10;expect(liveGeometry(doc,result).overlaps).toEqual([]);
});

it('keeps other live overlaps when one clip fails',()=>{
  const part={...newPart([[0,0],[10,0],[10,10],[0,10]]),quantity:3};
  const doc={name:'Overlap',parts:[part],settings:DEFAULT_SETTINGS};
  const result:Result={documentRevision:1,solverRevision:'test',seed:'1',elapsedSeconds:0,usedLengthMm:30,
    placements:[0,1,2].map(copyIndex=>({partId:part.id,copyIndex,xMm:copyIndex*5,yMm:0,angleDeg:0})),
    validation:{status:'pending',overlapAreaMm2:0,maxBoundaryViolationMm:0,minClearanceMm:null,errors:[]}};
  const clip=vi.spyOn(polygonClipping,'intersection').mockImplementationOnce(()=>{throw Error('synthetic clip failure');});
  try {
    const live=liveGeometry(doc,result);
    expect(live.overlaps).toHaveLength(1);
    expect(live.errors).toEqual([`Copies ${part.id}:0 and ${part.id}:1: synthetic clip failure`]);
  } finally { clip.mockRestore(); }
});
