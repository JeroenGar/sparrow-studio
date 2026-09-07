import {openExamples,workshop,finishSwitch,newProject} from './project-helpers';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';
import { basename, join } from 'node:path';

test('solver preloads before Nest without starting a run',async({page})=>{
  let preloaded=false;
  await page.exposeFunction('solverPreloaded',()=>{preloaded=true;});
  await page.addInitScript(()=>{
    const Original=Worker;
    window.Worker=class extends Original {
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        this.addEventListener('message',event=>{
          if(event.data.type==='preloaded')void (window as unknown as {solverPreloaded:()=>Promise<void>}).solverPreloaded();
        });
      }
    };
  });
  await page.goto('/');
  await expect.poll(()=>preloaded).toBe(true);
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
});

for (const isolated of [true, false]) test(`solver threads: ${isolated ? 'parallel static-host startup and restart' : 'serial fallback'}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ serviceWorkers: isolated ? 'allow' : 'block' });
  const page = await context.newPage();
  const cdp = isolated && testInfo.project.name === 'chromium' ? await browser.newBrowserCDPSession() : undefined;
  const poolCount = async () => cdp ? (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'worker' && t.url.includes('rayon.worker')).length : 0;
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(isolated);
  await page.locator('.solver-options>summary').click();
  await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption('2');
  for (let attempt = 0; attempt < 2; attempt++) {
    await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
    await expect(page.getByRole('dialog',{name:'Try an example'})).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Best valid solution', exact: true })).toBeEnabled({ timeout: 20_000 });
    if (cdp) await expect.poll(poolCount).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    if (cdp) await expect.poll(poolCount).toBe(0);
    await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const path = testInfo.outputPath(`threads-${attempt}.json`);
    await (await pending).saveAs(path);
    const diagnostic = JSON.parse(await readFile(path, 'utf8'));
    expect(diagnostic.solverBinary).toBe(isolated ? 'threaded-simd' : 'serial-simd');
    expect(diagnostic.buildMode).toMatch(isolated ? /^2 solver threads, SIMD$/ : /^1 solver thread, SIMD; serial fallback:/);
    await expect(page.locator('[data-worker-count]')).toHaveAttribute('data-worker-count',isolated?'2':'1');
    await expect(page.locator('[data-worker-count]')).toContainText('/ 2 requested');
    expect(diagnostic.result.validation.status).toBe('passed');
    expect(diagnostic.result.placements).toHaveLength(12);
    const startup=diagnostic.startup;
    expect(startup.preparedMs).toBeGreaterThanOrEqual(0);
    expect(startup.solverReadyMs).toBeGreaterThanOrEqual(startup.preparedMs);
    expect(startup.firstCandidateMs).toBeGreaterThanOrEqual(startup.solverReadyMs);
    expect(startup.firstValidMs).toBeGreaterThanOrEqual(startup.firstCandidateMs);
    expect(startup.firstResultRenderedMs).toBeGreaterThanOrEqual(Math.min(startup.firstValidMs,startup.firstPreviewMs??Infinity));
  }
  await context.close();
});

test('failed pool initialization disposes the pool and retries serially', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const host = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
    plugins: [{ name: 'missing-pool-worker', configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        if (request.url?.includes('/rayon.worker-')) { response.statusCode = 503; response.end(); }
        else next();
      });
    } }] });
  try {
  const page = await context.newPage();
  const address = host.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing preview port');
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator('.project-menu>summary').waitFor();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.locator('.solver-options>summary').click();
  await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption('2');
  await openExamples(page);await page.getByRole('button',{name:'Open and nest',exact:true}).click();await finishSwitch(page);
  await expect(page.getByRole('button', { name: 'Best valid solution', exact: true })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  const path = testInfo.outputPath('fallback.json');
  await (await pending).saveAs(path);
  const diagnostic = JSON.parse(await readFile(path, 'utf8'));
  await expect(page.locator('[data-worker-count]')).toContainText('1 solver worker / 2 requested · fallback');
  expect(diagnostic.solverBinary).toBe('serial-simd');
  expect(diagnostic.buildMode).toContain('1 solver thread, SIMD; serial fallback:');
  expect(diagnostic.result.validation.status).toBe('passed');
  } finally { await context.close(); await host.close(); }
});

for (const threads of [1,2]) test(`SIMD unavailable: SVG import and ${threads} solver threads`, async ({browser},testInfo)=>{
  const context=await browser.newContext({serviceWorkers:'block'});
  const host=await preview({configFile:false,preview:{host:'127.0.0.1',port:0},
    plugins:[{name:'browser-without-simd',configurePreviewServer(server){
      // Serve the override to nested workers too; browser request routing misses those.
      server.middlewares.use(async(request,response,next)=>{
        response.setHeader('Cross-Origin-Opener-Policy','same-origin');
        response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
        if(!request.url?.startsWith('/assets/')||!request.url.endsWith('.js'))return next();
        try {
          const script=await readFile(join('dist/assets',basename(request.url)),'utf8');
          response.setHeader('Content-Type','text/javascript');
          response.end('WebAssembly.validate=()=>false;\n'+script);
        } catch(error){next(error);}
      });
    }}]});
  try {
    const page=await context.newPage();
    const address=host.httpServer.address();
    if(!address||typeof address==='string')throw Error('Missing preview port');
    await page.goto(`http://127.0.0.1:${address.port}/`);await newProject(page);
    expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
    await page.locator('input[type=file]').first().setInputFiles({name:'part.svg',mimeType:'image/svg+xml',
      buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="10" height="15"/></svg>')});
    await page.getByRole('button',{name:'Preview import',exact:true}).click();
    await page.getByRole('button',{name:/^Add 1 shape to project$/}).click();
    await expect(page.getByText('10 × 15 mm',{exact:true})).toBeVisible();
    await page.locator('.solver-options>summary').click();
    await page.getByRole('combobox',{name:'Solver threads',exact:true}).selectOption(String(threads));
    await page.getByRole('button',{name:'Nest parts',exact:true}).click();
    await expect(page.getByRole('button',{name:'Best valid solution',exact:true})).toBeEnabled({timeout:20_000});
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
    const path=testInfo.outputPath('nosimd.json');await(await pending).saveAs(path);
    const diagnostic=JSON.parse(await readFile(path,'utf8'));
    expect(diagnostic.solverBinary).toBe(threads===1?'serial-nosimd':'threaded-nosimd');
    expect(diagnostic.buildMode).toBe(`${threads} solver thread${threads===1?'':'s'}, no SIMD`);
    expect(diagnostic.result.validation.status).toBe('passed');
  } finally {await context.close();await host.close();}
});
