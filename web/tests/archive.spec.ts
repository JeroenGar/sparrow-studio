import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {workshop} from './project-helpers';

function entries(data:Buffer) {
  const files=new Map<string,string>();let offset=0;
  while(data.readUInt32LE(offset)===0x04034b50){
    const size=data.readUInt32LE(offset+18),length=data.readUInt16LE(offset+26),extra=data.readUInt16LE(offset+28),start=offset+30+length+extra;
    files.set(data.subarray(offset+30,offset+30+length).toString(),data.subarray(start,start+size).toString());offset=start+size;
  }
  return files;
}
test('project and checked result ZIP downloads include runnable CLI input',async({page},info)=>{
  await page.goto('/');await workshop(page);
  await page.getByLabel('Quantity for Shield').fill('0');
  await page.locator('.project-menu summary').click();let pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download project ZIP',exact:true}).click();let download=await pending;
  const path=info.outputPath('project.zip');await download.saveAs(path);let files=entries(await readFile(path));
  const project=JSON.parse(files.get('project.sparrow-project.json')!),instance=JSON.parse(files.get('sparrow-instance.json')!);
  expect(project.parts).toHaveLength(4);expect(instance.items).toHaveLength(3);expect(instance.items.map((item:{id:number})=>item.id)).toEqual([0,1,2]);expect(files.has('layout.svg')).toBe(false);
  await page.getByRole('button',{name:'Nest parts',exact:true}).click();await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20000});await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByLabel('Export format').selectOption('zip');pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP',exact:true}).click();download=await pending;
  await download.saveAs(path);files=entries(await readFile(path));expect(files.get('layout.svg')).toContain('viewBox=');expect(files.get('layout.dxf')).toContain('ENTITIES');expect(files.get('README.txt')).toContain('hole');
});
