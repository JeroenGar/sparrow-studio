import './svg-wasm';
import { describe,it,expect } from 'vitest';
import { newPart,DEFAULT_SETTINGS,SHEET_LAYER,defaultDXFLayers,type Job,type Result } from '../src/engine/model';
import { normalizePart,normalizeRing } from '../src/engine/geometry/normalize';
import { worldParts } from '../src/engine/geometry/world';
import { importSparrow } from '../src/engine/import/sparrow';
import { exportSVG } from '../src/engine/export/svg';
import { exportDXF } from '../src/engine/export/dxf';
import { DOMParser } from '@xmldom/xmldom';
import { importDXF } from '../src/engine/import/dxf';
import type { WorldPart } from '../src/engine/geometry/world';
import { colors } from '../src/engine/colors';
import { importSVG } from '../src/engine/import/svg';
import { bounds } from '../src/engine/geometry/normalize';
import { pathData } from '../src/engine/geometry/path';
import parseString from 'dxf/lib/parseString';
import { outline, polygonShape } from '../src/engine/geometry/contour';

function fixture() {
  const part={...newPart(polygonShape([[0,0],[1,0],[1,1],[0,1]])),id:'square',quantity:2};
  const doc:Job={name:'test',parts:[part],settings:{...DEFAULT_SETTINGS,materialWidthMm:2}};
  const result:Result={usedLengthMm:2,
    placements:[{partId:part.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0},{partId:part.id,copyIndex:1,xMm:1,yMm:0,angleDeg:0}]};
  return {doc,result};
}
describe('layout exports',()=>{
  it('writes the placed coordinates with the credit',()=>{
    const {doc,result}=fixture();
    const exported=exportSVG(doc,result,50);expect(exported.svg).toContain('width="2.2mm"');
    expect(exported.svg).toContain('nested with sparrow studio · https://sparrowstudio.app');
    expect(exported.svg).toContain('<a href="https://sparrowstudio.app"');
    expect(exported.dxf).toContain('nested with sparrow studio');
    expect(exported.dxf).toContain('https://sparrowstudio.app');
    expect(exported.dxf).toContain('SPARROW_INFO');
    // The written files hold each copy where it was placed.
    const paths=new DOMParser().parseFromString(exported.svg,'image/svg+xml').getElementsByTagName('path');
    expect(Array.from(paths).map(path=>path.getAttribute('d'))).toEqual([pathData([[[0,0],[1,0],[1,1],[0,1]]]),pathData([[[1,0],[2,0],[2,1],[1,1]]])]);
    const entities=(parseString(exported.dxf) as {entities:{layer:string;vertices?:{x:number;y:number}[]}[]}).entities;
    expect(entities.filter(entity=>entity.layer==='PARTS').map(entity=>entity.vertices!.map(({x,y})=>[x,y]))).toEqual([[[0,0],[1,0],[1,1],[0,1]],[[1,0],[2,0],[2,1],[1,1]]]);
  });
  it('frames a styled SVG without changing reimported dimensions or adding decorative parts',()=>{
    const {doc,result}=fixture();doc.name='Plate <script> & "test"';
    doc.parts[0].quantity=1;result.placements.pop();
    const {svg}=exportSVG(doc,result,25);
    expect(svg).toContain('viewBox="-0.1 -0.1 2.2 2.2"');
    expect(new DOMParser().parseFromString(svg,'image/svg+xml').getElementsByTagName('title')[0].textContent).toBe('Plate <script> & "test" — sparrow studio');
    expect(svg).toContain('25.00% used');
    expect(svg).toContain(`fill="${colors[0]}"`);
    const imported=importSVG(svg,'layout.svg',{scale:1,tolerance:.01});
    expect(imported.issues??[]).toEqual([]);
    expect(imported.document.parts).toHaveLength(1);
    for(const part of imported.document.parts){
      const box=bounds(outline(part.shape).outer);
      expect(box[2]-box[0]).toBeCloseTo(1,6);
      expect(box[3]-box[1]).toBeCloseTo(1,6);
    }
  });
  it('rejects self-crossing contours and invalid holes',()=>{
    expect(()=>normalizeRing([[0,0],[2,2],[0,2],[2,0]])).toThrow();
    const {doc}=fixture();expect(()=>normalizePart({...doc.parts[0],shape:polygonShape(outline(doc.parts[0].shape).outer,[[[0,0],[.5,0],[.5,.5]]])})).toThrow();
  });
});
it('JSON preserves rotation semantics, scales geometry and rejects empty orientations',()=>{
  const data={name:'input',strip_height:10,items:[{id:19,demand:2,shape:{type:'rectangle',data:{x_min:10,y_min:20,width:1,height:2}}}]};
  const part=importSparrow(JSON.stringify(data),'input.json',25.4).document.parts[0];
  expect(part.rotations).toEqual({kind:'continuous'});expect(outline(part.shape).outer[2][0]).toBeCloseTo(25.4);expect(outline(part.shape).outer[2][1]).toBeCloseTo(50.8);
  Object.assign(data.items[0],{allowed_orientations:[]});expect(()=>importSparrow(JSON.stringify(data),'input.json',1)).toThrow('nonempty');
});

