import {test,expect} from '@playwright/test';
import {newProject} from './project-helpers';

test.use({serviceWorkers:'block'});

for(const action of ['wait','new','edit','open','failure'] as const) {
  test(`the editor is usable before the default example loads: ${action}`,async({page})=>{
    let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/examples/gardeyn2.json',async route=>{
      await pending;
      if(action==='failure')await route.fulfill({status:503,body:''});
      else await route.fulfill({path:'public/examples/gardeyn2.json',contentType:'application/json'});
    });
    try {
      await page.goto('/');
      await expect(page.getByRole('status')).toHaveText('Loading example…');
      await expect(page.getByRole('button',{name:'Draw shape',exact:true})).toBeEnabled();
      if(action==='new'||action==='failure')await newProject(page);
      if(action==='edit')await page.getByLabel('Material width',{exact:false}).fill('321');
      if(action==='open') {
        await page.locator('input[type=file]').nth(1).setInputFiles({name:'mine.sparrow-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
          schemaVersion:1,revision:1,name:'My saved project',parts:[],settings:{materialWidthMm:432,clearanceMm:0,timeLimitSeconds:null},
        }))});
        await page.getByRole('button',{name:'Preview import',exact:true}).click();
        await page.getByRole('button',{name:'Open project',exact:true}).click();
      }
      release();
      if(action==='wait') {
        await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
        await expect(page.locator('.part-row').first()).toBeVisible();
        await expect(page.locator('.project-status')).toHaveText('No unsaved changes');
      } else {
        await page.waitForLoadState('networkidle');
        await expect(page.locator('.part-row')).toHaveCount(0);
        await expect(page.locator('.project-menu>summary')).toContainText(action==='open'?'My saved project':'Untitled project');
        if(action==='edit'||action==='open')await expect(page.getByLabel('Material width',{exact:false})).toHaveValue(action==='edit'?'321':'432');
        await expect(page.getByRole('alert')).toHaveCount(0);
      }
      await expect(page.getByRole('status')).toHaveText('Ready');
    } finally {release();}
  });
}
