import {test,expect,type Page} from '@playwright/test';
import {newProject,workshop} from './project-helpers';

async function snapshot(page:Page) {
  return page.evaluate(()=>new Promise<any>((resolve,reject)=>{
    const open=indexedDB.open('sparrow-project',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,request=db.transaction('recovery').objectStore('recovery').get('latest');
      request.onsuccess=()=>{db.close();resolve(request.result);};
      request.onerror=()=>{db.close();reject(request.error);};
    };
  }));
}

test('recovers edits and intentionally empty projects after reload',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await page.getByLabel('Quantity for Part 0',{exact:true}).fill('2');
  await expect.poll(async()=> (await snapshot(page))?.parts[0].quantity).toBe(2);
  await page.reload();
  await expect(page.getByLabel('Quantity for Part 0',{exact:true})).toHaveValue('2');
  await newProject(page);
  await expect.poll(async()=> (await snapshot(page))?.parts.length).toBe(0);
  await page.reload();
  await expect(page.getByText('Your project is empty',{exact:true})).toBeVisible();
  await expect(page.locator('.project-menu>summary')).toContainText('Untitled project');
});

test('leaving only warns while a nesting job is active',async({page})=>{
  const warns=()=>page.evaluate(()=>{
    const event=new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(event);return event.defaultPrevented;
  });
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await page.getByLabel('Quantity for Part 0',{exact:true}).fill('2');
  expect(await warns()).toBe(false);
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await expect.poll(warns).toBe(true);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect.poll(warns).toBe(false);
});

test('recovers a checked layout without restarting the solver',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Best valid solution',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect.poll(async()=> (await snapshot(page))?.result?.validation.status).toBe('passed');
  const saved=await snapshot(page);
  await page.reload();
  await expect(page.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect.poll(async()=> (await snapshot(page))?.result?.placements).toEqual(saved.result.placements);
});

test('unavailable storage leaves the editor usable and reports failed recovery',async({page})=>{
  await page.addInitScript(()=>{
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(...args)=>{if(args[0]==='sparrow-project')throw new DOMException('Blocked','SecurityError');return open(...args);};
  });
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await expect(page.getByText('Browser saving is unavailable. Export the project to keep a copy.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Nest parts',exact:true})).toBeEnabled();
});

test('an unreadable recovery entry is preserved instead of overwritten by the demo',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await expect.poll(async()=> (await snapshot(page))?.name).toBe('gardeyn2');
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('sparrow-project',1);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('recovery','readwrite');
      tx.objectStore('recovery').put({schemaVersion:999,name:'Unrecognized project'},'latest');
      tx.oncomplete=()=>{db.close();resolve();};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }));
  await page.reload();
  await expect(page.locator('.project-menu>summary')).toContainText('gardeyn2');
  await expect(page.getByText('Browser saving is unavailable. Export the project to keep a copy.')).toBeVisible();
  await page.getByLabel('Quantity for Part 0',{exact:true}).fill('2');
  await page.waitForTimeout(700);
  expect((await snapshot(page)).schemaVersion).toBe(999);
});

test('browser-save indicator follows IndexedDB writes, including failures, independently of export',async({page})=>{
  await page.goto('/');
  const status=page.locator('.project-status');
  await expect(status).toHaveAttribute('data-save-state','saved');
  const quantity=page.getByLabel('Quantity for Part 0',{exact:true});
  await quantity.fill('2');
  await expect(status).toHaveAttribute('data-save-state','saving');
  await expect(status).toHaveAttribute('data-save-state','saved');
  expect((await snapshot(page)).parts[0].quantity).toBe(2);
  await quantity.fill('');
  await expect(status).toHaveAttribute('data-save-state','unsaved');
  await quantity.fill('3');await expect(status).toHaveAttribute('data-save-state','saved');
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='recovery')throw new DOMException('Full','QuotaExceededError');
      return put.apply(this,args);
    };
  });
  await quantity.fill('4');
  await expect(status).toHaveAttribute('data-save-state','error');
  await expect(status).toContainText('Not saved in browser');
  expect((await snapshot(page)).parts[0].quantity).toBe(3);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export project',exact:true}).click();await download;
  await expect(status).toHaveAttribute('data-save-state','error');
});
