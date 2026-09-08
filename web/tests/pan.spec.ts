import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test('Space-drag pans over a part after the canvas gains focus',async({page})=>{
  await page.goto('/');await workshop(page);
  const svg=page.locator('.workspace-svg'),copies=svg.locator('[data-part]');
  const start=await copies.nth(8).locator('path').evaluate(node=>{const b=(node as SVGGraphicsElement).getBBox(),p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(node.getScreenCTM()!);return {x:p.x,y:p.y};});
  await page.mouse.click(start.x,start.y);await expect(svg).toBeFocused();
  const before=await svg.getAttribute('viewBox'),shapes=await copies.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(start.x+30,start.y+20,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
  expect(await svg.getAttribute('viewBox')).not.toBe(before);
  expect(await copies.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).toEqual(shapes);
  await expect(copies.nth(8).locator('title')).toContainText('selected');
});

test('dragging outside the bin pans without Space and preserves the checked layout',async({page})=>{
  await page.goto('/');
  await openExamples(page);
  await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
  const svg=page.getByRole('img',{name:'Valid nesting result'});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  const before=await svg.getAttribute('viewBox');
  const shapes=await svg.locator('[data-part]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  const start=await svg.evaluate(node=>{
    const bin=node.querySelector(':scope > rect')!;
    const p=new DOMPoint(Number(bin.getAttribute('width'))+2,-Number(bin.getAttribute('height'))/2).matrixTransform((node as SVGSVGElement).getScreenCTM()!);
    return {x:p.x,y:p.y};
  });
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x-30,start.y+20,{steps:5});await page.mouse.up();
  expect(await svg.getAttribute('viewBox')).not.toBe(before);
  expect(await svg.locator('[data-part]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).toEqual(shapes);
  if(await page.getByRole('button',{name:'Stop',exact:true}).count())await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
});
