import {it,expect} from 'vitest';
import {phaseImprovements,type Timing} from '../src/workers/useSolver';
it('separates validated exploration and compression improvements despite delayed validation',()=>{
  const history:Timing[]=[
    {sequence:1,elapsedMs:0,lengthMm:100,phase:'Exploration',validation:'passed'},
    {sequence:2,elapsedMs:1,lengthMm:80,phase:'Exploration',validation:'passed'},
    {sequence:3,elapsedMs:2,lengthMm:50,phase:'Exploration',validation:'failed'},
    {sequence:4,elapsedMs:3,lengthMm:72,phase:'Compression',validation:'passed'},
  ];
  const improvement=phaseImprovements(history,72)!;
  expect(improvement.explore).toBeCloseTo(20);expect(improvement.compress).toBeCloseTo(10);
  expect(phaseImprovements(history.slice(0,2),80)!.compress).toBe(0);
  expect(phaseImprovements([],72)).toBeUndefined();
});
