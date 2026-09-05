import { expect, test } from '@playwright/test';

test('real swim callbacks, responsive UI, Stop and fresh run', async ({ page }, testInfo) => {
  await page.goto('/bridge.html');
  await page.getByRole('button', { name: 'Run swim' }).click();
  await expect(page.locator('#count')).not.toHaveText('0', { timeout: 20_000 });
  await expect(page.locator('#messages')).toContainText('48 copies');
  const before = Number(await page.locator('#heartbeat').textContent());
  await expect.poll(async () => Number(await page.locator('#heartbeat').textContent())).toBeGreaterThan(before + 2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const retained = await page.locator('#count').textContent();
  await expect(page.locator('#state')).toHaveText('Stopped');
  await expect(page.locator('#count')).toHaveText(retained!);
  await page.getByRole('button', { name: 'Run swim' }).click();
  await expect(page.locator('#state')).toHaveText('Complete', { timeout: 25_000 });
  await expect(page.locator('#messages')).toContainText('48 copies');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  await (await downloadPromise).saveAs(testInfo.outputPath('candidates.json'));
});

test('Stop during initialization allows another run', async ({ page }) => {
  await page.goto('/bridge.html');
  await page.getByRole('button', { name: 'Run swim' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#state')).toHaveText('Stopped');
  await expect(page.getByRole('button', { name: 'Run swim' })).toBeEnabled();
});
