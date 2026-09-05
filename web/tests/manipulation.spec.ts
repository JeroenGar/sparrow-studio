import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test('a selected group moves together, preserves a checked result, and undoes as one edit',async({page})=>{
  await page.goto('/');await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  await page.getByRole('tab',{name:'Prepare',exact:true}).click();
  await page.locator('.part-select').nth(0).click();
  await page.locator('.part-select').nth(1).click({modifiers:['Shift']});
  const groups=page.getByRole('img',{name:'Preparation drawing'}).locator('g[data-part]');
  const before=await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  const path=groups.first().locator('path').first();
  const start=await path.evaluate(node=>{const p=new DOMPoint(6,20).matrixTransform(node.getScreenCTM()!);return {x:p.x,y:p.y};});
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x+30,start.y+25,{steps:5});await page.mouse.up();
  await expect.poll(()=>groups.first().getAttribute('transform')).not.toBe(before[0]);
  const after=await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  const translation=(s:string|null)=>s!.match(/translate\(([^)]+)\)/)![1].split(' ').map(Number);
  const delta=(i:number)=>translation(after[i]).map((n,axis)=>n-translation(before[i])[axis]);
  expect(delta(0)[0]).not.toBe(0);expect(delta(1)[0]).toBeCloseTo(delta(0)[0]);expect(delta(1)[1]).toBeCloseTo(delta(0)[1]);
  expect(after[2]).toBe(before[2]);expect(await page.locator('.part-select[aria-pressed=true]').count()).toBe(2);
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).toEqual(before);
});

test('numeric position, size and rotation preserve geometry and undo restores it',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.locator('.part-select').first().click();
  await page.getByRole('spinbutton',{name:'X, mm',exact:true}).fill('25');
  await page.getByRole('spinbutton',{name:'X, mm',exact:true}).press('Enter');
  await page.getByRole('spinbutton',{name:'Y, mm',exact:true}).fill('-10');
  await page.getByRole('spinbutton',{name:'Y, mm',exact:true}).press('Enter');
  await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill('72');
  await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');
  await expect(page.getByRole('spinbutton',{name:'Height, mm',exact:true})).toHaveValue('76');
  await page.getByRole('button',{name:'Rotate',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue('76');
  await expect(page.getByRole('spinbutton',{name:'Height, mm',exact:true})).toHaveValue('72');
  await expect(page.getByRole('spinbutton',{name:'X, mm',exact:true})).toHaveValue('23');
  await expect(page.getByRole('spinbutton',{name:'Y, mm',exact:true})).toHaveValue('-8');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue('72');
  await expect(page.getByRole('spinbutton',{name:'X, mm',exact:true})).toHaveValue('25');
  await expect(page.getByRole('spinbutton',{name:'Y, mm',exact:true})).toHaveValue('-10');
});
