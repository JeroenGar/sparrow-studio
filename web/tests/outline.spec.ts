import {test,expect} from '@playwright/test';

test('outlines preserve interior selection and dragging across drawing views',async({page},testInfo)=>{
  await page.goto('/');
  const toggle=page.getByRole('button',{name:'👻 mode',exact:true});
  const paths=page.locator('.workspace-svg g[data-part] > path');
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  expect(await paths.evaluateAll(nodes=>nodes.every(n=>n.getAttribute('fill')==='white'&&n.getAttribute('fill-opacity')==='0.1'))).toBe(true);
  const first=paths.first();
  const before=await first.evaluate(node=>node.parentElement!.getAttribute('transform'));
  const start=await first.evaluate(node=>{const p=new DOMPoint(6,20).matrixTransform(node.getScreenCTM()!);return {x:p.x,y:p.y};});
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x+25,start.y+20,{steps:5});await page.mouse.up();
  await expect(page.locator('.part-select').first()).toHaveAttribute('aria-pressed','true');
  expect(await first.evaluate(node=>node.parentElement!.getAttribute('transform'))).not.toBe(before);
  await page.screenshot({path:testInfo.outputPath('outlines-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(toggle).toBeVisible();
  const box=await toggle.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('outlines-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:720});
  await page.evaluate(()=>{
    Object.assign(window,{outlineOverlapSeen:false});
    new MutationObserver(()=>{
      const overlaps=[...document.querySelectorAll('[data-overlap]')];
      if(overlaps.length&&overlaps.every(n=>n.getAttribute('fill')==='none'&&n.getAttribute('stroke')==='#c72b36'))Object.assign(window,{outlineOverlapSeen:true});
    }).observe(document.body,{subtree:true,childList:true});
  });
  await page.getByRole('button',{name:'Try example',exact:true}).click();await page.getByRole('button',{name:'Run example',exact:true}).click();
  await expect(page.getByRole('img',{name:'Live nesting search'})).toBeVisible({timeout:20_000});
  expect(await paths.evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>n.getAttribute('fill')==='white'&&n.getAttribute('fill-opacity')==='0.1'))).toBe(true);
  await page.waitForFunction(()=>Reflect.get(window,'outlineOverlapSeen')===true,{},{timeout:15_000});
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await expect(page.getByRole('img',{name:'Checked nesting result'})).toBeVisible();
  await expect(page.locator('.workspace-svg > rect')).toHaveAttribute('fill','none');
  expect(await paths.evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>n.getAttribute('fill')==='white'&&n.getAttribute('fill-opacity')==='0.1'))).toBe(true);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('outlines-checked-light.png'),fullPage:true});
  await page.emulateMedia({colorScheme:'dark'});
  await page.screenshot({path:testInfo.outputPath('outlines-checked-dark.png'),fullPage:true});
  await toggle.focus();await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  expect(await paths.evaluateAll(nodes=>nodes.every(n=>n.getAttribute('fill')!=='none'))).toBe(true);
});
