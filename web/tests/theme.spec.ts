import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test('dark is the default; explicit system and light choices persist',async({page})=>{
  await page.emulateMedia({colorScheme:'light'});await page.goto('/');
  const background=()=>page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
  await expect.poll(background).toBe('rgb(17, 25, 31)');
  await page.getByRole('button',{name:'About sparrow-studio',exact:true}).click();
  await expect(page.getByLabel('Appearance')).toHaveValue('dark');
  await page.getByLabel('Appearance').selectOption('system');
  await expect.poll(background).toBe('rgb(245, 246, 248)');
  await page.emulateMedia({colorScheme:'dark'});
  await expect.poll(background).toBe('rgb(17, 25, 31)');
  await page.reload();
  await page.emulateMedia({colorScheme:'light'});
  await expect.poll(background).toBe('rgb(245, 246, 248)');
  await page.getByRole('button',{name:'About sparrow-studio',exact:true}).click();
  await expect(page.getByLabel('Appearance')).toHaveValue('system');
  await page.getByLabel('Appearance').selectOption('light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect.poll(background).toBe('rgb(245, 246, 248)');
  await page.reload();await expect.poll(background).toBe('rgb(245, 246, 248)');
});

test('dark palette and ghost mode remain clear on desktop and mobile',async({page},testInfo)=>{
  await page.goto('/');
  await openExamples(page);
  await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await expect(page.getByRole('img',{name:'Checked nesting result'})).toBeVisible();
  const stop=page.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click();
  const paths=page.locator('.workspace-svg g[data-part] > path');
  expect(await paths.evaluateAll(nodes=>new Set(nodes.map(n=>n.getAttribute('fill'))).size)).toBe(4);
  await page.screenshot({path:testInfo.outputPath('palette-dark-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('palette-dark-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'👻 mode',exact:true}).click();
  expect(await paths.evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>n.getAttribute('fill')==='white'&&n.getAttribute('fill-opacity')==='0.1'))).toBe(true);
  await expect(page.locator('.workspace-svg > rect').first()).toHaveAttribute('fill','none');
  await page.screenshot({path:testInfo.outputPath('ghost-dark-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({path:testInfo.outputPath('ghost-dark-desktop.png'),fullPage:true});
});
