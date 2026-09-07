import {test,expect} from '@playwright/test';
import {workshop} from './project-helpers';

test('mixed rotations preserve individual rules until an explicit choice, and Undo restores them',async({page})=>{
  await page.goto('/');await workshop(page);
  const parts=page.locator('.part-select'),rotations=page.getByLabel('Permitted rotations');
  await parts.nth(0).click();await rotations.selectOption('[0]');
  await parts.nth(1).click({modifiers:['Shift']});
  await expect(rotations).toHaveValue('mixed');
  await rotations.selectOption('custom');
  await expect(page.getByLabel('Allowed degrees')).toBeVisible();
  await rotations.selectOption('free');await expect(rotations).toHaveValue('free');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(rotations).toHaveValue('mixed');
  await parts.nth(0).click();await expect(rotations).toHaveValue('[0]');
  await parts.nth(1).click();await expect(rotations).toHaveValue('[0,180]');
  await rotations.selectOption('custom');
  await page.getByLabel('Allowed degrees').fill('360, -180, 0');await page.getByLabel('Allowed degrees').press('Enter');
  await parts.nth(2).click({modifiers:['Shift']});
  await expect(rotations).not.toHaveValue('mixed');
  // Equal-size angle sets can still differ, even if both summaries say Half-turns.
  await parts.nth(1).click();
  await rotations.selectOption('custom');await page.getByLabel('Allowed degrees').fill('30, 210');await page.getByLabel('Allowed degrees').press('Enter');
  await parts.nth(2).click({modifiers:['Shift']});await expect(rotations).toHaveValue('mixed');
});

test('Shift-drag selects copies for an atomic move, clone and delete',async({page})=>{
  await page.goto('/');await workshop(page);
  const canvas=page.locator('.workspace-svg'),copies=canvas.locator('g[data-part][data-copy-index]');
  await expect(copies).toHaveCount(12);
  const before=await copies.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('transform'))),camera=await canvas.getAttribute('viewBox');
  const box=await copies.evaluateAll(nodes=>{
    const rects=nodes.map(node=>node.getBoundingClientRect());
    return {left:Math.min(...rects.map(r=>r.left))-3,top:Math.min(...rects.map(r=>r.top))-3,right:Math.max(...rects.map(r=>r.right))+3,bottom:Math.max(...rects.map(r=>r.bottom))+3};
  });
  await page.keyboard.down('Shift');await page.mouse.move(box.left,box.top);await page.mouse.down();await page.mouse.move(box.right,box.bottom,{steps:6});
  await expect(page.locator('[data-selection-marquee]')).toBeVisible();await page.mouse.up();await page.keyboard.up('Shift');
  await expect(page.locator('.part-select[aria-pressed=true]')).toHaveCount(4);expect(await canvas.getAttribute('viewBox')).toBe(camera);
  const x=page.getByRole('spinbutton',{name:'X, mm',exact:true});await x.fill('50');await x.press('Enter');
  await expect(x).toHaveValue('50');
  const moved=await copies.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('transform')));
  const tx=(value:string|null)=>Number(value!.match(/translate\(([^ ]+)/)![1]);
  for(let i=1;i<moved.length;i++)expect(tx(moved[i])-tx(before[i])).toBeCloseTo(tx(moved[0])-tx(before[0]),8);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await copies.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('transform')))).toEqual(before);
  await page.keyboard.press('Control+d');await expect(copies).toHaveCount(24);await expect(page.locator('.part-row')).toHaveCount(4);
  await page.keyboard.press('Backspace');await expect(copies).toHaveCount(12);await expect(page.locator('.part-row')).toHaveCount(4);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(copies).toHaveCount(24);
});


test('remove unused parts clears zero quantities and supports Undo',async({page})=>{
  await page.goto('/');await workshop(page);
  const cleanup=page.getByRole('button',{name:'Remove zero-quantity parts',exact:true});
  const rows=page.locator('.part-row'),quantities=rows.locator('input');
  const count=await rows.count();
  await expect(cleanup).toHaveCount(0);
  await quantities.nth(0).fill('0');await quantities.nth(1).fill('0');
  await cleanup.click();await expect(rows).toHaveCount(count-2);
  await expect(cleanup).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(rows).toHaveCount(count);
  await expect(quantities.nth(0)).toHaveValue('0');await expect(quantities.nth(1)).toHaveValue('0');
  for(let i=0;i<count;i++)await quantities.nth(i).fill('0');
  await cleanup.click();await expect(rows).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(rows).toHaveCount(count);
});

test('removes a populated part with all copies and restores it with Undo',async({page})=>{
  await page.goto('/');await workshop(page);
  const rows=page.locator('.part-row'),count=await rows.count();
  const quantity=await rows.first().locator('input').inputValue();
  const copies=page.locator('.workspace-svg [data-part]'),copyCount=await copies.count();
  await rows.first().getByRole('button',{name:/^Remove /}).click();
  await expect(rows).toHaveCount(count-1);
  await expect(copies).toHaveCount(copyCount-Number(quantity));
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(rows).toHaveCount(count);await expect(copies).toHaveCount(copyCount);
  await expect(rows.first().locator('input')).toHaveValue(quantity);
});
