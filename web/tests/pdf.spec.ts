import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';

test('PDF download contains vector paths instead of an image',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await page.getByLabel('Export format').selectOption('pdf');
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download PDF',exact:true}).click();
  const download=await pending;
  expect(download.suggestedFilename()).toBe('sparrow_studio_gardeyn2.pdf');
  const path=testInfo.outputPath('layout.pdf');await download.saveAs(path);
  const bytes=await readFile(path),text=bytes.toString('latin1');
  expect(text).toMatch(/^%PDF-/);
  expect(text).not.toMatch(/\/Subtype\s*\/Image/);
  const streams=[...text.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)].map(match=>{
    const data=Buffer.from(match[2],'latin1');
    return match[1].includes('/FlateDecode')?inflateSync(data).toString('latin1'):match[2];
  }).join('\n');
  expect((streams.match(/\sm\n/g)??[]).length).toBeGreaterThan(50);
  expect(streams).toContain('B*');
});
