import {it,expect} from 'vitest';
import {DEFAULT_SETTINGS,newPart,type Document,type Point} from '../src/model';
import {editSelection,selectionBounds} from '../src/geometry/manipulate';
import {netArea} from '../src/geometry/validate';

const source=():Document=>({name:'Parts',settings:DEFAULT_SETTINGS,parts:[{...newPart([[0,0],[20,0],[20,10],[0,10]]),id:'a',preparationPosition:[10,20],holes:[[[2,2],[2,4],[4,4],[4,2]]]},{...newPart([[0,0],[10,0],[10,10],[0,10]]),id:'b',preparationPosition:[50,20]}]});
it('rotates around the chosen world pivot and preserves holes and area',()=>{
  const doc=source(),edited=editSelection(doc,['a'],{kind:'rotate',degrees:90,pivot:[20,25]});
  expect(selectionBounds(edited,['a'])).toEqual([15,15,25,35]);
  expect(netArea(edited.parts[0])).toBe(196);expect(edited.parts[0].holes).toHaveLength(1);
  expect(edited.parts[1]).toEqual(doc.parts[1]);
  const restored=editSelection(edited,['a'],{kind:'rotate',degrees:-90,pivot:[20,25]});
  expect(restored.parts).toEqual(doc.parts);
});
it('scales a group uniformly around its anchor, including spacing and approximation tolerance',()=>{
  const doc=source();doc.parts[0].approximationToleranceMm=.01;
  const edited=editSelection(doc,['a','b'],{kind:'scale',factor:2,pivot:[10,20]});
  expect(selectionBounds(edited,['a','b'])).toEqual([10,20,110,40]);
  expect(edited.parts[1].preparationPosition).toEqual([90,20]);
  expect(netArea(edited.parts[0])).toBe(4*netArea(doc.parts[0]));expect(edited.parts[0].approximationToleranceMm).toBe(.02);
});
it('round trips arbitrary rotation and rejects invalid operations transactionally',()=>{
  const doc=source(),pivot:Point=[20,25];
  const rotated=editSelection(doc,['a'],{kind:'rotate',degrees:37,pivot});
  const restored=editSelection(rotated,['a'],{kind:'rotate',degrees:-37,pivot});
  for(let i=0;i<doc.parts[0].outer.length;i++)for(let axis=0;axis<2;axis++)expect(restored.parts[0].outer[i][axis]).toBeCloseTo(doc.parts[0].outer[i][axis],10);
  for(const factor of [0,-1,Infinity,NaN,100000])expect(()=>editSelection(doc,['a'],{kind:'scale',factor,pivot})).toThrow();
  expect(()=>editSelection(doc,['missing'],{kind:'rotate',degrees:10,pivot})).toThrow();
  expect(doc).toEqual(source());
});
