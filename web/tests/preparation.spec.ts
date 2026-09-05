import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect,type Page} from '@playwright/test';

const drawing=(page:Page)=>page.getByRole('img',{name:'Preparation drawing'});
async function state(page:Page) {
  return drawing(page).locator('g[data-part]').evaluateAll(nodes=>nodes.map(node=>{
    const path=node.querySelector('path')!,b=path.getBBox(),[x,negativeY]=node.getAttribute('transform')!.match(/translate\(([^)]+)\)/)![1].split(' ').map(Number);
    return {id:node.getAttribute('data-part'),d:path.getAttribute('d'),position:[x,-negativeY],box:[b.x+x,b.y-negativeY,b.x+x+b.width,b.y-negativeY+b.height]};
  }));
}
async function separated(page:Page) {
  const items=await state(page);
  for(let i=0;i<items.length;i++)for(let j=0;j<i;j++) {
    const a=items[i].box,b=items[j].box;expect(a[0]>=b[2]-1e-8||b[0]>=a[2]-1e-8||a[1]>=b[3]-1e-8||b[1]>=a[3]-1e-8).toBe(true);
  }
}
async function labelsInside(page:Page,count:number) {
  await expect(drawing(page).locator('text[data-copy-count]')).toHaveCount(count);
  const labels=await drawing(page).locator('g[data-part]').evaluateAll(nodes=>nodes.map(node=>{
    const path=node.querySelector('path')!,label=node.querySelector('text[data-copy-count]')!;
    return path.isPointInFill(new DOMPoint(Number(label.getAttribute('x')),-Number(label.getAttribute('y'))));
  }));
  expect(labels.every(Boolean)).toBe(true);
}

test('preparation labels stay inside holes and concavities, update counts, and remain visible in ghost mode',async({page},testInfo)=>{
  await page.addInitScript(`window.labelRequests=0;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(message?.type==='label-points')window.labelRequests++;return send.call(this,message,...args);};`);
  await page.goto('/');await workshop(page);await labelsInside(page,4);await separated(page);
  await page.locator('input[type=file]').first().setInputFiles({name:'label-parts.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><path fill-rule="evenodd" d="M0 0H40V40H0Z M8 8H32V32H8Z"/><path d="M50 0H90V8H58V40H50Z"/></svg>')});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await labelsInside(page,6);await separated(page);
  const requests=await page.evaluate(()=>Reflect.get(window,'labelRequests'));
  await page.locator('.parts-list input[type=number]').first().fill('0');
  await expect(page.getByRole('alert')).toContainText('Enter a whole number from 1 to 500.');
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeDisabled();
  await page.locator('.parts-list input[type=number]').first().fill('500');
  await expect(page.getByRole('alert')).toContainText('500-copy limit');
  await page.locator('.parts-list input[type=number]').first().fill('7');
  await expect(drawing(page).locator('text[data-copy-count]').first()).toHaveText('×7');
  expect(await page.evaluate(()=>Reflect.get(window,'labelRequests'))).toBe(requests);
  await page.getByRole('button',{name:'👻 mode',exact:true}).click();
  const rendered=await drawing(page).locator('text[data-copy-count]').evaluateAll(nodes=>nodes.map(n=>({color:getComputedStyle(n).fill,size:Number.parseFloat(getComputedStyle(n).fontSize),rect:n.getBoundingClientRect().toJSON()})));
  expect(rendered.every(n=>n.size>0&&n.rect.width>0&&n.rect.height>0)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('preparation-ghost-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Fit',exact:true}).click();await labelsInside(page,6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath('preparation-ghost-mobile.png'),fullPage:true});
});