it('writes a DXF in millimetres with the sheet, parts and credit on their own layers',()=>{
  const {doc,result}=fixture();
  const text=exportSVG(doc,result,50).dxf;
  expect(text.split('$INSUNITS\n70\n')[1].split('\n')[0].trim()).toBe('4');
  const entities=text.split('2\nENTITIES\n')[1].split('0\nENDSEC')[0];
  expect(entities.match(/\nLWPOLYLINE\n/g)).toHaveLength(3);
  expect(entities).toContain('\n1\nnested with sparrow studio - https://sparrowstudio.app\n');
  expect(text).toMatch(/^[\x20-\x7e\n]*$/);
  expect(record(text,'LAYER',SHEET_LAYER).get('62')).toBe('8');
  for(const layer of ['PARTS','HOLES','SPARROW_INFO'])expect(record(text,'LAYER',layer).get('62')).toBe('7');
  const {extents}=framing(text);expect(extents.slice(0,2)).toEqual([0,0]);expect(extents[2]).toBeGreaterThanOrEqual(2);
});

// The group codes of the named record, up to the next record (first value per code).
function record(text:string,type:string,name:string){
  const lines=text.trimEnd().split('\n'),pairs=Array.from({length:lines.length/2},(_,i)=>[lines[2*i],lines[2*i+1]]);
  const starts=pairs.flatMap(([code,value],i)=>code==='0'&&value===type?[i]:[]);
  for(const start of starts){
    const end=pairs.findIndex(([code],i)=>i>start&&code==='0'),body=pairs.slice(start+1,end);
    if(body.some(([code,value])=>code==='2'&&value===name))return new Map(body.reverse().map(([code,value])=>[code,value]));
  }
  throw Error(`No ${type} ${name}`);
}
// Autodesk Viewer clips to the saved view, so the active viewport must contain the header extents.
function framing(text:string){
  const header=(name:string,code:string)=>+text.split(`$${name}\n`)[1].split(`${code}\n`)[1].split('\n')[0];
  const extents=[header('EXTMIN','10'),header('EXTMIN','20'),header('EXTMAX','10'),header('EXTMAX','20')];
  const vport=record(text,'VPORT','*Active'),field=(code:string)=>{expect(vport.has(code)).toBe(true);return +vport.get(code)!;};
  const [height,width]=[field('40'),field('40')*field('41')];
  const view=[field('12')-width/2,field('22')-height/2,field('12')+width/2,field('22')+height/2];
  expect(view[0]).toBeLessThanOrEqual(extents[0]);expect(view[1]).toBeLessThanOrEqual(extents[1]);
  expect(view[2]).toBeGreaterThanOrEqual(extents[2]);expect(view[3]).toBeGreaterThanOrEqual(extents[3]);
  return {extents,view};
}

it('frames wide layouts with negative coordinates and reimports exports as their parts',()=>{
  const doc:Job={name:'wide',parts:[],settings:{...DEFAULT_SETTINGS,materialWidthMm:100}};
  const world=[{partId:'a',copyIndex:0,outer:[[-50,10],[300,10],[300,90],[-50,90]],holes:[[[0,20],[0,40],[20,40],[20,20]]]},{partId:'a',copyIndex:1,outer:[[400,10],[1000,10],[1000,90],[400,90]],holes:[]}] as WorldPart[];
  const text=exportDXF(doc,world,1000),{extents,view}=framing(text);
  expect(extents.slice(0,3)).toEqual([-50,0,1000]);
  expect(extents[2]-extents[0]).toBeGreaterThan(5*(extents[3]-extents[1]));
  expect(view[2]-view[0]).toBeGreaterThan(extents[2]-extents[0]);
  const options={scale:1,tolerance:.01,enclosed:'holes' as const};
  const review=importDXF(text,'wide.dxf',options);
  expect(review.layers).toEqual(['HOLES','PARTS',SHEET_LAYER]);
  expect(review.document.parts.map(part=>[bounds(outline(part.shape).outer),outline(part.shape).holes.length])).toEqual([[[0,0,350,80],1],[[0,0,600,80],0]]);
  expect(importDXF(text,'wide.dxf',{...options,layers:defaultDXFLayers(review.layers!)}).document.parts).toHaveLength(2);
  // Choosing the sheet layer too makes the sheet enclose and cross the parts.
  expect(importDXF(text,'wide.dxf',{...options,layers:review.layers}).issues?.join(' ')).toContain('intersecting')
});
