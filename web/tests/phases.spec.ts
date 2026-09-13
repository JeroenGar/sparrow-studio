import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const isolated of [true,false])test(`skip exploration and retain checked output (${isolated?'threaded':'serial'})`,async({browser},testInfo)=>{
  const context=await browser.newContext({serviceWorkers:isolated?'allow':'block'});
  const page=await context.newPage();
  await page.goto('/');
  await expect(page.locator('.part-row')).toHaveCount(50);
  await page.locator('.solver-options>summary').click();
  await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption('2');
  await page.getByLabel('Stop condition').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  const skip=page.getByRole('button',{name:'Skip to compression',exact:true});
  await expect(skip).toBeEnabled({timeout:20000});
  await expect(page.getByRole('status')).toContainText('Exploration');
  await skip.click();
  await expect(page.getByRole('status')).toContainText('Compression',{timeout:20000});
  await expect(skip).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
  await expect(page.getByRole('status')).toHaveText('Complete',{timeout:10000});
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  const path=testInfo.outputPath('phases.json');await(await pending).saveAs(path);
  const diagnostics=JSON.parse(await readFile(path,'utf8'));
  expect(diagnostics.phases.map((p:{phase:string})=>p.phase)).toEqual(['Exploration','Compression']);
  expect(diagnostics.compressionRequestedMs).toBeGreaterThanOrEqual(0);
  expect(diagnostics.result.validation.status).toBe('passed');
  const history=diagnostics.history as {sequence:number;elapsedMs:number}[];
  for(let i=1;i<history.length;i++){
    expect(history[i].sequence).toBeGreaterThan(history[i-1].sequence);
    expect(history[i].elapsedMs).toBeGreaterThanOrEqual(history[i-1].elapsedMs);
  }
  await context.close();
});

for(const action of ['natural','stop'] as const)test(`${action} phase transition`,async({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.part-row')).toHaveCount(50);
  await page.getByLabel('Stop condition').selectOption(action==='natural'?'10':'60');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  const skip=page.getByRole('button',{name:'Skip to compression',exact:true});
  await expect(skip).toBeEnabled({timeout:20000});
  if(action==='stop')await skip.click();
  await expect(page.getByRole('status')).toContainText('Compression',{timeout:20000});
  await expect(skip).toHaveCount(0);
  if(action==='stop')await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText(action==='stop'?'Stopped':'Complete',{timeout:10000});
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  const path=testInfo.outputPath('phases.json');await(await pending).saveAs(path);
  const diagnostics=JSON.parse(await readFile(path,'utf8'));
  expect(diagnostics.phases.map((p:{phase:string})=>p.phase)).toEqual(['Exploration','Compression']);
  if(action==='natural')expect(diagnostics.compressionRequestedMs).toBeUndefined();
});