test('new, duplicated, and library parts are separated from the existing drawing',async({page})=>{
  await page.goto('/');await workshop(page);await labelsInside(page,4);
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Add shape',exact:true}).click();
  await labelsInside(page,5);await separated(page);
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();
  await labelsInside(page,6);await separated(page);
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Shape library',exact:true});
  await dialog.getByRole('navigation',{name:'Source files'}).getByRole('button',{name:/^albano albano\.json/}).click();
  await dialog.locator('.library-grid button').first().click();
  await dialog.getByRole('button',{name:'Add shape to project',exact:true}).click();
  await expect(dialog.getByText('Shape added to your project.',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await labelsInside(page,7);await separated(page);
});

test('preparation shortcuts rotate and change copies, skip editable fields, and preserve overlap drags',async({page})=>{
  await page.goto('/');await workshop(page);
  await expect(page.locator('.canvas-hint')).toContainText('R rotate 90°');
  await page.locator('.part-select').first().click();
  const quantity=page.locator('.parts-list input[type=number]').first(),before=await state(page);
  await expect(quantity).toHaveValue('3');
  await page.keyboard.press('r');
  await expect.poll(async()=>(await state(page))[0].d).not.toBe(before[0].d);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await state(page))[0].d).toBe(before[0].d);
  await page.keyboard.press('+');await expect(quantity).toHaveValue('4');
  await page.keyboard.press('-');await expect(quantity).toHaveValue('3');
  await page.keyboard.press('+');await expect(quantity).toHaveValue('4');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(quantity).toHaveValue('3');
  const width=page.getByRole('spinbutton',{name:'Width, mm',exact:true}),editableBefore=await state(page);
  await width.focus();await page.keyboard.press('r');await page.keyboard.press('+');await page.keyboard.press('-');
  expect(await state(page)).toEqual(editableBefore);await expect(quantity).toHaveValue('3');
});

test('dragging onto a part preserves the dragged position, allows overlap, and undoes the edit',async({page})=>{
  await page.goto('/');await workshop(page);await labelsInside(page,4);
  await page.locator('.cad-snapping summary').click();await page.getByLabel('Enable snapping',{exact:true}).uncheck();await page.locator('.cad-snapping summary').click();
  const before=await state(page),points=await drawing(page).locator('g[data-part]').evaluateAll(nodes=>nodes.slice(0,2).map(node=>{
    const label=node.querySelector('text[data-copy-count]')!,p=new DOMPoint(Number(label.getAttribute('x')),Number(label.getAttribute('y'))).matrixTransform((label as SVGGraphicsElement).getScreenCTM()!);
    const local=[Number(label.getAttribute('x')),-Number(label.getAttribute('y'))];return {screen:[p.x,p.y],local};
  }));
  // Browser engines quantize synthetic pointer positions differently. Compare
  // against the actual delivered events, rather than requested screen fractions.
  await drawing(page).evaluate(svg=>{
    const sample=(e:PointerEvent)=>{const p=new DOMPoint(e.clientX,e.clientY).matrixTransform((svg as SVGSVGElement).getScreenCTM()!.inverse());return [p.x,-p.y];};
    svg.addEventListener('pointerdown',e=>Reflect.set(window,'dragStart',sample(e as PointerEvent)));
    svg.addEventListener('pointermove',e=>{if((e as PointerEvent).buttons)Reflect.set(window,'dragEnd',sample(e as PointerEvent));});
  });
  await page.mouse.move(...points[0].screen as [number,number]);await page.mouse.down();await page.mouse.move(...points[1].screen as [number,number],{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await state(page))[0].position).not.toEqual(before[0].position);
  const delivered=await page.evaluate(()=>({start:Reflect.get(window,'dragStart') as number[],end:Reflect.get(window,'dragEnd') as number[]}));
  const after=await state(page);for(let i=0;i<2;i++)expect(after[0].position[i]).toBeCloseTo(before[0].position[i]+delivered.end[i]-delivered.start[i],9);
  expect(after[1].position).toEqual(before[1].position);
  expect(after[0].box[0]).toBeLessThan(after[1].box[2]);expect(after[1].box[0]).toBeLessThan(after[0].box[2]);
  expect(after[0].box[1]).toBeLessThan(after[1].box[3]);expect(after[1].box[1]).toBeLessThan(after[0].box[3]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await state(page)).toEqual(before);
  await page.locator('.part-select').first().click();await page.locator('.part-select').nth(1).click({modifiers:['Shift']});
  const width=Number(await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue());
  await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill(String(width*1.2));await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');
  await expect(page.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue(String(width*1.2));
  await page.getByRole('button',{name:'Rotate',exact:true}).click();await labelsInside(page,4);await separated(page);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await state(page)).toEqual(before);
});
