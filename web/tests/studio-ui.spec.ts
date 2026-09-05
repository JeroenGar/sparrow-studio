import {test,expect} from '@playwright/test';

test('selection inspector leaves material in place and header owns contact links',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  const material=page.getByRole('heading',{name:'Material & run'});
  const before=(await material.boundingBox())!;
  const canvasBefore=await page.locator('.workspace-svg').boundingBox();
  expect(canvasBefore!.y).toBe((await page.locator('.canvas-wrap').boundingBox())!.y);
  expect((await page.locator('.canvas-tools').boundingBox())!.y).toBeGreaterThan(canvasBefore!.y);
  const part=page.locator('.part-select').first();await part.click();
  const inspector=page.getByRole('complementary',{name:'Part properties'});
  await expect(inspector).toBeVisible();
  const toolbar=(await page.locator('.canvas-tools').boundingBox())!;expect((await inspector.boundingBox())!.y).toBeGreaterThan(toolbar.y+toolbar.height);
  await expect(page.locator('[data-part]').first().locator('..')).toHaveAttribute('opacity','1');
  await expect(page.locator('[data-part]').nth(1).locator('..')).toHaveAttribute('opacity','0.5');
  expect((await material.boundingBox())!.y).toBe(before.y);
  expect(await page.locator('.workspace-svg').boundingBox()).toEqual(canvasBefore);
  expect((await inspector.boundingBox())!.x).toBeGreaterThan((await page.locator('.drawing-panel').boundingBox())!.x);
  await part.click();await expect(inspector).toHaveCount(0);await expect(page.locator('[data-part]').nth(1).locator('..')).toHaveAttribute('opacity','1');
  await part.click();await page.getByRole('button',{name:'Clear selection'}).click();await expect(inspector).toHaveCount(0);
  const run=page.getByRole('button',{name:'Nest parts',exact:true});expect((await run.boundingBox())!.x).toBeLessThan(30);
  await part.click();await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill('40');await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');
  await expect(run).toBeEnabled();
  await expect(page.getByRole('link',{name:'☆ Star sparrow on GitHub',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Say hello 👋',exact:true}).click();
  await expect(page.getByRole('link',{name:'jeroen.gardeyn@gmail.com',exact:true})).toHaveAttribute('href','mailto:jeroen.gardeyn@gmail.com');
  await expect(page.getByRole('link',{name:'LinkedIn ↗',exact:true})).toHaveAttribute('href','https://www.linkedin.com/in/jeroengardeyn/');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('studio-desktop.png'),fullPage:true});
  for(const width of [900,390]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button',{name:'Clear selection'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Clear selection'})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`studio-${width}.png`),fullPage:true});
  }
});
