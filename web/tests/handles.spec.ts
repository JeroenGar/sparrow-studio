import {test,expect,type Page} from '@playwright/test';

async function screen(page:Page,x:number,y:number) {
  return page.locator('.workspace-svg').evaluate((svg,p)=>{const point=new DOMPoint(p.x,-p.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);return {x:point.x,y:point.y};},{x,y});
}
test('corner and rotation gestures preview, commit once, and cancel without changing geometry',async({page},testInfo)=>{
  await page.goto('/');await page.locator('.part-select').first().click();
  const width=page.getByRole('spinbutton',{name:'Width, mm',exact:true}),height=page.getByRole('spinbutton',{name:'Height, mm',exact:true});
  const start=await screen(page,36,38),end=await screen(page,72,76);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});
  await expect(width).toHaveValue('36');
  await page.mouse.up();await expect(width).toHaveValue('72');await expect(height).toHaveValue('76');
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  const rotation=await page.locator('[data-handle="rotate"] circle').last().evaluate(node=>{
    const circle=node as SVGCircleElement,p=new DOMPoint(circle.cx.baseVal.value,circle.cy.baseVal.value).matrixTransform(circle.getScreenCTM()!);
    return {x:p.x,y:p.y};
  });
  const pivot=await screen(page,36,38);
  await page.mouse.move(rotation.x,rotation.y);await page.mouse.down();
  await page.mouse.move(pivot.x+(rotation.y-pivot.y),pivot.y-(rotation.x-pivot.x),{steps:8});await page.mouse.up();
  await expect(width).toHaveValue('76');await expect(height).toHaveValue('72');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(width).toHaveValue('72');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(width).toHaveValue('36');await expect(height).toHaveValue('38');
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  const cancelStart=await screen(page,36,38),cancelEnd=await screen(page,48,50);
  await page.mouse.move(cancelStart.x,cancelStart.y);await page.mouse.down();await page.mouse.move(cancelEnd.x,cancelEnd.y);await page.keyboard.press('Escape');await page.mouse.up();
  await page.locator('.part-select').first().click();await expect(width).toHaveValue('36');
  await page.screenshot({path:testInfo.outputPath('cad-handles.png'),fullPage:true});
});

test('grid snaps a selected group anchor and Alt bypasses it',async({page})=>{
  await page.goto('/');await page.locator('.part-select').first().click();await page.locator('.part-select').nth(1).click({modifiers:['Shift']});
  await page.locator('.cad-snapping summary').click();await page.getByRole('combobox',{name:'Grid, mm',exact:true}).selectOption('5');await page.locator('.cad-snapping summary').click();
  const start=await screen(page,6,20),end=await screen(page,9.2,24.1);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();
  await expect(page.getByRole('spinbutton',{name:'X, mm',exact:true})).toHaveValue('5');
  await expect(page.getByRole('spinbutton',{name:'Y, mm',exact:true})).toHaveValue('5');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.keyboard.down('Alt');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');
  await expect.poll(async()=>Number(await page.getByRole('spinbutton',{name:'X, mm',exact:true}).inputValue())).toBeCloseTo(3.2,0);
  await expect.poll(async()=>Number(await page.getByRole('spinbutton',{name:'Y, mm',exact:true}).inputValue())).toBeCloseTo(4.1,0);
});
