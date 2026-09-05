import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('native auto-termination finishes before the cap and retains a checked export',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({
    name:'one-rectangle.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({name:'One rectangle',strip_height:30,items:[{
      id:0,demand:1,allowed_orientations:[0],
      shape:{type:'rectangle',data:{x_min:0,y_min:0,width:20,height:10}},
    }]})),
  });
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await page.getByRole('button',{name:'Open as new project',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.getByLabel('Run for').selectOption('120');
  const started=Date.now();
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  // Without native early termination this fixture consumes the full 120-second cap.
  await expect(page.getByRole('status')).toHaveText('Complete',{timeout:45_000});
  expect(Date.now()-started).toBeLessThan(60_000);
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click();
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);

  const diagnosticsDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  const diagnosticsPath=testInfo.outputPath('diagnostics.json');
  await(await diagnosticsDownload).saveAs(diagnosticsPath);
  const diagnostics=JSON.parse(await readFile(diagnosticsPath,'utf8'));
  expect(diagnostics.stopReason).toBe('Complete');
  expect(diagnostics.document.settings.timeLimitSeconds).toBe(120);
  expect(diagnostics.result.validation.status).toBe('passed');
  expect(diagnostics.result.placements).toHaveLength(1);
  expect(diagnostics.result.placements[0].angleDeg).toBe(0);
  expect(diagnostics.history.length).toBeGreaterThan(0);
  expect(Math.max(...diagnostics.history.map((item:{elapsedMs:number})=>item.elapsedMs))).toBeLessThan(60_000);

  const svgDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download SVG',exact:true}).click();
  const svgPath=testInfo.outputPath('layout.svg');
  await(await svgDownload).saveAs(svgPath);
  const svg=await readFile(svgPath,'utf8');
  expect(await page.evaluate(text=>new DOMParser().parseFromString(text,'image/svg+xml').querySelectorAll('path').length,svg)).toBe(1);
  await expect(page.getByRole('status')).toHaveText('Complete');
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
});
