import {test,expect} from '@playwright/test';

test.use({serviceWorkers:'block'});

test('search metadata, sitemap and sharing image are available without rendering',async({request})=>{
  const response=await request.get('/');
  expect(response.ok()).toBe(true);
  const html=await response.text();
  expect(html).toContain('<link rel="canonical" href="https://sparrowstudio.app/">');
  expect(html).toContain('property="og:url" content="https://sparrowstudio.app/"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('<title>sparrow/studio | Free online nesting software</title>');
  expect(html).toContain('property="og:title" content="sparrow/studio: Free web-based nesting editor"');
  expect(html).toContain('Free online nesting software');
  expect(html).toContain('Printing and print-and-cut');
  expect(html).toContain('id="nesting-heading"');
  const imageUrl=html.match(/property="og:image" content="([^"]+)"/)![1];
  expect(imageUrl).toBe('https://sparrowstudio.app/sparrow-studio-social.png');
  const image=await request.get(new URL(imageUrl).pathname);
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/png');
  const png=await image.body();
  // Signal Desktop refuses preview images larger than 1 MiB.
  expect(png.byteLength).toBeLessThan(1024*1024);
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(726);
  expect(await(await request.get('/robots.txt')).text()).toContain('Sitemap: https://sparrowstudio.app/sitemap.xml');
  expect(await(await request.get('/sitemap.xml')).text()).toContain('<loc>https://sparrowstudio.app/</loc>');
});

for(const javaScriptEnabled of [true,false]) {
  test.describe(javaScriptEnabled?'with editor':'without JavaScript',()=>{
    test.use({javaScriptEnabled});
    test('the introduction is collapsed, keyboard accessible and readable on desktop and mobile',async({page},testInfo)=>{
      const imageRequests:string[]=[];
      page.on('request',request=>{if(request.url().includes('sparrow-studio-social'))imageRequests.push(request.url());});
      await page.goto('/');
      if(javaScriptEnabled)await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:900});
        if(javaScriptEnabled) {
          await expect(page.locator('body>.nesting-about>summary')).toBeVisible();
          if(width===1440)expect((await page.locator('.app').boundingBox())!.height).toBe(900);
        }
        const summary=page.locator('.nesting-about>summary');
        await summary.scrollIntoViewIfNeeded();
        await expect(page.getByRole('heading',{name:'Free web-based nesting editor for laser cutting, CNC and fabric'})).toBeHidden();
        await summary.focus();await page.keyboard.press('Enter');
        await expect(page.getByRole('heading',{name:'Free web-based nesting editor for laser cutting, CNC and fabric'})).toBeVisible();
        const section=page.locator('.nesting-about>section');
        await expect(section).toContainText('Printing and print-and-cut');
        const box=await section.boundingBox();
        await section.scrollIntoViewIfNeeded();
        expect(box!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({path:testInfo.outputPath(`about-nesting-${width}.png`)});
        await summary.focus();await page.keyboard.press('Enter');
        await expect(section).toBeHidden();
        if(javaScriptEnabled){
          await page.getByRole('button',{name:'About sparrow/studio',exact:true}).click();
          await page.getByRole('link',{name:'About 2D nesting: uses, workflow and limitations'}).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(section).toBeVisible();
          await expect(summary).toBeInViewport();
          await summary.click();
        }
      }
      expect(imageRequests).toEqual([]);
    });
  });
}
