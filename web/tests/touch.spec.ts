import {openExamples,workshop,finishSwitch} from './project-helpers';
import {test,expect} from '@playwright/test';

test.use({viewport:{width:390,height:844},hasTouch:true});
test('vertical touch dragging moves a part without scrolling the page',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Uses Chromium touch input to exercise browser gesture arbitration.');
  await page.goto('/');await workshop(page);
  const part=page.locator('.workspace-svg g[data-part][data-copy-index="0"]').first();
  await expect(part).toHaveAttribute('data-copy-index');
  const before=await part.getAttribute('transform');
  const center=await part.evaluate(element=>{
    const path=element.querySelector('path')!,box=path.getBBox();
    // Keep the synthetic touch below the floating canvas toolbar on a 390 px viewport.
    const point=new DOMPoint(box.x+box.width/2,box.y+box.height*.25).matrixTransform(path.getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
  const scroll=await page.evaluate(()=>scrollY),session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1}]});
  await page.waitForTimeout(50);
  for(let y=8;y<=40;y+=8)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:center.x,y:center.y+y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>part.getAttribute('transform')).not.toBe(before);
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(part).toHaveAttribute('transform',before!);
  await session.detach();
});

test('two-finger pinch zooms without moving parts and permits another gesture',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Uses real multi-touch input through CDP.');
  await page.goto('/');await workshop(page);
  const canvas=page.locator('.workspace-svg');
  await expect(page.locator('.workspace-svg g[data-part][data-copy-index]').first()).toBeVisible();
  const box=(await canvas.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  const width=async()=>Number((await canvas.getAttribute('viewBox'))!.split(' ')[2]);
  const before=await width(),parts=await page.locator('[data-part]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));
  const session=await page.context().newCDPSession(page);
  const points=(distance:number)=>[{id:1,x:x-distance,y},{id:2,x:x+distance,y}];
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(30)});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(60)});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(width).toBeCloseTo(before/2);
  expect(await page.locator('[data-part]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).toEqual(parts);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(60)});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(30)});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(width).toBeCloseTo(before);
  await session.detach();
});
