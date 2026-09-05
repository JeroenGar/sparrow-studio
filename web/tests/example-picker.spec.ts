import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importSparrow} from '../src/import/sparrow';

test('top-bar examples include every benchmark and keep original dimensions and demand',async({page},testInfo)=>{
  const catalog=JSON.parse(await readFile('public/examples/catalog.json','utf8'));
  await page.goto('/');
  await page.getByRole('button',{name:'Try example',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Try an example'}),select=dialog.getByLabel('Dataset');
  await expect(select.locator('option')).toHaveCount(catalog.datasets.length+1);
  await expect(select).toHaveValue('workshop');
  expect(await select.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)))
    .toEqual(['workshop',...['Main','Gardeyn'].flatMap(group=>catalog.datasets.filter((d:{group:string})=>d.group===group).map((d:{id:string})=>d.id))]);
  await select.selectOption('gardeyn0_c');
  await expect(dialog.getByRole('button',{name:'Run example',exact:true})).toBeEnabled();
  await expect(dialog).toContainText('5 shapes · 50 copies');
  await dialog.getByRole('button',{name:'Run example',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  const path=testInfo.outputPath('benchmark.sparrow-project.json');await(await pending).saveAs(path);
  const saved=JSON.parse(await readFile(path,'utf8'));
  const original=importSparrow(await readFile('public/examples/gardeyn0_c.json','utf8'),'gardeyn0_c.json',1).document;
  expect(saved.settings.materialWidthMm).toBe(original.settings.materialWidthMm);
  expect(saved.settings.timeLimitSeconds).toBe(10);
  expect(saved.parts.map((part:{outer:unknown;holes:unknown;quantity:number;rotations:unknown})=>[part.outer,part.holes,part.quantity,part.rotations]))
    .toEqual(original.parts.map(part=>[part.outer,part.holes,part.quantity,part.rotations]));
});
