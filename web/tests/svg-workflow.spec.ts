import {newProject} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

test('imports stylesheet-driven symbol copies through the WASM parser',async({page})=>{
  await page.goto('/');await newProject(page);
  const source=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="enable-background:new 0 0 100 100">
    <style>.cut {fill:none;stroke:black} .hidden {display:none}</style>
    <rect width="100" height="100" fill="none"/>
    <rect class="hidden" width="100" height="100"/>
    <defs><path id="part" d="M0 0H10V20H0Z"/></defs>
    <g class="cut"><use href="#part"/><use href="#part" transform="translate(30 0) scale(2)"/></g>
  </svg>`;
  const picker=page.waitForEvent('filechooser');
  await page.locator('.empty-project').getByRole('button',{name:'Import shapes',exact:true}).click();
  await(await picker).setFiles({name:'styled.svg',mimeType:'image/svg+xml',buffer:Buffer.from(source)});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('2 part types · 2 copies · 0 holes');
  await page.getByRole('button',{name:'Add 2 shapes to project',exact:true}).click();
  await expect(page.getByText('10 × 20 mm',{exact:true})).toBeVisible();
  await expect(page.getByText('20 × 40 mm',{exact:true})).toBeVisible();
});

for (const isolated of [true, false]) test(`100 mm SVG recovers from exact-fit failure and preserves export (${isolated ? 'threaded' : 'serial'})`,async({browser},testInfo)=>{
  const context=await browser.newContext({serviceWorkers:isolated?'allow':'block'});
  const page=await context.newPage();
  const source='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path fill-rule="evenodd" d="M0 0H100V60H0Z M20 20H40V40H20Z"/></svg>';
  await page.goto('/');await newProject(page);
  await page.locator('input[type=file]').first().setInputFiles({name:'plate.svg',mimeType:'image/svg+xml',buffer:Buffer.from(source)});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 holes');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByText('100 × 60 mm',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>crossOriginIsolated)).toBe(isolated);
  await page.locator('.solver-options>summary').click();
  await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption('2');
  await page.getByLabel('Permitted rotations').selectOption('[0]');
  await page.getByLabel('Material width',{exact:false}).fill('60');
  await page.getByLabel('Clearance', {exact:false}).fill('0');
  await page.getByLabel('Stop condition').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Error',{timeout:20_000});
  await expect(page.getByText(/No valid initial placement could be constructed for item 0/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  const diagnosticDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  const diagnosticPath=testInfo.outputPath('construction-error.json');
  await(await diagnosticDownload).saveAs(diagnosticPath);
  const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));
  expect(diagnostic.stopReason).toContain('No valid initial placement could be constructed for item 0');
  expect(diagnostic.buildMode).toMatch(isolated?/^2 solver threads, SIMD$/:/^1 solver thread, SIMD; serial fallback:/);
  await page.getByLabel('Material width',{exact:false}).fill('62');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download SVG'}).click();
  const path=testInfo.outputPath('plate.svg');await(await pending).saveAs(path);
  const preview=await page.context().newPage();
  await preview.goto(pathToFileURL(path).href);
  const viewport=preview.viewportSize()!,frame=await preview.locator('svg').boundingBox();
  expect(frame!.width).toBeLessThanOrEqual(viewport.width);
  expect(frame!.height).toBeLessThanOrEqual(viewport.height);
  await expect(preview.locator('#parts path')).toHaveAttribute('fill','#fb923c');
  await preview.screenshot({path:testInfo.outputPath('export-preview.png')});
  await preview.close();
  const exported=await readFile(path,'utf8');
  expect(exported.match(/Z/g)).toHaveLength(2);
  await page.locator('input[type=file]').first().setInputFiles(path);
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 holes');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByText('100 × 60 mm',{exact:true})).toHaveCount(2);
  await context.close();
});

test('native dialogs, shape creation, proportional sizing, undo and polygon cancellation',async({page})=>{
  await page.goto('/');await newProject(page);
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Width, mm').fill('75');
  await page.getByRole('dialog').getByLabel('Height, mm').fill('25');
  await page.getByRole('dialog').getByRole('button',{name:'Add shape',exact:true}).click();
  await expect(page.getByText('75 × 25 mm',{exact:true})).toBeVisible();
  await page.getByLabel('Width, mm',{exact:true}).fill('150');
  await page.getByLabel('Width, mm',{exact:true}).press('Enter');
  await expect(page.getByText('150 × 50 mm',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByText('75 × 25 mm',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'Shape',exact:true}).selectOption('polygon');
  await page.getByRole('button',{name:'Start drawing'}).click();
  const canvas=page.getByRole('img',{name:'Preparation drawing'});
  await canvas.click({position:{x:100,y:100}});await canvas.click({position:{x:180,y:100}});await canvas.click({position:{x:140,y:180}});
  await page.getByRole('button',{name:'Finish polygon'}).click();
  await expect(page.locator('.part-select').filter({hasText:'Polygon'})).toBeVisible();
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
