import {openExamples,workshop} from './project-helpers';
import {test,expect,type Locator,type Page} from '@playwright/test';

const drawing=(page:Page)=>page.locator('.workspace-svg');
const copies=(page:Page)=>drawing(page).locator('g[data-part][data-copy-index]');
type CopyState={id:string;index:number;d:string;transform:string;position:[number,number];box:[number,number,number,number]};
async function state(page:Page):Promise<CopyState[]> {
  return copies(page).evaluateAll(nodes=>nodes.map(node=>{
    const path=node.querySelector('path')!,b=path.getBBox(),match=node.getAttribute('transform')!.match(/translate\(([^)]+)\)/)!,[x,negativeY]=match[1].split(' ').map(Number);
    return {id:node.getAttribute('data-part')!,index:Number(node.getAttribute('data-copy-index')),d:path.getAttribute('d')!,transform:node.getAttribute('transform')!,position:[x,-negativeY] as [number,number],box:[b.x+x,b.y-negativeY,b.x+x+b.width,b.y-negativeY+b.height] as [number,number,number,number]};
  }));
}
async function center(locator:Locator) {
  return locator.evaluate(element=>{const path=element.querySelector('path') as SVGGraphicsElement,b=path.getBBox(),p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(path.getScreenCTM()!);return {x:p.x,y:p.y};});
}
function copyLocator(page:Page,copy:Pick<CopyState,'id'|'index'>) {
  return page.locator(`g[data-part="${copy.id}"][data-copy-index="${copy.index}"]`);
}
async function clickCopy(page:Page,locator:Locator) {
  const point=await center(locator);await page.mouse.click(point.x,point.y);
}

test('the unified preparation canvas renders every demanded copy without labels',async({page},testInfo)=>{
  await page.goto('/');await workshop(page);
  await expect.poll(async()=>copies(page).count()).toBe(12);
  expect(await copies(page).evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute('data-part')))].map(id=>nodes.filter(node=>node.getAttribute('data-part')===id).length))).toEqual([3,3,3,3]);
  await expect(page.locator('text[data-copy-count]')).toHaveCount(0);await expect(page.getByRole('tab')).toHaveCount(0);
  await page.locator('input[type=file]').first().setInputFiles({name:'parts.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><path fill-rule="evenodd" d="M0 0H40V40H0Z M8 8H32V32H8Z"/><path d="M50 0H90V8H58V40H50Z"/></svg>')});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('button',{name:/^Add \d+ shapes? to project$/}).click();
  await expect.poll(async()=>copies(page).count()).toBe(14);await expect(page.locator('text[data-copy-count]')).toHaveCount(0);
  const quantity=page.locator('.parts-list input[type=number]').first();await quantity.fill('0');
  await expect(quantity).toHaveAttribute('aria-invalid','false');await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeEnabled();await expect.poll(async()=>copies(page).count()).toBe(11);
  await quantity.fill('500');await expect(page.getByRole('alert')).toContainText('500-copy limit');
  await quantity.fill('7');await expect.poll(async()=>copies(page).count()).toBe(18);await expect(page.locator('text[data-copy-count]')).toHaveCount(0);
  await page.getByRole('button',{name:'👻 mode',exact:true}).click();await expect(page.locator('text[data-copy-count]')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('preparation-ghost-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Fit',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:testInfo.outputPath('preparation-ghost-mobile.png'),fullPage:true});
});

