import {test,expect} from '@playwright/test';
import {openExamples,newProject} from './project-helpers';

test('gardeyn2 loads without solving, rotation labels are visible and dialogs stay compact',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.getByRole('button',{name:'Toggle light/dark mode'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Toggle light/dark mode'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.locator('.workspace-svg').click({position:{x:35,y:60}});
  await expect(page.locator('.workspace-svg')).toHaveCSS('outline-style','none');
  await expect(page.locator('nav').getByRole('link',{name:'Read the paper',exact:true})).toHaveAttribute('href','https://arxiv.org/abs/2509.13329');
  await expect(page.getByLabel('Stop condition')).toHaveValue('auto');
  await expect(page.locator('.rotation-summary').first()).not.toBeEmpty();
  await expect(page.locator('.run-status i.active')).toHaveCount(0);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if(viewport.width===1440){
      const project=await page.locator('.project-menu>summary').boundingBox(),save=await page.getByRole('button',{name:'Save project',exact:true}).boundingBox();
      expect(project!.height).toBeCloseTo(save!.height,0);
    }
    await openExamples(page);
    const dialog=page.getByRole('dialog');
    const box=await dialog.boundingBox();
    expect(box!.height).toBeLessThan(400);
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    expect((await dialog.getByRole('combobox').boundingBox())!.height).toBeLessThan(60);
    await page.screenshot({path:testInfo.outputPath(`examples-${viewport.width}.png`)});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'About sparrow/studio',exact:true}).click();
    await expect(dialog).toContainText('A native sparrow binary runs about 2× as fast');
    expect((await dialog.boundingBox())!.height).toBeLessThan(viewport.height);
    expect((await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox())!.height).toBeLessThan(60);
    await page.screenshot({path:testInfo.outputPath(`about-${viewport.width}.png`)});
    await page.keyboard.press('Escape');
  }
  await newProject(page);
  await expect(page.locator('.part-row')).toHaveCount(0);
  await expect(page.getByLabel('Stop condition')).toHaveValue('auto');
});

test.describe('failed startup',()=>{
  test.use({serviceWorkers:'block'});
test('a failed default demo download leaves project creation available',async({page})=>{
  await page.route('**/examples/gardeyn2.json',route=>route.fulfill({status:503,body:''}));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The demo could not load');
  await newProject(page);
  await expect(page.getByRole('button',{name:'Draw shape',exact:true})).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

});
