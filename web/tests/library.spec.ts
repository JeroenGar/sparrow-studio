import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importSparrow} from '../src/import/sparrow';
import {normalizeSampleDocument} from '../src/import/library';

test('personal shapes persist and dataset shapes resize independently',async({page},testInfo)=>{
  await page.goto('/');await workshop(page);await page.locator('.part-select').first().click();
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Shape library',exact:true});
  await dialog.getByRole('button',{name:'Save selected shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await workshop(page);await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.locator('.library-grid button').first().click();
  const width=dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}),height=dialog.getByRole('spinbutton',{name:'Height, mm',exact:true});
  const originalWidth=Number(await width.inputValue()),originalHeight=Number(await height.inputValue()),doubledWidth=originalWidth*2;
  await width.fill(String(doubledWidth));
  await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');
  await expect.poll(async()=>Number(await width.inputValue())).toBeCloseTo(doubledWidth,1);
  await expect.poll(async()=>Number(await height.inputValue())).toBeCloseTo(originalHeight*2,1);
  await dialog.getByRole('button',{name:'Save as new personal shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(2);
  await dialog.getByRole('navigation',{name:'Source files'}).getByRole('button',{name:/^albano albano\.json/}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(8);
  await expect(dialog.getByRole('navigation',{name:'Source files'}).getByRole('button')).toHaveCount(35);
  await dialog.locator('.library-grid button').first().click();
  await expect(dialog.getByRole('button',{name:'Add shape to project'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Add shape to project',exact:true}).click();
  await expect(dialog.getByText('Shape added to your project.',{exact:true})).toBeVisible();
  await expect(page.locator('.part-select')).toHaveCount(5);
  await page.screenshot({path:testInfo.outputPath('library-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('library-mobile.png'),fullPage:true});
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('gardeyn0_c');
  await expect(dialog.locator('.library-grid button')).toHaveCount(5);
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('mine');
  const widths:number[]=[];
  for(let i=0;i<2;i++){
    await dialog.locator('.library-grid button').nth(i).click();
    widths.push(Number(await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue()));
  }
  const remainingWidth=widths[0];
  widths.sort((a,b)=>a-b);expect(widths[0]).toBeCloseTo(originalWidth,1);expect(widths[1]).toBeCloseTo(doubledWidth,1);
  await dialog.getByRole('button',{name:'Remove saved shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await workshop(page);await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);await dialog.locator('.library-grid button').first().click();
  await expect.poll(async()=>Number(await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue())).toBeCloseTo(remainingWidth,1);
  await expect.poll(async()=>Number(await dialog.getByRole('spinbutton',{name:'Height, mm',exact:true}).inputValue())).toBeCloseTo(remainingWidth*originalHeight/originalWidth,1);
});

test('invalid stored geometry is reported without overwriting saved records',async({page})=>{
  await page.goto('/');await workshop(page);await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Source files'}).getByRole('button',{name:/^albano albano\.json/})).toHaveAttribute('aria-current','true');
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open('sparrow-shapes',1);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('shapes','readwrite');tx.objectStore('shapes').put({id:'broken',name:'Broken'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    request.onerror=()=>reject(request.error);
  }));
  await page.reload();await workshop(page);await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Invalid part identity');
  expect(await page.evaluate(()=>new Promise<number>((resolve,reject)=>{
    const request=indexedDB.open('sparrow-shapes',1);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('shapes'),count=tx.objectStore('shapes').count();tx.oncomplete=()=>{db.close();resolve(count.result);};tx.onerror=()=>reject(tx.error);};
    request.onerror=()=>reject(request.error);
  }))).toBe(1);
});

test('original benchmarks are opened through project examples',async({page})=>{
  await page.goto('/');await openExamples(page);await page.getByRole('combobox',{name:'Dataset',exact:true}).selectOption('swim');
  await page.getByRole('button',{name:'Open example',exact:true}).click();await finishSwitch(page);
  const source=importSparrow(await readFile('public/examples/swim.json','utf8'),'swim.json',1).document,expected=normalizeSampleDocument(source);
  await expect.poll(async()=>Number(await page.getByRole('spinbutton',{name:/Material width/}).inputValue())).toBeCloseTo(expected.settings.materialWidthMm,1);
});

test('library keeps source categories left of the selector and supports range selection',async({page})=>{
  await page.goto('/');await workshop(page);await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Shape library',exact:true}),layout=dialog.locator('.library-layout'),sourcePane=layout.locator('.library-sidebar'),selectorPane=layout.locator('.library-selector'),nav=dialog.getByRole('navigation',{name:'Source files'});
  const [sourceBox,selectorBox]=await Promise.all([sourcePane.boundingBox(),selectorPane.boundingBox()]);
  expect(sourceBox!.x).toBeLessThan(selectorBox!.x);
  await expect(nav.getByRole('button',{name:/^albano albano\.json/})).toHaveAttribute('aria-current','true');
  const navBox=await nav.boundingBox(),headingBox=await dialog.getByRole('heading',{name:'Source files',exact:true}).boundingBox();expect(navBox!.x).toBeCloseTo(headingBox!.x,0);
  const cards=dialog.locator('.library-grid button');await expect(cards).toHaveCount(8);
  await cards.nth(1).click();await cards.nth(3).click({modifiers:['Shift']});
  await expect(dialog.getByRole('button',{name:'Add 3 selected shapes to project',exact:true})).toBeEnabled();
});
