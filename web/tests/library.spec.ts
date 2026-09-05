import {test,expect} from '@playwright/test';

test('personal shapes persist and dataset shapes resize independently',async({page},testInfo)=>{
  await page.goto('/');await page.locator('.part-select').first().click();
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Shape library',exact:true});
  await dialog.getByRole('button',{name:'Save selected shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.locator('.library-grid button').first().click();
  await expect(dialog.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue('36');
  await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).fill('72');
  await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).press('Enter');
  await expect(dialog.getByRole('spinbutton',{name:'Height, mm',exact:true})).toHaveValue('76');
  await dialog.getByRole('button',{name:'Save as new personal shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(2);
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('albano');
  await expect(dialog.locator('.library-grid button')).toHaveCount(8);
  expect(await dialog.getByRole('combobox',{name:'Collection'}).locator('option').count()).toBe(35);
  await dialog.locator('.library-grid button').first().click();
  await expect(dialog.getByRole('button',{name:'Add to drawing'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Add to drawing',exact:true}).click();
  await expect(dialog.getByText('Shape added to your drawing.',{exact:true})).toBeVisible();
  await expect(page.locator('.part-select')).toHaveCount(5);
  await page.screenshot({path:testInfo.outputPath('library-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('library-mobile.png'),fullPage:true});
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('gardeyn0_c');
  await expect(dialog.locator('.library-grid button')).toHaveCount(5);
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('mine');
  const widths=[];
  for(let i=0;i<2;i++){
    await dialog.locator('.library-grid button').nth(i).click();
    widths.push(await dialog.getByRole('spinbutton',{name:'Width, mm',exact:true}).inputValue());
  }
  expect(widths.sort()).toEqual(['36','72']);
  await dialog.getByRole('button',{name:'Remove saved shape',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(dialog.locator('.library-grid button')).toHaveCount(1);
});

test('invalid stored geometry is reported without overwriting saved records',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(page.getByText('Select shapes in your drawing and save them here, or choose a dataset.')).toBeVisible();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open('sparrow-shapes',1);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('shapes','readwrite');tx.objectStore('shapes').put({id:'broken',name:'Broken'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    request.onerror=()=>reject(request.error);
  }));
  await page.reload();await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Invalid part identity');
  expect(await page.evaluate(()=>new Promise<number>((resolve,reject)=>{
    const request=indexedDB.open('sparrow-shapes',1);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('shapes'),count=tx.objectStore('shapes').count();tx.oncomplete=()=>{db.close();resolve(count.result);};tx.onerror=()=>reject(tx.error);};
    request.onerror=()=>reject(request.error);
  }))).toBe(1);
});

test('library opens the original benchmark without normalized sizes',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Shape library',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Shape library',exact:true});
  await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('albano');
  await dialog.getByRole('button',{name:'Open original benchmark',exact:true}).click();
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.getByText('8 part types · 24 copies · 0 holes',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Import parts',exact:true}).click();
  await expect(page.locator('.part-select')).toHaveCount(8);
  await expect(page.getByRole('spinbutton',{name:/Material width/})).toHaveValue('4900');
});
