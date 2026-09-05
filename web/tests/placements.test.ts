import {solverInput} from '../src/import/sparrow';
import {candidateResult} from '../src/workers/useSolver';
import type {Candidate} from '../src/workers/protocol';
import {it,expect} from 'vitest';
import {DEFAULT_SETTINGS,newPart,type Document} from '../src/model';
import {normalizeDocument} from '../src/geometry/normalize';
import {documentPlacements,duplicateCopies,removeCopies,rotateToNextOrientation,rotatePlacements,syncQuantity,updatePlacements,withDocumentPlacements} from '../src/geometry/placements';

const source=():Document=>({name:'Copies',settings:DEFAULT_SETTINGS,parts:[{
  ...newPart([[0,0],[20,0],[20,10],[0,10]]),id:'plate',quantity:2,preparationPosition:[10,20]
}]});

it('expands legacy type positions into an independently addressable stack',()=>{
  const placements=documentPlacements(source());
  expect(placements).toHaveLength(2);
  expect(placements[0]).toMatchObject({partId:'plate',copyIndex:0,xMm:10,yMm:20,angleDeg:0});
  expect(placements[1]).toMatchObject({partId:'plate',copyIndex:1,xMm:9,yMm:19,angleDeg:0});
});

it('preserves old copies and inherits the moved parent when quantity grows',()=>{
  const moved=updatePlacements(withDocumentPlacements(source()),[{partId:'plate',copyIndex:0,xMm:40,yMm:50,angleDeg:37}]);
  const increased=syncQuantity({...moved,parts:moved.parts.map(part=>({...part,quantity:3}))});
  const placements=documentPlacements(increased);
  expect(placements.slice(0,2)).toEqual(documentPlacements(moved));
  expect(placements[2].xMm).toBeCloseTo(38);
  expect(placements[2].yMm).toBeCloseTo(48);
  expect(placements[2].angleDeg).toBe(37);
});

it('rotates only the selected copy and rejects malformed explicit layouts',()=>{
  const doc=withDocumentPlacements(source()),rotated=rotatePlacements(doc,[{partId:'plate',copyIndex:1}],90,[0,0]);
  expect(documentPlacements(rotated)[0]).toEqual(documentPlacements(doc)[0]);
  expect(documentPlacements(rotated)[1].angleDeg).toBe(90);
  expect(()=>normalizeDocument({...source(),placements:[{partId:'plate',copyIndex:2,xMm:0,yMm:0,angleDeg:0}]})).toThrow('exceeds its quantity');
});

it('deletes copies down to zero without deleting the type and duplicates within the type',()=>{
  const doc=withDocumentPlacements(source()),copies=documentPlacements(doc);
  const deleted=removeCopies(doc,[copies[0]]);
  expect(deleted.parts).toHaveLength(1);expect(deleted.parts[0].quantity).toBe(1);
  expect(deleted.placements).toEqual([{...copies[1],copyIndex:0}]);
  const empty=removeCopies(deleted,deleted.placements!);
  expect(empty.parts[0].quantity).toBe(0);expect(documentPlacements(empty)).toEqual([]);
  expect(normalizeDocument(empty).parts[0].id).toBe('plate');
  const restored=syncQuantity({...empty,parts:empty.parts.map(part=>({...part,quantity:1}))});
  const cloned=duplicateCopies(restored,restored.placements!);
  expect(cloned.parts).toHaveLength(1);expect(cloned.parts[0].quantity).toBe(2);
  expect(cloned.placements![0]).toEqual(restored.placements![0]);
  expect(cloned.placements![1].xMm).toBeLessThan(cloned.placements![0].xMm);
});
it('R cycles discrete allowed orientations and uses quarter turns for free rotation',()=>{
  let doc=withDocumentPlacements(source());const ref={partId:'plate',copyIndex:0};
  doc=rotateToNextOrientation(doc,[ref]);expect(doc.placements![0].angleDeg).toBe(180);
  doc=rotateToNextOrientation(doc,[ref]);expect(doc.placements![0].angleDeg).toBe(0);
  doc={...doc,parts:doc.parts.map(part=>({...part,rotations:{kind:'discrete',degrees:[270,30,120]}}))};
  for(const angle of [30,120,270,30]){doc=rotateToNextOrientation(doc,[ref]);expect(doc.placements![0].angleDeg).toBe(angle);}
  doc={...doc,parts:doc.parts.map(part=>({...part,rotations:{kind:'continuous'}}))};
  doc=rotateToNextOrientation(doc,[ref]);expect(doc.placements![0].angleDeg).toBe(120);
  expect(doc.placements![1].angleDeg).toBe(0);
});

it('zero-demand types stay in the project but solver IDs remain dense and map back correctly',()=>{
  const doc=source();doc.parts=[{...doc.parts[0],id:'hidden',quantity:0},{...doc.parts[0],id:'active',quantity:1}];
  expect(JSON.parse(solverInput(doc)).items.map((item:{id:number;demand:number})=>[item.id,item.demand])).toEqual([[0,1]]);
  const candidate={documentRevision:1,elapsedMs:10,solution:{strip_width:20,layout:{placed_items:[{item_id:0,transformation:{rotation:0,translation:[0,0]}}]}}} as Candidate;
  expect(candidateResult(doc,candidate,'1').placements[0].partId).toBe('active');
  expect(()=>solverInput({...doc,parts:doc.parts.map(part=>({...part,quantity:0}))})).toThrow('at least one copy');
});
