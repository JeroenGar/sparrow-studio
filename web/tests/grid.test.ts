import {expect,test} from 'vitest';
import {coordinateGrid,gridStep} from '../src/geometry/grid';

test('grid ticks use 1/2/5 decades and follow letterboxed Cartesian coordinates',()=>{
  expect([.09,.12,.4,.8,1.1,3,8,11].map(gridStep)).toEqual([.1,.2,.5,1,2,5,10,20]);
  const grid=coordinateGrid({x:0,y:0,w:100,h:50},400,100,1);
  expect(grid.mmPerPixel).toBe(.5);expect(grid.left).toBe(-50);expect(grid.top).toBe(0);
  expect(grid.x.some(t=>t.value<0)).toBe(true);expect(grid.y.every(t=>t.value<=0)).toBe(true);
  expect(grid.x.find(t=>t.value===0)?.major).toBe(true);
  expect(grid.x.length+grid.y.length).toBeLessThan(100);
  const zoomed=coordinateGrid({x:0,y:0,w:10,h:5},400,100,1);
  expect(zoomed.major).toBe(grid.major/10);
  const inches=coordinateGrid({x:0,y:0,w:100,h:50},400,100,25.4);
  expect(inches.major).toBe(2);expect(inches.x.find(t=>t.value===2)?.mm).toBe(50.8);
});
