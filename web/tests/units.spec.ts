import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {Project} from '../src/model';

async function project(page:Page):Promise<Project> {
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  return JSON.parse(await readFile((await (await pending).path())!,'utf8'));
}

test('inch display preserves checked millimetre geometry, converts edits, and persists',async({page})=>{
  await page.goto('/');await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  const before=await project(page);expect(before.result?.validation.status).toBe('passed');
  await page.locator('.part-select').first().click();
  const firstWidthMm=Number(await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue());
  const firstWidthIn=Number((firstWidthMm/25.4).toPrecision(9)).toString();
  await page.getByRole('button',{name:'About sparrow/studio',exact:true}).click();await page.getByRole('combobox',{name:'Display units',exact:true}).selectOption('in');await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  await expect(page.getByRole('img',{name:'Checked nesting result'})).toContainText('in ×');
  expect(Number(await page.getByRole('spinbutton',{name:'Width, in',exact:true}).inputValue())).toBeCloseTo(Number(firstWidthIn),3);
  for(const name of ['X, in','Y, in','Width, in','Height, in']) {await page.getByRole('spinbutton',{name,exact:true}).focus();await page.getByRole('spinbutton',{name,exact:true}).press('Tab');}
  await page.getByLabel('Material width',{exact:false}).focus();await page.getByLabel('Material width',{exact:false}).press('Tab');
  expect(await project(page)).toEqual(before);
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  await page.locator('.cad-snapping summary').click();
  await expect(page.getByRole('combobox',{name:'Grid, in',exact:true})).toHaveValue('1');
  await expect(page.getByRole('combobox',{name:'Grid, in',exact:true}).locator('option:checked')).toHaveText('0.0393700787');
  await page.locator('.cad-snapping summary').click();
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const library=page.getByRole('dialog',{name:'Shape library',exact:true});
  await library.getByRole('button',{name:'Save selected shape',exact:true}).click();await library.locator('.library-grid button').first().click();
  await expect(library.getByRole('spinbutton',{name:'Width, in',exact:true})).toHaveValue(/\d/);
  await library.getByRole('spinbutton',{name:'Width, in',exact:true}).fill('2');await library.getByRole('spinbutton',{name:'Width, in',exact:true}).press('Enter');
  await expect(library.getByRole('spinbutton',{name:'Width, in',exact:true})).toHaveValue('2');
  await library.getByRole('button',{name:'Add shape to project',exact:true}).click();await expect(library.getByText('Shape added to your project.',{exact:true})).toBeVisible();
  await library.getByRole('button',{name:'Done',exact:true}).click();
  const resized=await project(page),part=resized.parts.at(-1)!;
  expect(Math.max(...part.outer.map(p=>p[0]))-Math.min(...part.outer.map(p=>p[0]))).toBeCloseTo(50.8,10);
  expect(resized.parts.slice(0,-1).map(p=>p.outer)).toEqual(before.parts.map(p=>p.outer));
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();const shape=page.getByRole('dialog',{name:'Add shape',exact:true});
  await shape.getByRole('spinbutton',{name:'Width, in',exact:true}).fill('2');await shape.getByRole('spinbutton',{name:'Height, in',exact:true}).fill('1');
  await shape.getByRole('button',{name:'Add shape',exact:true}).click();await expect(shape).toHaveCount(0);
  const created=await project(page);expect(created.parts.at(-1)!.outer).toEqual([[0,0],[50.8,0],[50.8,25.4],[0,25.4]]);
  await page.reload();await workshop(page);await page.locator('.part-select').first().click();expect(Number(await page.getByRole('spinbutton',{name:'Width, in',exact:true}).inputValue())).toBeGreaterThan(0);
});