test('new, duplicated, and library parts add independent copies to the canvas',async({page})=>{
  await page.goto('/');await workshop(page);await expect.poll(async()=>copies(page).count()).toBe(12);
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Add shape',exact:true}).click();
  await expect.poll(async()=>copies(page).count()).toBe(13);await page.keyboard.press('Control+d');await expect.poll(async()=>copies(page).count()).toBe(14);await expect(page.locator('.part-row')).toHaveCount(5);
  await page.getByRole('button',{name:'Shape library',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Shape library',exact:true});
  await dialog.getByRole('navigation',{name:'Source files'}).getByRole('button',{name:/^albano albano\.json/}).click();await dialog.locator('.library-grid button').first().click();
  await dialog.getByRole('button',{name:'Add shape to project',exact:true}).click();await expect(dialog.getByText('Shape added to your project.',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(async()=>copies(page).count()).toBe(15);await expect(page.locator('text[data-copy-count]')).toHaveCount(0);
});

test('preparation shortcuts rotate and change copies, skip editable fields, and preserve history',async({page})=>{
  await page.goto('/');await workshop(page);await expect(page.locator('.canvas-hint')).toContainText('R next rotation');await page.locator('.part-select').first().click();
  const quantity=page.locator('.parts-list input[type=number]').first(),before=await state(page);await expect(quantity).toHaveValue('3');
  await page.keyboard.press('r');await expect.poll(async()=>state(page)).not.toEqual(before);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>state(page)).toEqual(before);
  await page.keyboard.press('+');await expect(quantity).toHaveValue('4');await expect.poll(async()=>copies(page).count()).toBe(13);await page.keyboard.press('-');await expect(quantity).toHaveValue('3');await expect.poll(async()=>copies(page).count()).toBe(12);
  await page.keyboard.press('+');await expect(quantity).toHaveValue('4');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(quantity).toHaveValue('3');
  const width=page.getByRole('spinbutton',{name:'Width, mm',exact:true}),editableBefore=await state(page);await width.focus();await page.keyboard.press('r');await page.keyboard.press('+');await page.keyboard.press('-');
  expect(await state(page)).toEqual(editableBefore);await expect(quantity).toHaveValue('3');
});

test('deleting the last copy keeps a zero-quantity type, undo restores it, and shortcuts reuse that type',async({page})=>{
  await page.goto('/');await workshop(page);

  // Keep a zero-demand type in the middle of a real solver request so the
  // dense-copy WASM input and its result mapping are exercised as well.
  const middleQuantity=page.locator('.parts-list input[type=number]').nth(1);
  await middleQuantity.fill('0');await expect.poll(async()=>copies(page).count()).toBe(9);
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await expect(page.getByText('✓ Geometry checked',{exact:true})).toBeVisible({timeout:30_000});await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(middleQuantity).toBeEnabled();await expect(middleQuantity).toHaveValue('0');await expect.poll(async()=>copies(page).count()).toBe(9);
  await middleQuantity.fill('3');await expect.poll(async()=>copies(page).count()).toBe(12);

  const existingIds=new Set((await state(page)).map(copy=>copy.id));
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Add shape',exact:true}).click();
  await expect.poll(async()=>copies(page).count()).toBe(13);const row=page.locator('.part-row').last(),quantity=row.locator('input[type=number]');
  const addedCopy=(await state(page)).find(copy=>!existingIds.has(copy.id))!;await clickCopy(page,copyLocator(page,addedCopy));
  await page.keyboard.press('Backspace');await expect.poll(async()=>copies(page).count()).toBe(12);await expect(quantity).toHaveValue('0');await expect(page.locator('.part-row')).toHaveCount(5);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>copies(page).count()).toBe(13);await expect(quantity).toHaveValue('1');

  const restoredCopy=(await state(page)).find(copy=>!existingIds.has(copy.id))!;await clickCopy(page,copyLocator(page,restoredCopy));
  const name=page.getByRole('textbox',{name:'Name',exact:true});await name.focus();await page.keyboard.press('Control+d');await page.keyboard.press('Delete');
  await expect.poll(async()=>copies(page).count()).toBe(13);await expect(quantity).toHaveValue('1');

  await clickCopy(page,copyLocator(page,restoredCopy));await page.keyboard.press('Control+d');
  await expect.poll(async()=>copies(page).count()).toBe(14);await expect(page.locator('.part-row')).toHaveCount(5);await expect(quantity).toHaveValue('2');
  const duplicated=(await state(page)).find(copy=>copy.id===restoredCopy.id&&copy.index===1)!;await page.keyboard.press('r');
  await expect.poll(async()=>state(page).then(items=>items.find(copy=>copy.id===duplicated.id&&copy.index===duplicated.index)?.transform)).not.toBe(duplicated.transform);
  const halfTurn=(await state(page)).find(copy=>copy.id===duplicated.id&&copy.index===duplicated.index)!;expect(halfTurn.transform).toMatch(/rotate\(-?180(?:[ )]|$)/);
});

test('dragging one stacked copy permits overlap and undoes the edit',async({page})=>{
  await page.goto('/');await workshop(page);await page.locator('.cad-snapping summary').click();await page.getByLabel('Enable snapping',{exact:true}).uncheck();await page.locator('.cad-snapping summary').click();
  const before=await state(page),targetCopy=before.find(copy=>copy.index===0)!,siblingCopy=before.find(copy=>copy.id===targetCopy.id&&copy.index===1)!;
  const target=copyLocator(page,targetCopy),sibling=copyLocator(page,siblingCopy),start=await center(target),siblingBefore=before.find(copy=>copy.id===siblingCopy.id&&copy.index===1)!;
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+20,start.y+15,{steps:8});await page.mouse.up();
  await expect.poll(async()=>state(page)).not.toEqual(before);const after=await state(page),moved=after.find(copy=>copy.id===targetCopy.id&&copy.index===0)!;
  expect(moved.position).not.toEqual(targetCopy.position);expect(after.find(copy=>copy.id===siblingCopy.id&&copy.index===1)!.position).toEqual(siblingBefore.position);
  const targetBox=await target.boundingBox(),siblingBox=await sibling.boundingBox();expect(targetBox&&siblingBox).toBeTruthy();expect(targetBox!.x).toBeLessThan(siblingBox!.x+siblingBox!.width);expect(siblingBox!.x).toBeLessThan(targetBox!.x+targetBox!.width);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>state(page)).toEqual(before);
  await page.locator('.part-select').first().click();await page.locator('.part-select').nth(1).click({modifiers:['Shift']});
  const width=Number(await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue());await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill(String(width*1.2));await page.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');await expect(page.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue(String(width*1.2));
  await page.getByRole('button',{name:'Rotate',exact:true}).click();await expect(page.locator('text[data-copy-count]')).toHaveCount(0);await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();
});
