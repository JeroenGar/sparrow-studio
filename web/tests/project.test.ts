import {it,expect} from 'vitest';
import {newPart,DEFAULT_SETTINGS,SOLVER_REVISION,type Project} from '../src/model';
import {exportProject,importProject} from '../src/import/project';

function project():Project {
  const part={...newPart([[0,0],[10,0],[10,10],[0,10]]),holes:[[[2,2],[2,4],[4,4],[4,2]] as [number,number][]]};
  return {name:'Saved plate',schemaVersion:1,revision:9,parts:[part],settings:DEFAULT_SETTINGS,result:{documentRevision:9,solverRevision:SOLVER_REVISION,seed:'42',elapsedSeconds:1.25,usedLengthMm:10,placements:[{partId:part.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0}],validation:{status:'failed',overlapAreaMm2:123,maxBoundaryViolationMm:123,minClearanceMm:null,errors:['Untrusted stored badge']}}};
}
it('round trips geometry, holes, provenance, settings and freshly checks the saved result',()=>{
  const p=project(),review=importProject(exportProject(p,p.revision,p.result));
  expect(review.replace).toBe(true);expect(review.document.parts).toEqual(p.parts);expect(review.document.settings).toEqual(p.settings);
  expect(review.result).toMatchObject({solverRevision:SOLVER_REVISION,seed:'42',elapsedSeconds:1.25,documentRevision:9,validation:{status:'passed',overlapAreaMm2:0,errors:[]}});
});
it.each(['geometry','revision','provenance'] as const)('discards a saved result with invalid %s without losing parts',kind=>{
  const p=project();
  if(kind==='geometry')p.result!.placements[0].xMm=-1;
  if(kind==='revision')p.result!.documentRevision=8;
  if(kind==='provenance')p.result!.seed='18446744073709551616';
  const review=importProject(JSON.stringify(p));
  expect(review.result).toBeUndefined();expect(review.document.parts).toHaveLength(1);expect(review.warnings[0]).toContain('discarded');
});
it('rejects unknown versions and malformed documents, and saves without a result',()=>{
  const p=project();expect(()=>importProject(JSON.stringify({...p,schemaVersion:2}))).toThrow('version 1');
  expect(()=>importProject(JSON.stringify({...p,parts:[null]}))).toThrow();
  expect(importProject(exportProject(p,9)).result).toBeUndefined();
  expect(()=>exportProject(p,10,p.result)).toThrow('older document');
});
