import {test,expect} from '@playwright/test';
import {workshop} from './project-helpers';

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
