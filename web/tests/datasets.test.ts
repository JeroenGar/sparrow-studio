import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importSparrow} from '../src/import/sparrow';
import {LIBRARY_MEDIAN_MM2,median,normalizeSampleDocument} from '../src/import/library';
import {netArea} from '../src/geometry/validate';

const catalog=JSON.parse(readFileSync('public/examples/catalog.json','utf8')) as {datasets:{id:string;file:string;sha256:string;partTypes:number;copies:number}[]};
it.each(catalog.datasets)('bundled $id retains its source data and imports within launch limits',entry=>{
  const bytes=readFileSync(`public/examples/${entry.file}`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  const review=importSparrow(bytes.toString(),entry.file,1);
  expect(review.document.parts).toHaveLength(entry.partTypes);
  expect(review.document.parts.reduce((n,p)=>n+p.quantity,0)).toBe(entry.copies);
  const areas=review.document.parts.map(netArea),factor=Math.sqrt(LIBRARY_MEDIAN_MM2/median(areas)),normalized=normalizeSampleDocument(review.document);
  expect(median(normalized.parts.map(netArea))).toBeCloseTo(LIBRARY_MEDIAN_MM2,8);
  expect(normalized.parts.map(p=>p.quantity)).toEqual(review.document.parts.map(p=>p.quantity));
  expect(normalized.parts.map(p=>p.rotations)).toEqual(review.document.parts.map(p=>p.rotations));
  expect(normalized.settings.materialWidthMm).toBeCloseTo(review.document.settings.materialWidthMm*factor,8);
});
