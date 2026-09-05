import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900}});
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4174/');await page.locator('.project-menu>summary').click();await page.getByRole('button',{name:'Try example',exact:true}).click();await page.getByLabel('Dataset').selectOption('gardeyn3');await page.getByRole('button',{name:'Open example',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelectorAll('[data-part]').length===100);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 const report=await page.evaluate(async()=>{
  const svg=document.querySelector('.workspace-svg'),box=svg.getBoundingClientRect(),frames=[],handler=[];let previous=performance.now();
  for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(now=>{frames.push(now-previous);previous=now;const start=performance.now();for(let j=0;j<4;j++)svg.dispatchEvent(new WheelEvent('wheel',{clientX:box.x+box.width*.55,clientY:box.y+box.height*.55,deltaY:i<60?-2:2,bubbles:true,cancelable:true}));handler.push(performance.now()-start);resolve();}));
  const sorted=frames.slice(2).sort((a,b)=>a-b);return {frames:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted),slowFrames:sorted.filter(n=>n>25).length,maxHandler:Math.max(...handler),paths:svg.querySelectorAll('[data-part]').length};
 });
 const {profile}=await cdp.send('Profiler.stop');const hits={};for(const node of profile.nodes){const key=node.callFrame.functionName||'(anonymous)';hits[key]=(hits[key]??0)+(node.hitCount??0);}report.top=Object.entries(hits).sort((a,b)=>b[1]-a[1]).slice(0,12);
 console.log(JSON.stringify(report,null,2));await writeFile(process.argv[3]??'/tmp/sparrow-navigation.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
