import {workshop} from './project-helpers';
import {test,expect} from '@playwright/test';

test('a selected group of copies moves together and undoes as one edit',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.locator('.part-select').nth(0).click();
  await page.locator('.part-select').nth(1).click({modifiers:['Shift']});
  const groups=page.locator('.workspace-svg g[data-part][data-copy-index]');
  const before=await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  // Copies are intentionally stacked; copy zero is rendered last so its
  // footprint is the direct hit target for a selected part type.
  const targetGroup=groups.nth(8),path=targetGroup.locator('path').first();
  const start=await path.evaluate(node=>{const b=(node as SVGGraphicsElement).getBBox(),p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(node.getScreenCTM()!);return {x:p.x,y:p.y};});
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x+30,start.y+25,{steps:5});await page.mouse.up();
  await expect.poll(()=>targetGroup.getAttribute('transform')).not.toBe(before[8]);
  const after=await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  const translation=(s:string|null)=>s!.match(/translate\(([^)]+)\)/)![1].split(' ').map(Number);
  const delta=(i:number)=>translation(after[i]).map((n,axis)=>n-translation(before[i])[axis]);
  expect(delta(8)[0]).not.toBe(0);expect(delta(9)[0]).toBeCloseTo(delta(8)[0]);expect(delta(9)[1]).toBeCloseTo(delta(8)[1]);
  expect(after.slice(0,6)).toEqual(before.slice(0,6));expect(await page.locator('.part-select[aria-pressed=true]').count()).toBe(2);
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeDisabled();
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
  const widthInput=page.getByRole('spinbutton',{name:'Width, mm',exact:true}),heightInput=page.getByRole('spinbutton',{name:'Height, mm',exact:true});
  await widthInput.fill('72');await widthInput.press('Enter');
  await expect(widthInput).toBeEnabled();await expect(widthInput).toHaveValue('72');const scaledHeight=Number(await heightInput.inputValue());expect(scaledHeight).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Rotate',exact:true}).click();
  await expect(widthInput).toBeEnabled();await expect.poll(async()=>Number(await widthInput.inputValue())).toBeCloseTo(scaledHeight,1);
  await expect.poll(async()=>Number(await heightInput.inputValue())).toBeCloseTo(72,1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(widthInput).toHaveValue('72');
  await expect(page.getByRole('spinbutton',{name:'X, mm',exact:true})).toHaveValue('25');
  await expect(page.getByRole('spinbutton',{name:'Y, mm',exact:true})).toHaveValue('-10');
});
