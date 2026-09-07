import {expect,test,vi} from 'vitest';
import {example,newPartId} from '../src/model';

test('part IDs and examples work without secure-context crypto APIs',()=>{
  const getRandomValues=crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto',{getRandomValues});
  try {
    const ids=[newPartId(),...example().parts.map(part=>part.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for(const id of ids)expect(id).toMatch(/^[0-9a-f]{32}$/);
  } finally {vi.unstubAllGlobals();}
});
