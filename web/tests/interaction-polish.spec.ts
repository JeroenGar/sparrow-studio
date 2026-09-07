import {test,expect} from '@playwright/test';
import {workshop,newProject} from './project-helpers';

test('menus dismiss without clearing selection, and dimensions replace defaults on typing',async({page})=>{
  await page.goto('/');await workshop(page);
  await page.locator('.part-select').first().click();
  for(const selector of ['.project-menu','.cad-snapping']){
    const menu=page.locator(selector),trigger=menu.locator('summary');
    await trigger.click();await expect(menu).toHaveAttribute('open','');
    await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open','');
    await expect(trigger).toBeFocused();await expect(page.locator('.part-select[aria-pressed=true]')).toHaveCount(1);
    await trigger.click();await page.getByRole('heading',{name:'Material & run'}).click();
    await expect(menu).not.toHaveAttribute('open','');
  }
  await page.getByRole('button',{name:'Draw shape',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add shape',exact:true}),width=dialog.getByLabel('Width, mm',{exact:true});
  await width.click();await width.press('5');await expect(width).toHaveValue('5');await width.click();await width.press('6');await expect(width).toHaveValue('56');await width.press('Enter');
  await expect(dialog).toHaveCount(0);await expect(page.locator('.part-row')).toHaveCount(5);
  await expect(page.getByLabel('Width, mm',{exact:true})).toHaveValue('56');
});

test('sidebar ranges and toggles include unused parts and preserve their properties',async({page})=>{
  await page.goto('/');await workshop(page);
  const parts=page.locator('.part-select'),selected=page.locator('.part-select[aria-pressed=true]');
  await parts.nth(0).click();await parts.nth(2).click({modifiers:['Shift']});await expect(selected).toHaveCount(3);
  await parts.nth(1).click({modifiers:['ControlOrMeta']});await expect(selected).toHaveCount(2);
  await page.getByLabel('Quantity for Bracket',{exact:true}).fill('0');
  await parts.nth(0).click();
  await expect(page.getByRole('complementary',{name:'Part properties'})).toBeVisible();
  await expect(page.getByLabel('X, mm',{exact:true})).toHaveCount(0);
  await page.getByLabel('Name',{exact:true}).fill('Spare bracket');
  await page.getByRole('button',{name:'Shape library',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Save selected shape',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.library-grid')).toContainText('Spare bracket');
  await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
  await parts.nth(0).click();await page.keyboard.press('+');
  await expect(page.getByLabel('Quantity for Spare bracket',{exact:true})).toHaveValue('1');
  await expect(page.getByLabel('X, mm',{exact:true})).toBeVisible();
});

test('custom rotation validation stays inline and changed import settings require a refresh',async({page})=>{
  await page.goto('/');await newProject(page);
  await page.locator('input[type=file]').first().setInputFiles({name:'unitless.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('Imported shapes')).toBeVisible();
  await dialog.getByLabel('One drawing unit').selectOption('25.4');
  await expect(dialog).toContainText('Preview outdated');
  await expect(dialog.getByLabel('Imported shapes')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Add 1 shape to project'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Update preview'}).click();
  await expect(dialog).not.toContainText('Preview outdated');
  await dialog.getByRole('button',{name:'Add 1 shape to project'}).click();
  const previous=await page.getByLabel('Permitted rotations').inputValue();
  await page.getByLabel('Permitted rotations').selectOption('custom');
  const degrees=page.getByLabel('Allowed degrees');
  await degrees.fill('0, nope');await degrees.press('Enter');
  await expect(page.getByText('Enter finite degrees separated by commas, such as 0, 180.')).toBeVisible();
  await degrees.fill('15, 195');await degrees.press('Enter');
  await expect(degrees).toHaveValue('15, 195');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByLabel('Permitted rotations')).toHaveValue(previous);
});
