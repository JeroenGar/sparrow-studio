import {test,expect} from '@playwright/test';

test('rulers align with world coordinates through zoom, resize and unit changes',async({page},testInfo)=>{
  await page.goto('/');
  const rulers=page.getByRole('img',{name:'Coordinate rulers, mm'});
  await expect(rulers).toBeVisible();
  const checkAlignment=async()=>{
    await expect.poll(async()=>{const errors=await page.evaluate(()=>{
      const svg=document.querySelector('.workspace-svg') as SVGSVGElement,ruler=document.querySelector('.coordinate-rulers') as SVGSVGElement;
      return [...ruler.querySelectorAll<SVGTextElement>('text[data-axis]')].map(text=>{
        const mm=Number(text.dataset.value)*(ruler.getAttribute('aria-label')?.endsWith('in')?25.4:1);
        if(text.dataset.axis==='y'){
          const world=new DOMPoint(0,-mm).matrixTransform(svg.getScreenCTM()!);
          const label=new DOMPoint(0,0).matrixTransform(text.getScreenCTM()!);
          return Math.abs(world.y-label.y-3);
        }
        const world=new DOMPoint(mm,0).matrixTransform(svg.getScreenCTM()!);
        const tick=new DOMPoint(text.x.baseVal.getItem(0).value-3,0).matrixTransform(ruler.getScreenCTM()!);
        return Math.abs(world.x-tick.x);
      });
    });
    return errors.length>2?Math.max(...errors):Infinity;}).toBeLessThan(.05);
  };
  await checkAlignment();
  const first=Number(await page.locator('[data-grid-step]').getAttribute('data-grid-step'));
  for(let i=0;i<6;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  expect(Number(await page.locator('[data-grid-step]').getAttribute('data-grid-step'))).toBeLessThan(first);
  await checkAlignment();
  await page.getByRole('button',{name:'About sparrow-studio',exact:true}).click();await page.getByLabel('Display units').selectOption('in');await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('img',{name:'Coordinate rulers, in'})).toBeVisible();await checkAlignment();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Fit',exact:true}).click();await checkAlignment();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath('grid-mobile.png'),fullPage:true});
});

test('background click clears selection while a background drag still pans',async({page})=>{
  await page.goto('/');await page.locator('.part-select').first().click();
  const svg=page.locator('.workspace-svg');const box=(await svg.boundingBox())!;
  const before=await svg.getAttribute('viewBox');
  await page.mouse.click(box.x+30,box.y+box.height-30);
  await expect(page.locator('.part-select[aria-pressed=true]')).toHaveCount(0);
  await page.mouse.move(box.x+30,box.y+box.height-30);await page.mouse.down();await page.mouse.move(box.x+65,box.y+box.height-50,{steps:4});await page.mouse.up();
  expect(await svg.getAttribute('viewBox')).not.toBe(before);
});
