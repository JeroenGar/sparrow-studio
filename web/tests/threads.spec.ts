import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';

for (const isolated of [true, false]) test(`solver threads: ${isolated ? 'parallel static-host startup and restart' : 'serial fallback'}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ serviceWorkers: isolated ? 'allow' : 'block' });
  const page = await context.newPage();
  const cdp = isolated && testInfo.project.name === 'chromium' ? await browser.newBrowserCDPSession() : undefined;
  const poolCount = async () => cdp ? (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'worker' && t.url.includes('rayon.worker')).length : 0;
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try example', exact: true })).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(isolated);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Try example', exact: true }).click();await page.getByRole('button',{name:'Run example',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Try an example'})).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Checked ✓', exact: true })).toBeEnabled({ timeout: 20_000 });
    if (cdp) await expect.poll(poolCount).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    if (cdp) await expect.poll(poolCount).toBe(0);
    await expect(page.getByRole('button', { name: 'Try example', exact: true })).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const path = testInfo.outputPath(`threads-${attempt}.json`);
    await (await pending).saveAs(path);
    const diagnostic = JSON.parse(await readFile(path, 'utf8'));
    expect(diagnostic.buildMode).toMatch(isolated ? /^[2-3] solver threads, no SIMD$/ : /^1 solver thread, no SIMD$/);
    expect(diagnostic.result.validation.status).toBe('passed');
    expect(diagnostic.result.placements).toHaveLength(12);
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
  await page.getByRole('button', { name: 'Try example', exact: true }).waitFor();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.getByRole('button', { name: 'Try example', exact: true }).click();await page.getByRole('button',{name:'Run example',exact:true}).click();
  await expect(page.getByRole('button', { name: 'Checked ✓', exact: true })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  const path = testInfo.outputPath('fallback.json');
  await (await pending).saveAs(path);
  const diagnostic = JSON.parse(await readFile(path, 'utf8'));
  expect(diagnostic.buildMode).toContain('1 solver thread, no SIMD; serial fallback:');
  expect(diagnostic.result.validation.status).toBe('passed');
  } finally { await context.close(); await host.close(); }
});
