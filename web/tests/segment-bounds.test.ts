import {expect,test} from 'vitest';
import {intersects} from '../src/geometry/normalize';

test('segment bounds reject only strictly separated boxes, preserving touch and tiny crossings',()=>{
  expect(intersects([0,0],[1,0],[2,0],[3,0])).toBe(false);
  expect(intersects([0,0],[1,0],[1,0],[2,1])).toBe(true);
  expect(intersects([0,0],[2,0],[1,0],[3,0])).toBe(true);
  expect(intersects([0,0],[1,0],[.5,-1e-12],[.5,1e-12])).toBe(true);
  expect(intersects([0,0],[1,0],[0,1e-12],[1,1e-12])).toBe(false);
  expect(intersects([1,1],[0,0],[0,1],[1,0])).toBe(true);
});
