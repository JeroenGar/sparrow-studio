import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('footer aligns actions and shows a reduced-motion-aware spinner while solving',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await workshop(page);
  const footer=page.locator('.statusbar'),run=page.getByRole('button',{name:'Nest parts',exact:true});
  const boxes=await Promise.all([run,footer.getByLabel('Export format'),footer.getByRole('button',{name:'Download SVG'}),footer.getByRole('button',{name:'Diagnostics',exact:true})].map(p=>p.boundingBox()));
  for(const box of boxes){expect(box!.y).toBe(boxes[0]!.y);expect(box!.height).toBe(boxes[0]!.height);}
  const status=(await footer.locator('.run-status').boundingBox())!;
  expect(status.x).toBeGreaterThan(boxes[0]!.x+boxes[0]!.width);
  expect(status.x+status.width).toBeLessThanOrEqual((await footer.locator('.metrics').boundingBox())!.x);
  await run.click();await expect(footer.locator('.run-status i.active')).toHaveCount(1);
  await expect(footer.locator('.run-status i.active').first()).toHaveCSS('animation-name','spin');
  await page.screenshot({path:info.outputPath('spinner-running.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await expect(footer.locator('.run-status i.active').first()).toHaveCSS('animation-name','none');
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(footer.locator('.run-status i.active')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('footer-mobile.png'),fullPage:true});
});

test('library modifier selection imports one atomic batch and clears across collections',async({page})=>{
  await page.goto('/');await workshop(page);await expect(page.locator('.part-select').first()).toBeVisible();const before=await page.locator('.part-select').count();
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const library=page.getByRole('dialog',{name:'Shape library'});await library.getByRole('combobox',{name:'Collection',exact:true}).selectOption('albano');
  const cards=library.locator('.library-grid button');await expect(cards.first()).toBeEnabled();
  await cards.nth(0).click();await cards.nth(2).dispatchEvent('click',{ctrlKey:true});await expect(library.locator('.library-grid [aria-pressed=true]')).toHaveCount(2);
  await cards.nth(2).click({modifiers:['Meta']});await expect(library.locator('.library-grid [aria-pressed=true]')).toHaveCount(1);
  await cards.nth(1).click();await cards.nth(3).click({modifiers:['Shift']});await expect(library.locator('.library-grid [aria-pressed=true]')).toHaveCount(3);
  const names=await library.locator('.library-grid [aria-pressed=true] span').allTextContents();
  await library.getByRole('button',{name:'Add 3 selected shapes to project',exact:true}).click();await expect(library.getByText('3 shapes added to your project.',{exact:true})).toBeVisible();
  await library.getByRole('combobox',{name:'Collection',exact:true}).selectOption('mine');await expect(library.locator('.library-grid [aria-pressed=true]')).toHaveCount(0);
  await library.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.part-select')).toHaveCount(before+3);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const saved=JSON.parse(await readFile((await (await pending).path())!,'utf8'));
  expect(saved.parts.slice(-3).map((p:{name:string})=>p.name)).toEqual(names);expect(new Set(saved.parts.map((p:{id:string})=>p.id)).size).toBe(before+3);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.part-select')).toHaveCount(before);
});

test('two-decimal millimetre fields never round the stored shape on focus and blur',async({page})=>{
  await page.goto('/');await workshop(page);await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Add shape',exact:true});await modal.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill('27.693954');await modal.getByRole('spinbutton',{name:'Height, mm',exact:true}).fill('27.979386');await modal.getByRole('button',{name:'Add shape',exact:true}).click();
  await expect(modal).toHaveCount(0);
  const width=page.getByRole('spinbutton',{name:'Width, mm',exact:true}),height=page.getByRole('spinbutton',{name:'Height, mm',exact:true});
  await expect(width).toHaveValue('27.69');await expect(height).toHaveValue('27.98');
  const save=async()=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();return JSON.parse(await readFile((await (await event).path())!,'utf8'));};
  const before=await save();await width.focus();await width.press('Tab');await height.focus();await height.press('Tab');expect(await save()).toEqual(before);
  const part=before.parts.at(-1);expect(Math.max(...part.outer.map((p:number[])=>p[0]))-Math.min(...part.outer.map((p:number[])=>p[0]))).toBeCloseTo(27.693954,9);
});
