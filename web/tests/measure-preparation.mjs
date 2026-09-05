// Run against a production preview: node tests/measure-preparation.mjs http://127.0.0.1:4176/
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:4176/';
const browser=await chromium.launch();
const reports=[];
try {
  for(const [types,vertices] of [[500,200],[20,5000]]) {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    try {
    await page.addInitScript(()=>{
      window.preparationMeasure={tasks:[],frames:[],marks:[]};
      new PerformanceObserver(list=>window.preparationMeasure.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
      let last;
      const tick=now=>{if(last!==undefined)window.preparationMeasure.frames.push({start:last,duration:now-last});last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    });
    await page.goto(url);await page.getByRole('button',{name:'Open files',exact:true}).waitFor();
    const mark=async name=>page.evaluate(name=>window.preparationMeasure.marks.push({name,time:performance.now()}),name);
    const outer=Array.from({length:vertices},(_,i)=>{const angle=i*2*Math.PI/vertices;return [10+10*Math.cos(angle),10+10*Math.sin(angle)];});
    const project={schemaVersion:1,revision:1,name:`${types} shapes × ${vertices} vertices`,settings:{materialWidthMm:1000,clearanceMm:0,timeLimitSeconds:10},parts:Array.from({length:types},(_,i)=>({id:`part-${i}`,name:`Part ${i}`,source:{format:'drawn'},outer,holes:[],approximationToleranceMm:0,quantity:1,rotations:{kind:'discrete',degrees:[0]},preparationPosition:[i%25*25,Math.floor(i/25)*25]}))};
    const filePath=`/tmp/sparrow-limit-${types}.sparrow-project.json`;await writeFile(filePath,JSON.stringify(project));
    await mark('file and preview');
    await page.locator('input[type=file]').setInputFiles(filePath);
    await page.getByRole('button',{name:'Preview import',exact:true}).click();
    await page.getByRole('button',{name:'Load project',exact:true}).waitFor({timeout:40_000}).catch(async error=>{console.log(await page.locator('body').innerText());throw error;});
    await mark('accept and render');
    await page.getByRole('button',{name:'Load project',exact:true}).click();
    await page.waitForFunction(n=>document.querySelectorAll('.part-select').length===n,types,{timeout:40_000});
    await page.waitForFunction(n=>document.querySelectorAll('[data-copy-count]').length===n,types,{timeout:40_000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await mark('selection and zoom');
    for(let i=0;i<5;i++) {
      await page.locator('.part-select').nth(i).click();
      await page.getByRole('button',{name:'Zoom in',exact:true}).click();
      await page.getByRole('button',{name:'Zoom out',exact:true}).click();
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await mark('solve and check');
    await page.getByRole('button',{name:'Nest parts',exact:true}).click();
    await page.getByRole('button',{name:'Stop',exact:true}).waitFor({timeout:20_000});
    let stopStarted;
    await page.waitForTimeout(3000);if(await page.getByRole('button',{name:'Stop',exact:true}).isVisible()){stopStarted=Date.now();await page.getByRole('button',{name:'Stop',exact:true}).click();}
    await page.waitForFunction(()=>!/Initializing|Running|Checking/.test(document.querySelector('[role=status]')?.textContent??''),{},{timeout:35_000});
    const stopLatencyMs=stopStarted===undefined?undefined:Date.now()-stopStarted;
    await mark('end');
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostics',exact:true}).click();let diagnosticText='';for await(const chunk of await(await pending).createReadStream())diagnosticText+=chunk;const diagnostics=JSON.parse(diagnosticText);
    const solve={stopLatencyMs,state:await page.getByRole('status').innerText(),buildMode:diagnostics.buildMode,stopReason:diagnostics.stopReason,candidates:diagnostics.history.length,checkedCandidates:diagnostics.history.filter(h=>h.validation).length,bestStatus:diagnostics.result?.validation.status,initializationMs:diagnostics.initializationMs};
    const data=await page.evaluate(()=>window.preparationMeasure);
    reports.push({types,vertices,demandedVertices:types*vertices,browser:browser.version(),solve,phases:data.marks.slice(0,-1).map((mark,i)=>{
      const end=data.marks[i+1].time,tasks=data.tasks.filter(t=>t.start>=mark.time&&t.start<end),frames=data.frames.filter(t=>t.start>=mark.time&&t.start<end);
      return {name:mark.name,elapsedMs:end-mark.time,longTasks:tasks,maxTaskMs:Math.max(0,...tasks.map(t=>t.duration)),maxFrameGapMs:Math.max(0,...frames.map(t=>t.duration))};
    })});
    await page.screenshot({path:`/tmp/sparrow-preparation-${types}.png`});
    } catch(error){reports.push({types,vertices,demandedVertices:types*vertices,error:String(error),ui:await page.locator('body').innerText(),measurement:await page.evaluate(()=>window.preparationMeasure)});}
    await page.close();
    await writeFile('/tmp/sparrow-preparation-performance.json',JSON.stringify(reports,null,2));
  }
} finally {await browser.close();}
await writeFile('/tmp/sparrow-preparation-performance.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(({measurement,ui,...report})=>report),null,2));
if(reports.some(report=>report.error||report.phases.some(phase=>phase.maxTaskMs>100)))process.exitCode=1;
