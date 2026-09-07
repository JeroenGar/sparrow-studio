import {test,expect} from '@playwright/test';
import {workshop} from './project-helpers';

test('long name edits use one Undo step and preserve earlier geometry edits',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.locator('.part-select').first().click();
  const width=page.getByLabel('Width, mm',{exact:true}),name=page.getByLabel('Name',{exact:true});
  const originalWidth=await width.inputValue();
  await width.fill('80');await width.press('Enter');await expect(width).toHaveValue('80');
  await name.click();await name.pressSequentially('A long replacement name that should never exhaust the fifty available undo entries');
  await name.press('Enter');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(name).toHaveValue('Bracket');await expect(width).toHaveValue('80');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(width).toHaveValue(originalWidth);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(width).toHaveValue('80');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(name).toHaveValue('A long replacement name that should never exhaust the fifty available undo entries');
});

test('quantity and material fields group typing until blur or Enter, with independent sessions',async({page})=>{
  await page.goto('/');await workshop(page);
  const quantity=page.getByLabel('Quantity for Bracket',{exact:true}),material=page.getByLabel('Material width',{exact:false}),clearance=page.getByLabel('Clearance',{exact:false});
  const initialWidth=await material.inputValue();
  await quantity.click();await quantity.pressSequentially('12');await expect(quantity).toHaveValue('12');
  // Clicking the next field finishes the quantity edit.
  await material.click();await material.pressSequentially('450');await material.press('Enter');
  await clearance.click();await clearance.pressSequentially('12');await clearance.press('Enter');
  const undo=page.getByRole('button',{name:'Undo',exact:true}),redo=page.getByRole('button',{name:'Redo',exact:true});
  await undo.click();await expect(clearance).toHaveValue('0');await expect(material).toHaveValue('450');
  await undo.click();await expect(material).toHaveValue(initialWidth);await expect(quantity).toHaveValue('12');
  await undo.click();await expect(quantity).toHaveValue('3');
  await redo.click();await expect(quantity).toHaveValue('12');
  await quantity.click();await quantity.pressSequentially('23');await quantity.press('Enter');
  await undo.click();await expect(quantity).toHaveValue('12');
  await undo.click();await expect(quantity).toHaveValue('3');
});
