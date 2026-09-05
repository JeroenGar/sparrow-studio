import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';

test('SVG, DXF and project round trips keep file contents and diagnostics off the network',async({page,context},testInfo)=>{
  const marker='private-drawing-739182',requests:{url:string;method:string;body:string|null;headers:Record<string,string>}[]=[],sockets:string[]=[];
  context.on('request',request=>requests.push({url:request.url(),method:request.method(),body:request.postData(),headers:request.headers()}));
  page.on('websocket',socket=>sockets.push(socket.url()));
  const assets=new Set((await readdir('dist',{recursive:true})).map(path=>`/${path}`));assets.add('/');
  await page.goto('/');
  const source=`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path id="${marker}" fill-rule="evenodd" d="M0 0H100V60H0Z M20 20H40V40H20Z"/></svg>`;
  await page.locator('input[type=file]').first().setInputFiles({name:`${marker}.svg`,mimeType:'image/svg+xml',buffer:Buffer.from(source)});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 holes');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Run for').selectOption('10');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Checked ✓',exact:true}).click({timeout:20_000});
  const stop=page.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click();
  for(const format of ['svg','dxf']){
    await page.getByLabel('Export format').selectOption(format);
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:`Download ${format.toUpperCase()}`,exact:true}).click();
    await(await pending).saveAs(testInfo.outputPath(`${marker}.${format}`));
  }
  const projectDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const project=testInfo.outputPath(`${marker}.sparrow-project.json`);await(await projectDownload).saveAs(project);
  const saved=JSON.parse(await readFile(project,'utf8'));expect(saved.result.validation.status).toBe('passed');
  const diagnosticDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  const diagnostics=testInfo.outputPath('diagnostics.json');await(await diagnosticDownload).saveAs(diagnostics);
  expect(await readFile(diagnostics,'utf8')).toContain(marker);
  await page.locator('input[type=file]').first().setInputFiles(testInfo.outputPath(`${marker}.dxf`));
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 holes');
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('input[type=file]').first().setInputFiles(project);
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Saved result rechecked successfully');
  await page.getByRole('button',{name:'Open project',exact:true}).click();await finishSwitch(page);
  await expect(page.getByRole('button',{name:'Download DXF',exact:true})).toBeEnabled();
  expect(sockets).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  for(const request of requests){
    const url=new URL(request.url);
    expect(url.origin).toBe('http://127.0.0.1:4173');
    expect(assets.has(url.pathname),request.url).toBe(true);
    expect(url.search).toBe('');expect(request.method).toBe('GET');expect(request.body).toBeNull();
    expect(JSON.stringify(request)).not.toContain(marker);
  }
});
