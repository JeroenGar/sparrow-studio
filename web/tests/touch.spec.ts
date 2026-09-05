import {test,expect} from '@playwright/test';

test.use({viewport:{width:390,height:844},hasTouch:true});
test('vertical touch dragging moves a part without scrolling the page',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Uses Chromium touch input to exercise browser gesture arbitration.');
  await page.goto('/');
  const part=page.locator('[data-part]').nth(3);
  await expect(part.locator('[data-copy-count]')).toBeVisible();
  const before=await part.getAttribute('transform');
  const center=await part.evaluate(element=>{
    const path=element.querySelector('path')!,box=path.getBBox();
    const point=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(path.getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
  const scroll=await page.evaluate(()=>scrollY),session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[center]});
  for(let y=8;y<=40;y+=8)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x,y:center.y+y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>part.getAttribute('transform')).not.toBe(before);
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(part).toHaveAttribute('transform',before!);
  await session.detach();
});
