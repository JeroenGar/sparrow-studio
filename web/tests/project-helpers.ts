import {expect,type Page} from '@playwright/test';
export async function openExamples(page:Page){await page.locator('.project-menu>summary').click();await page.getByRole('button',{name:'Try example',exact:true}).click();}
export async function finishSwitch(page:Page){
  const guard=page.getByRole('dialog',{name:'Unsaved project',exact:true});
  await expect.poll(async()=>await guard.isVisible()||await page.getByRole('dialog').count()===0).toBe(true);
  if(await guard.isVisible())await guard.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
export async function workshop(page:Page){await openExamples(page);await page.getByRole('button',{name:'Open example',exact:true}).click();await finishSwitch(page);}

export async function newProject(page:Page){
  await page.locator('.project-menu>summary').click();
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await finishSwitch(page);
}
