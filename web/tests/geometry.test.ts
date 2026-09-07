import './svg-wasm';
import { describe,it,expect } from 'vitest';
import { newPart,DEFAULT_SETTINGS,type Document,type Result } from '../src/model';
import { normalizePart,normalizeRing } from '../src/geometry/normalize';
import { validate,worldParts } from '../src/geometry/validate';
import { importSparrow } from '../src/import/sparrow';
import { exportSVG } from '../src/export/svg';
import { importSVG } from '../src/import/svg';
import { bounds } from '../src/geometry/normalize';

function fixture() {
  const part={...newPart([[0,0],[1,0],[1,1],[0,1]]),id:'square',quantity:2};
  const doc:Document={name:'test',parts:[part],settings:{...DEFAULT_SETTINGS,materialWidthMm:2}};
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
    expect(exported.svg).toContain('nested with sparrow/studio · https://sparrowstudio.app');
    expect(exported.svg).toContain('<a href="https://sparrowstudio.app"');
    expect(exported.dxf).toContain('nested with sparrow/studio');
    expect(exported.dxf).toContain('https://sparrowstudio.app');
    expect(exported.dxf).toContain('SPARROW_INFO');
    expect(exported.dxf).toContain('290\n0\n');
    expect(exported.world[1].outer).toEqual([[1,0],[2,0],[2,1],[1,1]]);
  });
  it('frames a styled SVG without changing reimported dimensions or adding decorative parts',()=>{
    const {doc,result}=fixture();doc.name='Plate <script> & "test"';
    doc.parts[0].quantity=1;result.placements.pop();
    result.validation=validate(doc,result);
    const {svg}=exportSVG(doc,result);
    expect(svg).toContain('viewBox="-0.1 -0.1 2.2 2.2"');
    expect(svg).toContain('Plate &lt;script&gt; &amp; &quot;test&quot;');
    expect(svg).toContain('25.00% used');
    expect(svg).toContain('fill="#fb923c"');
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

it('exports overlapping manual copies outside the material without moving or certifying them',()=>{
  const {doc,result}=fixture();
  doc.parts[0].holes=[[[.2,.2],[.2,.4],[.4,.4],[.4,.2]]];
  doc.placements=result.placements.map(p=>({...p,xMm:-5,yMm:4}));
  const bundle=exportSVG(doc);
  expect(bundle.world[0].outer).toEqual([[-5,4],[-4,4],[-4,5],[-5,5]]);
  expect(bundle.world[1]).toEqual({...bundle.world[0],copyIndex:1});
  expect(bundle.svg).toContain('not checked for nesting');
  expect(bundle.svg).not.toContain('Checked nesting layout');
  expect(bundle.svg).toContain('viewBox="-5.3 -3.25 6.6 5.5"');
  expect(bundle.dxf).toContain('10\n-5\n20\n4\n');
  expect(bundle.dxf).toContain('HOLES');
});

it('writes unique handles and model-space ownership for strict R2000 importers',()=>{
  const {doc}=fixture(),text=exportSVG(doc).dxf,lines=text.trimEnd().split('\n');
  const pairs=Array.from({length:lines.length/2},(_,i)=>[lines[2*i],lines[2*i+1]]);
  const ids=pairs.filter(([code])=>code==='5').map(([,value])=>value);
  expect(new Set(ids).size).toBe(ids.length);
  for(const [,owner] of pairs.filter(([code])=>code==='330'))expect(owner==='0'||ids.includes(owner)).toBe(true);
  expect(text).toContain('2\nBLOCK_RECORD\n5\n20\n');
  expect(text).toContain('2\n*Model_Space\n');
  expect(text).toContain('2\n*Paper_Space\n');
  expect(text).toContain('2\nBLOCKS\n');
  const entities=text.split('2\nENTITIES\n')[1].split('0\nENDSEC')[0];
  expect(entities.match(/330\n21\n/g)).toHaveLength(3);
});
