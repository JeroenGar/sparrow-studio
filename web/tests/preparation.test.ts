import {expect,it} from 'vitest';
import {arrangePreparation,labelPoints} from '../src/geometry/preparation';
import {bounds,inside} from '../src/geometry/normalize';
import {editSelection} from '../src/geometry/manipulate';
import {DEFAULT_SETTINGS,newPart,type Document,type Part,type Point} from '../src/model';

const rect=(id:string,w=10,h=10,position:Point=[0,0]):Part=>({...newPart([[0,0],[w,0],[w,h],[0,h]]),id,preparationPosition:position});
const doc=(parts:Part[]):Document=>({name:'Preparation',parts,settings:DEFAULT_SETTINGS});
function separated(document:Document) {
  const boxes=document.parts.map(p=>{const b=bounds(p.outer);return [b[0]+p.preparationPosition[0],b[1]+p.preparationPosition[1],b[2]+p.preparationPosition[0],b[3]+p.preparationPosition[1]];});
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++) {
    const a=boxes[i],b=boxes[j];expect(a[0]>=b[2]||b[0]>=a[2]||a[1]>=b[3]||b[1]>=a[3]).toBe(true);
  }
  return boxes;
}
it('compacts overlapping parts near the origin without altering geometry or input',()=>{
  const input=doc(Array.from({length:500},(_,i)=>rect(String(i),10,10,[1000,1000]))),original=structuredClone(input);
  const arranged=arrangePreparation(input,[],true),boxes=separated(arranged);
  expect(Math.max(...boxes.map(b=>b[2]))).toBeLessThan(350);expect(Math.max(...boxes.map(b=>b[3]))).toBeLessThan(350);
  expect(input).toEqual(original);expect(arranged).toEqual(arrangePreparation(input,[],true));
  expect(arranged.parts.map(({preparationPosition,...part})=>part)).toEqual(input.parts.map(({preparationPosition,...part})=>part));
});
it('preserves pinned group positions, moves colliders nearby, and keeps distant parts',()=>{
  const input=doc([rect('a',10,10,[5,5]),rect('b',10,10,[25,5]),rect('collision',10,10,[5,5]),rect('far',10,10,[100,100])]);
  const arranged=arrangePreparation(input,['a','b']);separated(arranged);
  expect(arranged.parts[0]).toEqual(input.parts[0]);expect(arranged.parts[1]).toEqual(input.parts[1]);expect(arranged.parts[3]).toEqual(input.parts[3]);
  expect(Math.hypot(...arranged.parts[2].preparationPosition.map((v,i)=>v-input.parts[2].preparationPosition[i]))).toBeLessThan(12);
  expect(arrangePreparation(arranged,['a','b'])).toEqual(arranged);
});
it('handles offset geometry and rejects invalid pins and impossible compact layouts',()=>{
  const p=rect('offset');p.outer=p.outer.map(([x,y])=>[x-50,y-20]);separated(arrangePreparation(doc([p,rect('b')]),[],true));
  expect(()=>arrangePreparation(doc([rect('a')]),['missing'])).toThrow(/existing/);
  expect(()=>arrangePreparation(doc([rect('a'),rect('b')]),['a','b'])).toThrow(/overlap/);
  const giant=()=>({...rect('a'),outer:[[-100000,-100000],[100000,-100000],[100000,100000],[-100000,100000]] as Point[]});
  expect(()=>arrangePreparation(doc([giant(),{...giant(),id:'b'}]),[],true)).toThrow(/fit/);
});
it('allows draft nesting fields and keeps a rotated disjoint pinned group intact',()=>{
  const rotated=editSelection(doc([rect('a',20,20),rect('b',20,20,[22,0])]),['a','b'],{kind:'rotate',degrees:45,pivot:[0,0]});
  const draft={...rotated,settings:{...DEFAULT_SETTINGS,materialWidthMm:NaN},parts:rotated.parts.map(p=>({...p,quantity:NaN}))};
  expect(arrangePreparation(draft,['a','b'])).toEqual(draft);
  expect(arrangePreparation({...draft,parts:[]})).toEqual({...draft,parts:[]});
});
it('finds interior poles for concave and holed parts while ignoring draft quantity',()=>{
  const concave={...rect('concave'),outer:[[0,0],[30,0],[30,5],[5,5],[5,30],[0,30]] as Point[]};
  const hole={...rect('hole',30,30),holes:[[[5,5],[5,25],[25,25],[25,5]] as Point[]],quantity:NaN};
  const input=[concave,hole],original=structuredClone(input),labels=labelPoints(input);
  for(const [i,label] of labels.entries()) {
    expect(inside(label.point,input[i].outer)).toBe(true);expect(input[i].holes.some(h=>inside(label.point,h))).toBe(false);expect(label.radius).toBeGreaterThan(2.5);
  }
  expect(labelPoints([rect('square',20,20)])[0]).toEqual({id:'square',point:[10,10],radius:10});expect(input).toEqual(original);
});
it('keeps extreme aspect ratios bounded and validates malformed label geometry',()=>{
  const thin=rect('thin',100000,.00001),label=labelPoints([thin])[0];expect(inside(label.point,thin.outer)).toBe(true);expect(label.radius).toBe(0);
  expect(()=>labelPoints([{...rect('bad'),outer:[[0,0],[10,10],[0,10],[10,0]]}])).toThrow();
});
