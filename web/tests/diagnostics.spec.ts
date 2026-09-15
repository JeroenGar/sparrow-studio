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

for(const threads of [1,3])test(`Info logs survive Stop and phase skip (${threads} workers)`,async({browser},testInfo)=>{
  const context=await browser.newContext({serviceWorkers:'allow'});
  try{
    const page=await context.newPage();await page.goto('/');
    await expect(page.locator('.part-row')).toHaveCount(50);
    await page.locator('.solver-options>summary').click();
    await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption(String(threads));
    await page.evaluate(()=>{
      const state=window as typeof window & {compressionLogged?:boolean};
      window.Worker=class extends Worker {
        constructor(...args:ConstructorParameters<typeof Worker>){
          super(...args);
          this.addEventListener('message',({data})=>{
            if(data.type==='solver-log'&&data.line.includes('[CMPR]'))state.compressionLogged=true;
          });
        }
      };
    });
    await page.getByRole('button',{name:'Nest parts',exact:true}).click();
    const skip=page.getByRole('button',{name:'Skip to compression',exact:true});await expect(skip).toBeEnabled();
    await skip.click();await expect(page.getByRole('status')).toContainText('Compression');
    // The phase notification precedes compression initialization and its first log.
    await page.waitForFunction(()=>(window as typeof window & {compressionLogged?:boolean}).compressionLogged);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
    const path=testInfo.outputPath('diagnostics.zip');await(await pending).saveAs(path);
    const bytes=await readFile(path),logs=archiveEntry(bytes,'solver.log');
    const input=JSON.parse(archiveEntry(bytes,'reproduction/attempt-1/input.json'));
    const request=JSON.parse(archiveEntry(bytes,'reproduction/attempt-1/request.json'));
    const details=await readDiagnostics(path);
    expect(input.items).toHaveLength(50);expect(request.seed).toBe(details.seed);
    expect(request.threads).toBe(threads);
    expect(archiveEntry(bytes,'reproduction/attempt-1/effective-config.txt')).toContain('SparrowConfig');
    expect(details.attempts).toHaveLength(1);
    expect(details.runDocument.parts).toHaveLength(50);
    expect(logs).toContain('INFO');expect(logs).not.toMatch(/(?:DEBUG|TRACE) \[/);
    expect(logs).toContain('[EXPL]');expect(logs).toContain('[CMPR]');
    expect((await readDiagnostics(path)).phases.map((p:{phase:string})=>p.phase)).toEqual(['Exploration','Compression']);
  }finally{await context.close();}
});
