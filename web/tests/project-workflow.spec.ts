import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('saves a real checked layout, confirms replacement, rechecks load and invalidates on edit',async({page},testInfo)=>{
  await page.goto('/');
  await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const path=testInfo.outputPath('work.sparrow-project.json');await(await pending).saveAs(path);
  const data=JSON.parse(await readFile(path,'utf8'));expect(data.schemaVersion).toBe(1);expect(data.result.placements).toHaveLength(12);
  await page.getByLabel('Material width',{exact:false}).fill('120');
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeDisabled();
  await page.locator('input[type=file]').first().setInputFiles(path);
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Saved result rechecked successfully');
  await page.getByRole('button',{name:'Open project',exact:true}).click();await finishSwitch(page);
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  await expect(page.getByLabel('Material width',{exact:false})).toHaveValue('100');
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
  data.result.placements[0].xMm=-1000;
  await page.locator('input[type=file]').first().setInputFiles({name:'bad.sparrow-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Saved result was discarded');
  await page.getByRole('button',{name:'Open project',exact:true}).click();await finishSwitch(page);
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeEnabled();
});

test('project lifecycle names downloads, guards replacement and reopens an empty project',async({page},testInfo)=>{
  await page.goto('/');
  const menu=async(name:string)=>{await page.locator('.project-menu>summary').click();await page.getByRole('button',{name,exact:true}).click();};
  await menu('Rename project');await page.getByLabel('Project name',{exact:true}).fill('My cutting job');await page.getByRole('button',{name:'Rename',exact:true}).click();
  await expect(page.locator('.project-status')).toHaveText('Unsaved changes');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const file=await download;expect(file.suggestedFilename()).toBe('My cutting job.sparrow-project.json');
  const path=testInfo.outputPath('empty.json');await file.saveAs(path);
  await expect(page.locator('.project-status')).toHaveText('No unsaved changes');
  await workshop(page);
  await menu('New project');await page.getByLabel('Project name',{exact:true}).fill('Second job');await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.getByRole('dialog',{name:'Unsaved project',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.part-row')).toHaveCount(4);
  await menu('New project');await page.getByRole('button',{name:'Create project',exact:true}).click();await finishSwitch(page);
  await expect(page.locator('.part-row')).toHaveCount(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
  await page.locator('input[type=file]').nth(1).setInputFiles(path);await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await page.getByRole('button',{name:'Open project',exact:true}).click();await finishSwitch(page);
  await expect(page.locator('.project-menu>summary')).toContainText('My cutting job');await expect(page.locator('.part-row')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('empty-project-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('.project-menu>summary').click();
  await expect(page.getByRole('button',{name:'New project',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('project-menu-mobile.png'),fullPage:true});
});

test('shape imports always append and preserve project settings, including after saving',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.getByLabel('Material width',{exact:false}).fill('125');
  for(const count of [5,6]){
    if(count===6){const saved=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();await saved;}
    await page.locator('input[type=file]').first().setInputFiles({name:'plate.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')});
    await page.getByRole('button',{name:'Preview import',exact:true}).click();
    await page.getByRole('button',{name:'Add 1 shape to project',exact:true}).click();
    await expect(page.locator('.part-row')).toHaveCount(count);
    await expect(page.locator('.project-menu>summary')).toContainText('Workshop parts');
    await expect(page.getByLabel('Material width',{exact:false})).toHaveValue('125');
  }
  await openExamples(page);await page.getByRole('button',{name:'Open example',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved project',exact:true});
  const saved=page.waitForEvent('download');await guard.getByRole('button',{name:'Download project and continue',exact:true}).click();await saved;
  await expect(page.locator('.part-row')).toHaveCount(4);
  await expect(page.getByLabel('Material width',{exact:false})).toHaveValue('100');
});
