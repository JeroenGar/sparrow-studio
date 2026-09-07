import {test,expect} from '@playwright/test';

test.use({serviceWorkers:'block'});
test('analytics loads only on the public domain with the supplied token',async({page,request})=>{
  let beacons=0;
  await page.route('https://static.cloudflareinsights.com/beacon.min.js',async route=>{
    beacons++;
    await route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:'window.beaconLoaded = true;'});
  });
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toBeVisible();
  expect(beacons).toBe(0);
  await page.route('https://sparrowstudio.app/**',async route=>{
    const url=new URL(route.request().url());
    await route.fulfill({response:await request.get(`http://127.0.0.1:4173${url.pathname}${url.search}`)});
  });
  await page.goto('https://sparrowstudio.app/');
  await expect.poll(()=>beacons).toBe(1);
  await page.waitForFunction(()=>Reflect.get(window,'beaconLoaded')===true);
  const beacon=page.locator('script[data-cf-beacon]');
  await expect(beacon).toHaveAttribute('type','module');
  expect(JSON.parse((await beacon.getAttribute('data-cf-beacon'))!)).toEqual({token:'570458f3f91e4805b21cdc84923f0057'});
});
