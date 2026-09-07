import {it,expect} from 'vitest';
import {importDXF} from '../src/import/dxf';
import {area,bounds} from '../src/geometry/normalize';

const options={scale:1,tolerance:.01,enclosed:'holes' as const};
export const dxf=(entities:string,units=4)=>`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const poly=(points:number[][],layer='cut')=>`0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n1\n${points.map(([x,y,b=0])=>`10\n${x}\n20\n${y}\n42\n${b}\n`).join('')}`;
const line=(x:number,y:number,u:number,v:number)=>`0\nLINE\n10\n${x}\n20\n${y}\n11\n${u}\n21\n${v}\n`;
it('flattens a bulged semicircle and assembles a LINE/ARC loop',()=>{
  const bulged=importDXF(dxf(poly([[0,0,1],[20,0]])),'bulge.dxf',options);
  expect(bulged.issues).toEqual([]);
  expect(Math.abs(area(bulged.document.parts[0].outer))).toBeCloseTo(50*Math.PI,0);
  const arc='0\nARC\n10\n0\n20\n0\n40\n10\n50\n0\n51\n180\n';
  const joined=importDXF(dxf(arc+line(-10,0,10,0)),'arc.dxf',options);
  expect(joined.issues).toEqual([]);expect(joined.document.parts).toHaveLength(1);
  expect(Math.abs(area(joined.document.parts[0].outer))).toBeCloseTo(50*Math.PI,0);
});
it('honors units, layer selection, and nested holes',()=>{
  const outer=poly([[0,0],[4,0],[4,4],[0,4]]),hole=poly([[1,1],[2,1],[2,2],[1,2]],'holes');
  const text=dxf(outer+hole,1),review=importDXF(text,'inch.dxf',options);
  expect(bounds(review.document.parts[0].outer)[2]).toBeCloseTo(101.6);
  expect(review.document.parts[0].holes).toHaveLength(1);expect(review.layers).toEqual(['cut','holes']);
  expect(importDXF(text,'inch.dxf',{...options,layers:['cut']}).document.parts[0].holes).toHaveLength(0);
  const unitless=importDXF(dxf(outer,0),'unitless.dxf',{...options,scale:25.4});
  expect(unitless.warnings.join(' ')).toContain('selected 25.4');expect(bounds(unitless.document.parts[0].outer)[2]).toBeCloseTo(101.6);
});
it('joins only unambiguous endpoints and reports adjustments and blocked contours',()=>{
  const edges=line(0,0,10,0)+line(10.006,0,10,10)+line(10,10,0,10)+line(0,10,0,0);
  const joined=importDXF(dxf(edges),'gap.dxf',options);
  expect(joined.issues).toEqual([]);expect(joined.warnings.join(' ')).toContain('Joined 1 gaps');
  const branch=importDXF(dxf(edges+line(10,10,20,20)),'branch.dxf',options);
  expect(branch.document.parts).toHaveLength(0);expect(branch.issues?.join(' ')).toContain('ambiguous');
});
it('reads ordinary POLYLINE vertices and rejects malformed sequences before parsing',()=>{
  const vertices=[[0,0],[10,0],[10,10],[0,10]].map(([x,y])=>`0\nVERTEX\n10\n${x}\n20\n${y}\n`).join('');
  const header='0\nPOLYLINE\n70\n1\n';
  expect(importDXF(dxf(header+vertices+'0\nSEQEND\n'),'old.dxf',options).document.parts).toHaveLength(1);
  expect(()=>importDXF(dxf(header+vertices),'bad.dxf',options)).toThrow('SEQEND');
});
it('lists unsupported entities and blocks nonplanar geometry, duplicates, and binary data',()=>{
  const rectangle=poly([[0,0],[10,0],[10,10],[0,10]]);
  const review=importDXF(dxf(rectangle+'0\nTEXT\n0\nINSERT\n'+line(20,0,30,0)+'30\n1\n'),'mixed.dxf',options);
  expect(review.document.parts).toHaveLength(1);expect(review.warnings.join(' ')).toContain('unsupported TEXT');expect(review.issues?.join(' ')).toContain('block reference');
  expect(review.issues?.join(' ')).toContain('Nonzero elevation');
  expect(importDXF(dxf(rectangle+rectangle),'duplicate.dxf',options).issues?.join(' ')).toContain('duplicate');
  expect(()=>importDXF('AutoCAD Binary DXF\0','binary.dxf',options)).toThrow('Binary DXF');
});

const withBlocks=(entities:string,blocks:string)=>dxf(entities).replace('0\nSECTION\n2\nENTITIES',`0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES`);
const block=(name:string,entities:string,x=0,y=0)=>`0\nBLOCK\n2\n${name}\n10\n${x}\n20\n${y}\n${entities}0\nENDBLK\n`;
const insert=(name:string,extra='')=>`0\nINSERT\n2\n${name}\n10\n0\n20\n0\n${extra}`;
it('expands nested blocks, base points, arrays and nonuniform transforms',()=>{
  const shape=poly([[5,6],[15,6],[15,11],[5,11]],'0');
  const blocks=block('part',shape,5,6)+block('nested',insert('part','10\n2\n20\n3\n'),2,3);
  const input=insert('nested','8\nCUT\n41\n2\n42\n3\n50\n90\n70\n2\n44\n40\n');
  const result=importDXF(withBlocks(input,blocks),'blocks.dxf',options);
  expect(result.issues).toEqual([]);expect(result.document.parts).toHaveLength(2);
  for(const part of result.document.parts){const b=bounds(part.outer);expect(b[2]).toBeCloseTo(15);expect(b[3]).toBeCloseTo(20);}
  expect(result.layers).toContain('CUT');
});
it('preserves explicit block-child layers and rejects cyclic block expansion',()=>{
  const shapes=poly([[0,0],[10,0],[10,10],[0,10]],'0')+poly([[2,2],[4,2],[4,4],[2,4]],'holes');
  const text=withBlocks(insert('part','8\nCUT\n'),block('part',shapes));
  expect(importDXF(text,'layers.dxf',options).document.parts[0].holes).toHaveLength(1);
  expect(importDXF(text,'layers.dxf',{...options,layers:['CUT']}).document.parts[0].holes).toHaveLength(0);
  const cycle=importDXF(withBlocks(insert('cycle'),block('cycle',insert('cycle'))),'cycle.dxf',options);
  expect(cycle.document.parts).toHaveLength(0);expect(cycle.issues?.join(' ')).toContain('cyclic');
});
it('imports complete ellipses and closed rational quadratic splines',()=>{
  const ellipse='0\nELLIPSE\n10\n0\n20\n0\n11\n10\n21\n0\n40\n0.5\n41\n0\n42\n'+2*Math.PI+'\n';
  const e=importDXF(dxf(ellipse),'ellipse.dxf',options);expect(e.issues).toEqual([]);
  expect(Math.abs(area(e.document.parts[0].outer))).toBeCloseTo(50*Math.PI,0);
  // Rational quadratic quarter circle closed by two lines, radius 10.
  const spline='0\nSPLINE\n70\n4\n71\n2\n72\n6\n73\n3\n'+[0,0,0,1,1,1].map(k=>`40\n${k}\n`).join('')+
    [1,Math.SQRT1_2,1].map(w=>`41\n${w}\n`).join('')+[[10,0],[10,10],[0,10]].map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('');
  const curve=importDXF(dxf(spline+line(0,10,0,0)+line(0,0,10,0)),'spline.dxf',options);
  expect(curve.issues).toEqual([]);expect(Math.abs(area(curve.document.parts[0].outer))).toBeCloseTo(25*Math.PI,0);
  for(const [x,y] of curve.document.parts[0].outer)if(x>0&&y>0)expect(Math.hypot(x,y)).toBeCloseTo(10,6);
});

it('bounds nested INSERT expansion before allocating large arrays',()=>{
  const shape=poly([[0,0],[10,0],[10,10],[0,10]]);
  const blocks=block('part',shape)+block('many',insert('part','70\n100\n44\n20\n'));
  expect(()=>importDXF(withBlocks(insert('many','70\n101\n44\n3000\n'),blocks),'huge.dxf',options)).toThrow('10,000 expanded');
});
