// Serve dist under /repo/ without response headers, then pass that URL.
import {chromium,firefox,webkit} from 'playwright';
import {expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:4177/repo/';
const reports=[];
for(const engine of [chromium,firefox,webkit]) {
  const browser=await engine.launch(),page=await browser.newPage(),escaped=[];
  const cdp=engine===chromium?await browser.newBrowserCDPSession():undefined;
  const poolCount=async()=>cdp?(await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker'&&t.url.includes('rayon.worker')).length:0;
  page.on('request',request=>{if(request.url().startsWith('http:')&&!request.url().startsWith(url))escaped.push(request.url());});
  try {
    await page.goto(url);await page.getByRole('button',{name:'Try example',exact:true}).waitFor();
    expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
    const scope=await page.evaluate(async()=>(await navigator.serviceWorker.ready).scope);expect(scope).toBe(url);
    const runs=[];
    for(let i=0;i<2;i++) {
      console.log(engine.name(), 'run', i+1);
      await page.getByRole('button',{name:'Try example',exact:true}).click();await page.getByRole('button',{name:'Run example',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'Try an example'})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Checked ✓',exact:true})).toBeEnabled({timeout:20_000});
      if(cdp)await expect.poll(poolCount).toBeGreaterThan(1);
      await page.getByRole('button',{name:'Stop',exact:true}).click();
      if(cdp)await expect.poll(poolCount).toBe(0);
      await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled({timeout:30_000}).catch(async error=>{console.log(await page.locator('body').innerText());throw error;});
      const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
      let text='';for await(const chunk of await(await pending).createReadStream())text+=chunk;
      const data=JSON.parse(text);expect(data.buildMode).toMatch(/^[2-3] solver threads, no SIMD$/);
      expect(data.result.validation.status).toBe('passed');expect(data.result.placements).toHaveLength(12);
      runs.push({buildMode:data.buildMode,copies:data.result.placements.length,status:data.result.validation.status});
    }
    await page.getByRole('button',{name:'About sparrow-studio',exact:true}).click();
    const notices=await page.getByRole('link',{name:'Open-source licenses and source code',exact:true}).getAttribute('href');
    const noticeReply=await page.evaluate(async href=>{const response=await fetch(href);return {url:response.url,status:response.status,text:await response.text()};},notices);
    expect(noticeReply.status).toBe(200);expect(noticeReply.url).toBe(`${url}THIRD_PARTY_NOTICES.txt`);expect(noticeReply.text).toContain('jagua');
    expect(escaped).toEqual([]);reports.push({browser:engine.name(),version:browser.version(),scope,runs,notices:noticeReply.url,escapedRequests:escaped,poolDisposalVerified:cdp?true:null});
  }finally{await browser.close();}
}
await writeFile('/tmp/sparrow-subpath-check.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
