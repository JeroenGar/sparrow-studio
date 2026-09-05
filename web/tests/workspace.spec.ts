import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test('JSON import, checked result, serialized export and invalidation',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.locator('input[type=file]').first().setInputFiles('public/examples/swim.json');
  await page.getByRole('button',{name:'Preview import'}).click();
  await expect(page.getByRole('dialog')).toContainText('48 copies');
  await page.getByRole('button',{name:'Open as new project',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.getByLabel('Run for').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:20_000});
  await expect(page.getByRole('button',{name:'Download SVG'})).toHaveCount(0);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled({timeout:30_000});
  await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true});
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download SVG'}).click();
  await (await pending).saveAs(testInfo.outputPath('layout.svg'));
  const diagnostics=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  await (await diagnostics).saveAs(testInfo.outputPath('diagnostics.json'));
  await page.getByLabel('Material width',{exact:false}).fill('6000');
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeDisabled();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeDisabled();
});

test('390px example stays usable and makes no external requests',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const external:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173')&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto('/');await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:20_000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG'})).toBeEnabled({timeout:30_000});
  await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(external).toEqual([]);
});
