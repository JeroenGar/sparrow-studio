import {describe,expect,it} from 'vitest';
import {netArea} from '../src/geometry/validate';
import {DEFAULT_SETTINGS,newPart,type Part} from '../src/model';
import {LIBRARY_MEDIAN_MM2,libraryDocument,median,normalizeLibraryParts,normalizeSampleDocument} from '../src/import/library';

const part=(outer:Part['outer'],holes:Part['holes']=[],quantity=1):Part=>({...newPart(outer),id:crypto.randomUUID(),holes,quantity});

describe('shape library normalization',()=>{
  it('uses the median net area of shape types and preserves scale ratios and holes',()=>{
    const source=[
      part([[0,0],[10,0],[10,10],[0,10]],[],5),
      part([[0,0],[20,0],[20,20],[0,20]],[[[5,5],[15,5],[15,15],[5,15]]],2),
      part([[0,0],[30,0],[30,30],[0,30]],[],1),
    ];
    const normalized=normalizeLibraryParts(source);
    const areas=normalized.map(netArea).sort((a,b)=>a-b);
    expect(areas[1]).toBeCloseTo(LIBRARY_MEDIAN_MM2,10);
    expect(netArea(normalized[1])/netArea(normalized[0])).toBeCloseTo(3,10);
    expect(normalized[1].holes).toHaveLength(1);
    const outerArea=netArea({...normalized[1],holes:[]});
    expect((outerArea-netArea(normalized[1]))/outerArea).toBeCloseTo(.25,10);
    expect(normalized.every(({quantity})=>quantity===1)).toBe(true);
  });

  it('normalizes complete samples while scaling the material and retaining demand rules',()=>{
    const first=part([[0,0],[10,0],[10,10],[0,10]],[],4),second=part([[0,0],[20,0],[20,10],[0,10]],[],2);
    first.preparationPosition=[10,15];first.rotations={kind:'continuous'};
    const source={name:'sample',parts:[first,second],settings:{...DEFAULT_SETTINGS,materialWidthMm:80,clearanceMm:2},placements:[{partId:first.id,copyIndex:0,xMm:3,yMm:4,angleDeg:15}]};
    const normalized=normalizeSampleDocument(source),factor=Math.sqrt(LIBRARY_MEDIAN_MM2/median([netArea(first),netArea(second)]));
    expect(median(normalized.parts.map(netArea))).toBeCloseTo(LIBRARY_MEDIAN_MM2,10);
    expect(normalized.parts.map(p=>p.quantity)).toEqual([4,2]);
    expect(normalized.parts[0].rotations).toEqual({kind:'continuous'});
    expect(normalized.parts[0].preparationPosition).toEqual([10*factor,15*factor]);
    expect(normalized.settings.materialWidthMm).toBeCloseTo(80*factor,10);
    expect(normalized.settings.clearanceMm).toBeCloseTo(2*factor,10);
    expect(normalized.placements?.[0]).toMatchObject({partId:first.id,copyIndex:0,xMm:3*factor,yMm:4*factor,angleDeg:15});
  });

  it('normalizes library source documents while resetting demand only for reusable types',()=>{
    const source=JSON.stringify({name:'source',strip_height:80,items:[
      {id:0,demand:4,allowed_orientations:[0,180],shape:{type:'rectangle',data:{x_min:0,y_min:0,width:10,height:10}}},
      {id:1,demand:2,shape:{type:'rectangle',data:{x_min:0,y_min:0,width:20,height:10}}},
    ]});
    const normalized=libraryDocument(source,'source.json'),factor=Math.sqrt(LIBRARY_MEDIAN_MM2/150);
    expect(median(normalized.parts.map(netArea))).toBeCloseTo(LIBRARY_MEDIAN_MM2,10);
    expect(normalized.parts.map(part=>part.quantity)).toEqual([1,1]);
    expect(normalized.parts[0].rotations).toEqual({kind:'discrete',degrees:[0,180]});
    expect(normalized.parts[1].rotations).toEqual({kind:'continuous'});
    expect(normalized.settings.materialWidthMm).toBeCloseTo(80*factor,10);
  });
});
