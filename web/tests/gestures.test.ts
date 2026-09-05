import {expect,test} from 'vitest';
import {moveDelta,preparationCopyOffset,preparationShortcut,resizeEdit,rotationEdit,pinchCamera} from '../src/geometry/gestures';

test('gesture snapping preserves group spacing, uniform scale and rotation pivot',()=>{
  expect(moveDelta([8,12],[10.2,15.3],[.3,.4],1)).toEqual([2.7,3.6]);
  const free=moveDelta([8,12],[10.2,15.3],[.3,.4],0);
  expect(free[0]).toBeCloseTo(2.2);expect(free[1]).toBeCloseTo(3.3);
  expect(resizeEdit([20,10],[40,20],[0,0],1)).toEqual({kind:'scale',factor:2,pivot:[0,0]});
  const crossing=resizeEdit([20,10],[-40,-20],[0,0],1);
  expect(crossing.kind==='scale'&&crossing.factor).toBeGreaterThan(0);
  expect(rotationEdit([1,0],[0,1],[0,0],15)).toEqual({kind:'rotate',degrees:90,pivot:[0,0]});
  expect(rotationEdit([1,0],[Math.cos(.4),Math.sin(.4)],[0,0],15)).toEqual({kind:'rotate',degrees:30,pivot:[0,0]});
});

test('preparation copies use a bounded bottom-left stack and plain-key shortcuts',()=>{
  const offsets=Array.from({length:500},(_,i)=>preparationCopyOffset(i,500,[0,0,10,20]));
  expect(offsets[0]).toEqual([0,0]);
  expect(offsets.at(-1)).toEqual([-1.2,-1.2]);
  expect(offsets.every((offset,i)=>i===0||offset[0]<offsets[i-1][0])).toBe(true);
  expect(preparationCopyOffset(1,2,[0,0,100,100])[0]).toBe(-12);
  expect(preparationCopyOffset(499,500,[0,0,1000,2000])[0]).toBeCloseTo(offsets.at(-1)![0]*100);
  expect(preparationShortcut('R')).toBe('rotate');
  expect(preparationShortcut('+')).toBe('increase-quantity');
  expect(preparationShortcut('_')).toBe('decrease-quantity');
  expect(preparationShortcut('ArrowUp')).toBeUndefined();
});

 test('pinch zoom preserves the touch anchor and pans through letterboxing',()=>{
  const camera={x:0,y:0,w:200,h:100},size={width:200,height:200};
  expect(pinchCamera(camera,size,[[50,100],[150,100]],[[0,120],[200,120]])).toEqual({x:50,y:15,w:100,h:50});
  expect(pinchCamera(camera,size,[[50,100],[150,100]],[[75,100],[125,100]])).toEqual({x:-100,y:-50,w:400,h:200});
  expect(pinchCamera(camera,size,[[50,100],[150,100]],[[100,100],[100,100]])).toEqual(camera);
});
