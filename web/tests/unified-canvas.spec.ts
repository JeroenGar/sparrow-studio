import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect,type Locator, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

type CopyState={partId:string;copyIndex:number;transform:string|null;geometry:string};
const copies=(page:Page)=>page.locator('.workspace-svg g[data-part][data-copy-index]');
async function copyState(page:Page):Promise<CopyState[]> {
  return copies(page).evaluateAll(nodes=>nodes.map(node=>{
    const shape=node.querySelector('path,use');
    return {partId:node.getAttribute('data-part')!,copyIndex:Number(node.getAttribute('data-copy-index')),transform:node.getAttribute('transform'),geometry:shape?.getAttribute('d')??shape?.getAttribute('href')??''};
  }).sort((a,b)=>a.partId.localeCompare(b.partId)||a.copyIndex-b.copyIndex));
}
function key(copy:Pick<CopyState,'partId'|'copyIndex'>){return `${copy.partId}:${copy.copyIndex}`;}
function signature(copy:Pick<CopyState,'transform'|'geometry'>){return `${copy.transform??''}|${copy.geometry}`;}
async function copyLocator(page:Page,copy:Pick<CopyState,'partId'|'copyIndex'>):Promise<Locator> {
  return page.locator(`g[data-part="${copy.partId}"][data-copy-index="${copy.copyIndex}"]`);
}
async function center(locator:Locator) {
  return locator.evaluate(element=>{
    const shape=element.querySelector('path') as (SVGGeometryElement&SVGGraphicsElement)|null;
    if(!shape||typeof shape.isPointInFill!=='function')throw Error('Unified copy has no SVG path to hit.');
    const box=shape.getBBox(),ctm=shape.getScreenCTM();
    if(!ctm)throw Error('Unified copy has no screen transform.');
    const steps=15,candidates:[[number,number],...Array<[number,number]>]=[[.5,.5]];
    for(let row=0;row<steps;row++)for(let col=0;col<steps;col++)candidates.push([(col+.5)/steps,(row+.5)/steps]);
    for(const [fx,fy] of candidates){
      const local=new DOMPoint(box.x+box.width*fx,box.y+box.height*fy);
      if(!shape.isPointInFill(local))continue;
      const screen=local.matrixTransform(ctm),hit=document.elementFromPoint(screen.x,screen.y);
      if(hit?.closest('g[data-part][data-copy-index]')===element)return {x:screen.x,y:screen.y};
    }
    throw Error('Could not find a visible filled point for the requested unified copy.');
  });
}
async function drag(page:Page,locator:Locator,dx:number,dy:number) {
  const point=await center(locator);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+dx,point.y+dy,{steps:8});await page.mouse.up();
}
async function clickCopy(page:Page,locator:Locator) {
  const point=await center(locator);await page.mouse.click(point.x,point.y);
}
async function openSavedProject(page:Page,path:string) {
  const chooser=page.waitForEvent('filechooser');
  await page.locator('.project-menu>summary').click();await page.getByRole('button',{name:'Open project',exact:true}).click();
  await (await chooser).setFiles(path);await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await page.getByRole('button',{name:'Open project',exact:true}).click();await finishSwitch(page);
}

test('one unified canvas renders every demanded copy without preparation labels or view tabs',async({page})=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  await expect(page.locator('text[data-copy-count]')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('.workspace-svg')).toBeVisible();
});

test('dragging one copy leaves siblings in place and permits overlap',async({page})=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  const before=await copyState(page),targetCopy=before.find(copy=>copy.copyIndex===0)!,siblingCopy=before.find(copy=>copy.partId===targetCopy.partId&&copy.copyIndex!==targetCopy.copyIndex)!;
  const target=await copyLocator(page,targetCopy),sibling=await copyLocator(page,siblingCopy);
  await drag(page,target,20,15);
  await expect.poll(async()=>{const current=await copyState(page);return signature(current.find(copy=>key(copy)===key(targetCopy))!);}).not.toBe(signature(targetCopy));
  const after=await copyState(page),unchanged=after.filter(copy=>key(copy)!==key(targetCopy)).map(copy=>[key(copy),signature(copy)]);
  expect(unchanged).toEqual(before.filter(copy=>key(copy)!==key(targetCopy)).map(copy=>[key(copy),signature(copy)]));
  const targetBox=await target.boundingBox(),siblingBox=await sibling.boundingBox();
  expect(targetBox&&siblingBox).toBeTruthy();
  expect(targetBox!.x).toBeLessThan(siblingBox!.x+siblingBox!.width);expect(siblingBox!.x).toBeLessThan(targetBox!.x+targetBox!.width);
  expect(targetBox!.y).toBeLessThan(siblingBox!.y+siblingBox!.height);expect(siblingBox!.y).toBeLessThan(targetBox!.y+targetBox!.height);
});

test('R rotates only the selected copy and adding quantity preserves existing placements',async({page})=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  const before=await copyState(page),targetCopy=before.find(copy=>copy.copyIndex===0)!,target=await copyLocator(page,targetCopy);
  await clickCopy(page,target);await page.keyboard.press('r');
  await expect.poll(async()=>signature((await copyState(page)).find(copy=>key(copy)===key(targetCopy))!)).not.toBe(signature(targetCopy));
  const rotated=await copyState(page);
  expect(rotated.filter(copy=>key(copy)!==key(targetCopy)).map(copy=>[key(copy),signature(copy)])).toEqual(before.filter(copy=>key(copy)!==key(targetCopy)).map(copy=>[key(copy),signature(copy)]));
  await page.keyboard.press('+');
  await expect.poll(async()=>copies(page).count()).toBe(13);
  const increased=await copyState(page);
  for(const existing of rotated){const current=increased.find(copy=>key(copy)===key(existing));expect(current&&signature(current)).toBe(signature(existing));}
  expect(increased.some(copy=>copy.partId===targetCopy.partId&&copy.copyIndex===3)).toBe(true);
});

test('saving and reopening preserves per-copy placement identities and transforms',async({page},testInfo)=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  const before=await copyState(page),pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const download=await pending,path=testInfo.outputPath('unified.sparrow-project.json');await download.saveAs(path);
  const saved=JSON.parse(await readFile(path,'utf8')) as {placements?:unknown};expect(Array.isArray(saved.placements)).toBe(true);expect(saved.placements).toHaveLength(12);
  await openSavedProject(page,path);
  expect(await copyState(page)).toEqual(before);
});

test('solver completion keeps the same canvas and a manual result edit invalidates export without snapping back',async({page})=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  const canvas=page.locator('.workspace-svg');
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await page.getByRole('button',{name:'Valid ✓',exact:true}).click();
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:30_000});
  const camera=await canvas.getAttribute('viewBox');
  const stop=page.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click();
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  expect(await canvas.getAttribute('viewBox')).toBe(camera);
  const targetCopy=(await copyState(page)).find(copy=>copy.copyIndex===0)!;const target=await copyLocator(page,targetCopy),before=signature(targetCopy);
  await drag(page,target,24,18);
  await expect.poll(async()=>signature((await copyState(page)).find(copy=>key(copy)===key(targetCopy))!)).not.toBe(before);
  const moved=signature((await copyState(page)).find(copy=>key(copy)===key(targetCopy))!);
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeDisabled();
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toHaveCount(0);
  await expect.poll(async()=>signature((await copyState(page)).find(copy=>key(copy)===key(targetCopy))!)).toBe(moved);
  expect(await canvas.getAttribute('viewBox')).toBe(camera);
});
