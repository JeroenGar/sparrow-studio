import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('live search shows red overlaps and toggles to independently checked output',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toBeVisible();
  await page.evaluate(()=>{
    const seen={frames:new Set<string>(),overlap:false};
    Object.assign(window,{liveSeen:seen});
    new MutationObserver(()=>{
      const frame=document.querySelector('[data-live-sequence]')?.getAttribute('data-live-sequence');
      if(frame)seen.frames.add(frame);
      if(document.querySelector('[data-overlap]'))seen.overlap=true;
    }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-live-sequence']});
  });
  await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await expect(page.getByRole('img',{name:'Live nesting search'})).toBeVisible({timeout:20_000});
  await page.waitForFunction(()=>{const seen=(window as unknown as {liveSeen:{frames:Set<string>;overlap:boolean}}).liveSeen;return seen.overlap&&seen.frames.size>=3;},{},{timeout:15_000});
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('live.png'),fullPage:true});
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click();
  await expect(page.getByRole('img',{name:'Checked nesting result'})).toBeVisible();
  await expect(page.locator('[data-overlap]')).toHaveCount(0);
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.getByRole('img',{name:'Live nesting search'})).toBeVisible();
  await page.waitForTimeout(350);
  await expect(page.locator('.workspace-svg')).toBeVisible();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const path=testInfo.outputPath('checked.sparrow-project.json');await(await pending).saveAs(path);
  const saved=JSON.parse(await readFile(path,'utf8'));
  expect(saved.result.validation.status).toBe('passed');expect(saved.result.placements).toHaveLength(12);
});
