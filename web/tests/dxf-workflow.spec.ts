import {newProject} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('DXF layer review, explicit exclusions, real nesting and export round trip',async({page},testInfo)=>{
  await page.goto('/');await newProject(page);
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/plate.dxf');
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('1 holes');
  await expect(dialog).toContainText('ambiguous junctions');
  await expect(page.getByRole('button',{name:/^Add \d+ shapes? to project$/})).toBeDisabled();
  await page.getByLabel('Exclude the listed invalid contours').check();
  await expect(page.getByRole('button',{name:/^Add \d+ shapes? to project$/})).toBeEnabled();
  await page.getByLabel('CONSTRUCTION',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Update preview',exact:true}).click();
  await expect(dialog).not.toContainText('ambiguous junctions');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByText('100 × 60 mm',{exact:true})).toBeVisible();
  await page.getByLabel('Stop condition').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByLabel('Export format').selectOption('dxf');
  await expect(page.getByRole('button',{name:'Download DXF'})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download DXF'}).click();
  const path=testInfo.outputPath('plate.dxf');await(await pending).saveAs(path);
  const exported=await readFile(path,'utf8');expect(exported.match(/LWPOLYLINE/g)).toHaveLength(2);
  expect(exported).toContain('$INSUNITS\n70\n4');
  await page.locator('input[type=file]').first().setInputFiles(path);
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(dialog).toContainText('1 part types · 1 copies · 1 holes');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByText('100 × 60 mm',{exact:true})).toBeVisible();
});


test('nested DXF block arrays import transformed parts and holes',async({page})=>{
  await page.goto('/');await newProject(page);
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/blocks.dxf');
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('2 part types · 2 copies · 2 holes');
  await expect(dialog.getByText('30 × 40 mm · 1 copies · 1 holes',{exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'Add 2 shapes to project',exact:true}).click();
  await expect(page.locator('.part-row')).toHaveCount(2);
  await page.getByLabel('Stop condition').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible();
  const stop=page.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click();
});
