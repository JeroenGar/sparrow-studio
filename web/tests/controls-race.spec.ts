import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';

test('an external coordinate update preserves another field being edited',async({page})=>{
  const bundle=buildSync({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import SelectionControls from './src/components/SelectionControls';import SizeControls from './src/components/SizeControls';
    import {newPart} from './src/model';
    function Fixture(){const[box,setBox]=useState([0,0,36,38]),[part,setPart]=useState(()=>({...newPart([[0,0],[36,0],[36,38],[0,38]]),id:'part'})),[unit,setUnit]=useState('mm'),[applied,setApplied]=useState('');
      return <><section aria-label="Selection"><SelectionControls box={box} unit={unit} disabled={false} onPosition={(axis,value)=>setApplied(axis+':'+value)} onSize={()=>{}} onRotate={()=>{}} onValidity={()=>{}}/>
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>setBox([25,0,61,38])}>External X update</button></section>
      <section aria-label="Library"><SizeControls part={part} unit={unit} disabled={false} onApply={(axis,value)=>setApplied(axis+':'+value)} onValidity={()=>{}}/>
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>setPart({...part,outer:[[0,0],[40,0],[40,38],[0,38]]})}>External width update</button></section>
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>setUnit('in')}>Switch units</button><output>{applied}</output></>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}}).outputFiles[0].text;
  await page.route('**/controls-fixture.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  await page.route('**/controls-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/controls-fixture.js"></script>'}));
  await page.goto('/controls-fixture');
  const selection=page.getByRole('region',{name:'Selection'}),library=page.getByRole('region',{name:'Library'});
  await selection.getByRole('spinbutton',{name:'Y, mm',exact:true}).fill('-10');
  await selection.getByRole('button',{name:'External X update'}).click();
  await expect(selection.getByRole('spinbutton',{name:'X, mm',exact:true})).toHaveValue('25');
  await expect(selection.getByRole('spinbutton',{name:'Y, mm',exact:true})).toHaveValue('-10');
  await selection.getByRole('spinbutton',{name:'Y, mm',exact:true}).press('Enter');await expect(page.locator('output')).toHaveText('1:-10');
  await library.getByRole('spinbutton',{name:'Height, mm',exact:true}).fill('76');
  await library.getByRole('button',{name:'External width update'}).click();
  await expect(library.getByRole('spinbutton',{name:'Width, mm',exact:true})).toHaveValue('40');
  await expect(library.getByRole('spinbutton',{name:'Height, mm',exact:true})).toHaveValue('76');
  await library.getByRole('spinbutton',{name:'Height, mm',exact:true}).press('Enter');await expect(page.locator('output')).toHaveText('1:76');
  await page.getByRole('button',{name:'Switch units'}).click();
  await expect(selection.getByRole('spinbutton',{name:'Y, in',exact:true})).toHaveValue('0');
  await expect(library.getByRole('spinbutton',{name:'Height, in',exact:true})).toHaveValue('1.49606299');
});
