import {test,expect} from 'vitest';
import {rotationSummary} from '../src/model';

test('rotation summaries describe unique orientations including equivalent and offset angles',()=>{
  expect(rotationSummary({kind:'continuous'})).toBe('Free rotation');
  for(const [degrees,label] of [
    [[0,360,-360],'Fixed'],[[30,210],'Half-turns'],
    [[315,45,135,225],'Quarter-turns'],[[0,45,90],'3 angles'],
  ] as const) expect(rotationSummary({kind:'discrete',degrees:[...degrees]})).toBe(label);
});
