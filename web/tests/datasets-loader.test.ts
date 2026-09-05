import {afterEach,expect,it,vi} from 'vitest';
import {loadCatalog,loadDatasetText} from '../src/datasets';

vi.mock('../src/workers/geometryTask',()=>({
  geometryTask:vi.fn(async (request:{type:string})=>request.type==='import'
    ? {type:'import-review',runId:0,documentRevision:0,review:{document:{name:'sample',parts:[],settings:{materialWidthMm:1000,clearanceMm:0,timeLimitSeconds:null}},warnings:[],replace:false}}
    : {type:'normalized',runId:0,documentRevision:0,document:{name:'sample',parts:[],settings:{materialWidthMm:1000,clearanceMm:0,timeLimitSeconds:null}}})
}));

afterEach(()=>vi.unstubAllGlobals());

it('shares catalog and dataset requests and retries a failed dataset',async()=>{
  const fetchMock=vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({datasets:[]})))
    .mockResolvedValueOnce(new Response('first'))
    .mockResolvedValueOnce(new Response('',{status:503}))
    .mockResolvedValueOnce(new Response('retry'));
  vi.stubGlobal('fetch',fetchMock);
  vi.stubGlobal('document',{baseURI:'https://example.test/'});

  const catalog=await Promise.all([loadCatalog(),loadCatalog()]);
  expect(catalog[0]).toBe(catalog[1]);
  const text=await Promise.all([loadDatasetText('shared.json'),loadDatasetText('shared.json')]);
  expect(text).toEqual(['first','first']);
  await expect(loadDatasetText('retry.json')).rejects.toThrow('Could not load retry.json.');
  await expect(loadDatasetText('retry.json')).resolves.toBe('retry');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('shares parsed example and library work per source file',async()=>{
  const fetchMock=vi.fn().mockImplementation(async()=>new Response('{}'));
  vi.stubGlobal('fetch',fetchMock);
  vi.stubGlobal('document',{baseURI:'https://example.test/'});
  const {loadExample,loadLibrary}=await import('../src/datasets');
  const examples=await Promise.all([loadExample('parsed.json'),loadExample('parsed.json')]);
  expect(examples[0]).toBe(examples[1]);
  expect((await loadLibrary('parsed.json')).length).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const {geometryTask}=await import('../src/workers/geometryTask');
  expect(geometryTask).toHaveBeenCalledTimes(2);
});
