import {test,expect} from '@playwright/test';

test('issue reporting stays in About and follows either diagnostics download',async({page})=>{
  await page.goto('/');
  const issue=page.getByRole('link',{name:'Report an issue on GitHub ↗',exact:true});
  for(const name of ['Help','Say hello 👋']){
    await page.getByRole('button',{name,exact:true}).click();
    await expect(issue).toHaveCount(0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
  }
  for(const mobile of [false,true]){
    if(mobile){
      await page.setViewportSize({width:390,height:844});
      await page.getByRole('button',{name:'About sparrow/studio',exact:true}).click();
      await expect(issue).toBeVisible();
    }
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:mobile?'Download diagnostics':'Diagnostics',exact:true}).click();
    expect((await pending).suggestedFilename()).toBe('sparrow-studio-diagnostics.json');
    const dialog=page.getByRole('dialog',{name:'Encountering issues?',exact:true});
    await expect(dialog).toContainText('attach the downloaded sparrow-studio-diagnostics.json');
    await expect(dialog).toContainText('includes your project shapes and settings');
    await expect(issue).toHaveAttribute('href','https://github.com/JeroenGar/sparrow-studio/issues/new');
    await expect(issue).toHaveAttribute('target','_blank');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
