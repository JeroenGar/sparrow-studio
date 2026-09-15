import {readFile} from 'node:fs/promises';
import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test('JSON import, checked result, serialized export and invalidation',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.locator('input[type=file]').first().setInputFiles('public/examples/swim.json');
  await page.getByRole('button',{name:'Preview import'}).click();
  await expect(page.getByRole('dialog')).toContainText('48 copies');
  await page.getByRole('button',{name:'Open as new project',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.getByLabel('Stop condition').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  await expect(page.getByRole('button',{name:'Best valid solution',exact:true})).toBeEnabled({timeout:20_000});
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled({timeout:30_000});
  await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true});
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download SVG'}).click();
  await (await pending).saveAs(testInfo.outputPath('layout.svg'));
  const diagnostics=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();await page.getByRole('dialog',{name:'Encountering issues?',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await (await diagnostics).saveAs(testInfo.outputPath('diagnostics.json'));
  await page.getByLabel('Material width',{exact:false}).fill('6000');
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
});

test('390px example stays usable and makes no external requests',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const external:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173')&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto('/');await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  await expect(page.getByRole('button',{name:'Best valid solution',exact:true})).toBeEnabled({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled({timeout:30_000});
  await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(external).toEqual([]);
});

test('exports manual and best valid layouts, but never live search',async({page},testInfo)=>{
  await page.goto('/');await workshop(page);
  for(const format of ['SVG','DXF','PDF']){
    await page.getByLabel('Export format',{exact:true}).selectOption(format.toLowerCase());
    await expect(page.getByRole('button',{name:`Download ${format}`,exact:true})).toBeEnabled();
  }
  await page.getByLabel('Export format',{exact:true}).selectOption('svg');
  const manualDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download SVG',exact:true}).click();
  const manualPath=testInfo.outputPath('manual.svg');await(await manualDownload).saveAs(manualPath);
  expect(await readFile(manualPath,'utf8')).toContain('Canvas layout (not checked for nesting)');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await expect(page.getByRole('img',{name:'Live nesting search',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Best valid solution',exact:true})).toBeEnabled();
  await page.locator('.download-control').hover();
  await expect(page.getByRole('tooltip').filter({hasText:'Switch to the best valid solution view to download.'})).toBeVisible();
  await page.getByLabel('Export format',{exact:true}).focus();
  await page.keyboard.press('Tab');
  await page.getByLabel('Export format',{exact:true}).hover();
  await expect(page.locator('#download-tooltip')).toBeVisible();
  for(const format of ['SVG','DXF','PDF']){
    await page.getByLabel('Export format',{exact:true}).selectOption(format.toLowerCase());
    await expect(page.getByRole('button',{name:`Download ${format}`,exact:true})).toBeDisabled();
  }
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Live search',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  for(const format of ['SVG','DXF']){
    await page.getByLabel('Export format',{exact:true}).selectOption(format.toLowerCase());
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:`Download ${format}`,exact:true}).click();
    const path=testInfo.outputPath(`checked.${format.toLowerCase()}`);await(await pending).saveAs(path);
    const text=await readFile(path,'utf8');
    if(format==='SVG'){
      expect(text.match(/<path id="part-/g)).toHaveLength(12);
      expect(text).toContain('Checked nesting layout');
    }else expect(text.match(/LWPOLYLINE/g)).toHaveLength(12);
  }
});
