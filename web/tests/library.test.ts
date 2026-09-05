import {describe,expect,it} from 'vitest';
import {netArea} from '../src/geometry/validate';
import {newPart,type Part} from '../src/model';
import {LIBRARY_MEDIAN_MM2,normalizeLibraryParts} from '../src/import/library';

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
});
