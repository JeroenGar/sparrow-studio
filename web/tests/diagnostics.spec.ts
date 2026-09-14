import {archiveEntry,readDiagnostics} from './diagnostics-helpers';
import {readFile} from 'node:fs/promises';
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
    expect((await pending).suggestedFilename()).toBe('sparrow-studio-diagnostics.zip');
    const dialog=page.getByRole('dialog',{name:'Encountering issues?',exact:true});
    await expect(dialog).toContainText('attach the downloaded sparrow-studio-diagnostics.zip');
    await expect(dialog).toContainText('includes your project shapes and settings');
    await expect(issue).toHaveAttribute('href','https://github.com/JeroenGar/sparrow-studio/issues/new');
    await expect(issue).toHaveAttribute('target','_blank');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

for(const isolated of [true,false])test(`Info logs survive Stop and phase skip (${isolated?'threaded':'serial'})`,async({browser},testInfo)=>{
  const context=await browser.newContext({serviceWorkers:isolated?'allow':'block'});
  try{
    const page=await context.newPage();await page.goto('/');
    await expect(page.locator('.part-row')).toHaveCount(50);
    await page.getByRole('button',{name:'Nest parts',exact:true}).click();
    const skip=page.getByRole('button',{name:'Skip to compression',exact:true});await expect(skip).toBeEnabled();
    await skip.click();await expect(page.getByRole('status')).toContainText('Compression');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
    const path=testInfo.outputPath('diagnostics.zip');await(await pending).saveAs(path);
    const logs=archiveEntry(await readFile(path),'solver.log');
    expect(logs).toContain('INFO');expect(logs).not.toMatch(/(?:DEBUG|TRACE) \[/);
    expect(logs).toContain('[EXPL]');expect(logs).toContain('[CMPR]');
    expect((await readDiagnostics(path)).phases.map((p:{phase:string})=>p.phase)).toEqual(['Exploration','Compression']);
  }finally{await context.close();}
});
