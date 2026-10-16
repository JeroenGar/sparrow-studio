import './svg-wasm';
import { describe,it,expect } from 'vitest';
import { newPart,DEFAULT_SETTINGS,SHEET_LAYER,defaultDXFLayers,type Job,type Result } from '../src/engine/model';
import { normalizePart,normalizeRing } from '../src/engine/geometry/normalize';
import { validate,worldParts } from '../src/engine/geometry/validate';
import { importSparrow } from '../src/engine/import/sparrow';
import { exportSVG } from '../src/engine/export/svg';
import { exportDXF } from '../src/engine/export/dxf';
import { DOMParser } from '@xmldom/xmldom';
import { importDXF } from '../src/engine/import/dxf';
import type { WorldPart } from '../src/engine/geometry/validate';
import { colors } from '../src/engine/colors';
import { importSVG } from '../src/engine/import/svg';
import { bounds } from '../src/engine/geometry/normalize';

function fixture() {
  const part={...newPart([[0,0],[1,0],[1,1],[0,1]]),id:'square',quantity:2};
  const doc:Job={name:'test',parts:[part],settings:{...DEFAULT_SETTINGS,materialWidthMm:2}};
  const result:Result={documentRevision:1,solverRevision:'test',seed:'42',elapsedSeconds:1,usedLengthMm:2,
    placements:[{partId:part.id,copyIndex:0,xMm:0,yMm:0,angleDeg:0},{partId:part.id,copyIndex:1,xMm:1,yMm:0,angleDeg:0}],
    validation:{status:'pending',overlapAreaMm2:0,maxBoundaryViolationMm:0,minClearanceMm:null,errors:[]}};
  return {doc,result};
}
describe('independent layout validation',()=>{
  it('allows touching at zero clearance and serializes the checked coordinates',()=>{
    const {doc,result}=fixture();result.validation=validate(doc,result);
    expect(result.validation.status).toBe('passed');
    const exported=exportSVG(doc,result);expect(exported.svg).toContain('width="2.2mm"');
    expect(exported.svg).toContain('nested with sparrow studio · https://sparrowstudio.app');
    expect(exported.svg).toContain('<a href="https://sparrowstudio.app"');
    expect(exported.dxf).toContain('nested with sparrow studio');
    expect(exported.dxf).toContain('https://sparrowstudio.app');
    expect(exported.dxf).toContain('SPARROW_INFO');
    expect(exported.world[1].outer).toEqual([[1,0],[2,0],[2,1],[1,1]]);
  });
  it('frames a styled SVG without changing reimported dimensions or adding decorative parts',()=>{
    const {doc,result}=fixture();doc.name='Plate <script> & "test"';
    doc.parts[0].quantity=1;result.placements.pop();
    result.validation=validate(doc,result);
    const {svg}=exportSVG(doc,result);
    expect(svg).toContain('viewBox="-0.1 -0.1 2.2 2.2"');
    expect(new DOMParser().parseFromString(svg,'image/svg+xml').getElementsByTagName('title')[0].textContent).toBe('Plate <script> & "test" — sparrow studio');
    expect(svg).toContain('25.00% used');
    expect(svg).toContain(`fill="${colors[0]}"`);
    const imported=importSVG(svg,'layout.svg',{scale:1,tolerance:.01});
    expect(imported.issues??[]).toEqual([]);
    expect(imported.document.parts).toHaveLength(1);
    for(const part of imported.document.parts){
      const box=bounds(part.outer);
      expect(box[2]-box[0]).toBeCloseTo(1,6);
      expect(box[3]-box[1]).toBeCloseTo(1,6);
    }
  });
  it.each(['missing','duplicate','unknown','reflection','wrong-angle','non-finite','out-of-bounds'] as const)('rejects %s',kind=>{
    const {doc,result}=fixture();
    switch(kind) {
      case 'missing':result.placements.pop();break;
      case 'duplicate':result.placements[1].copyIndex=0;break;
      case 'unknown':result.placements[1].partId='other';break;
      case 'reflection':Object.assign(result.placements[1],{scaleX:-1});break;
      case 'wrong-angle':result.placements[1].angleDeg=90;break;
      case 'non-finite':result.placements[1].xMm=NaN;break;
      case 'out-of-bounds':result.placements[1].xMm=1.00001;break;
    }
    expect(validate(doc,result).status).toBe('failed');
  });
  it('rejects sliver overlap at the specified 1e-8 mm² threshold',()=>{
    const {doc,result}=fixture();result.placements[1].xMm=1-1e-7;
    const check=validate(doc,result);expect(check.status).toBe('failed');expect(check.overlapAreaMm2).toBeGreaterThan(1e-8);
  });
  it('rejects a serialized contour that changes the part even if it still fits',()=>{
    const {doc,result}=fixture(),serialized=worldParts(doc,result);
    serialized[0].outer[1][0]=.9;
    expect(validate(doc,result,serialized)).toMatchObject({status:'failed',errors:['Serialized contours differ from the rigidly transformed input geometry.']});
  });
  it('rejects containment and coincidence, including placement inside a retained hole',()=>{
    const {doc,result}=fixture();result.placements[1].xMm=0;
    expect(validate(doc,result).status).toBe('failed');
    const large={...newPart([[0,0],[10,0],[10,10],[0,10]]),id:'large',holes:[[[2,2],[2,8],[8,8],[8,2]] as [number,number][]]};
    doc.parts[0].quantity=1;doc.parts.push(large);doc.settings.materialWidthMm=10;result.usedLengthMm=10;
    result.placements[0].xMm=4;result.placements[0].yMm=4;result.placements[1]={partId:'large',copyIndex:0,xMm:0,yMm:0,angleDeg:0};
    expect(validate(doc,result).status).toBe('failed');
  });
  it('measures clearance without doubling it',()=>{
    const {doc,result}=fixture();result.usedLengthMm=3;result.placements[1].xMm=2;doc.settings.clearanceMm=1;
    expect(validate(doc,result)).toMatchObject({status:'passed',minClearanceMm:1});
    result.placements[1].xMm=1.9;expect(validate(doc,result).status).toBe('failed');
  });
  it('rejects self-crossing contours and invalid holes',()=>{
    expect(()=>normalizeRing([[0,0],[2,2],[0,2],[2,0]])).toThrow();
    const {doc}=fixture();expect(()=>normalizePart({...doc.parts[0],holes:[[[0,0],[.5,0],[.5,.5]]]})).toThrow();
  });
});
it('JSON preserves rotation semantics, scales geometry and rejects empty orientations',()=>{
  const data={name:'input',strip_height:10,items:[{id:19,demand:2,shape:{type:'rectangle',data:{x_min:10,y_min:20,width:1,height:2}}}]};
  const part=importSparrow(JSON.stringify(data),'input.json',25.4).document.parts[0];
  expect(part.rotations).toEqual({kind:'continuous'});expect(part.outer[2][0]).toBeCloseTo(25.4);expect(part.outer[2][1]).toBeCloseTo(50.8);
  Object.assign(data.items[0],{allowed_orientations:[]});expect(()=>importSparrow(JSON.stringify(data),'input.json',1)).toThrow('nonempty');
});

it('writes a DXF in millimetres with the sheet, parts and credit on their own layers',()=>{
  const {doc,result}=fixture();result.validation=validate(doc,result);
  const text=exportSVG(doc,result).dxf;
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
  expect(review.document.parts.map(part=>[bounds(part.outer),part.holes.length])).toEqual([[[0,0,350,80],1],[[0,0,600,80],0]]);
  expect(importDXF(text,'wide.dxf',{...options,layers:defaultDXFLayers(review.layers!)}).document.parts).toHaveLength(2);
  // Choosing the sheet layer too makes the sheet enclose and cross the parts.
  expect(importDXF(text,'wide.dxf',{...options,layers:review.layers}).issues?.join(' ')).toContain('intersecting')
});
