import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importSparrow} from '../src/import/sparrow';

const catalog=JSON.parse(readFileSync('public/examples/catalog.json','utf8')) as {datasets:{id:string;file:string;sha256:string;partTypes:number;copies:number}[]};
it.each(catalog.datasets)('bundled $id retains its source data and imports within launch limits',entry=>{
  const bytes=readFileSync(`public/examples/${entry.file}`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  const review=importSparrow(bytes.toString(),entry.file,1);
  expect(review.document.parts).toHaveLength(entry.partTypes);
  expect(review.document.parts.reduce((n,p)=>n+p.quantity,0)).toBe(entry.copies);
});
