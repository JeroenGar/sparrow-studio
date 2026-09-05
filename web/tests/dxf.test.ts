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
  const review=importDXF(dxf(rectangle+'0\nSPLINE\n0\nINSERT\n'+line(20,0,30,0)+'30\n1\n'),'mixed.dxf',options);
  expect(review.document.parts).toHaveLength(1);expect(review.warnings.join(' ')).toContain('unsupported SPLINE');expect(review.warnings.join(' ')).toContain('unsupported INSERT');
  expect(review.issues?.join(' ')).toContain('Nonzero elevation');
  expect(importDXF(dxf(rectangle+rectangle),'duplicate.dxf',options).issues?.join(' ')).toContain('duplicate');
  expect(()=>importDXF('AutoCAD Binary DXF\0','binary.dxf',options)).toThrow('Binary DXF');
});
