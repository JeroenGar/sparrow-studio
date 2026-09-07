import {test,expect} from '@playwright/test';
import {workshop} from './project-helpers';

for(const first of ['svg','dxf','zip','project','reduced-motion'] as const) {
  test(`the hand waves once after a checked download: ${first}`,async({page})=>{
    await page.emulateMedia({reducedMotion:first==='reduced-motion'?'reduce':'no-preference'});
    await page.addInitScript(()=>{
      document.addEventListener('animationstart',event=>{
        if(event.animationName==='hello-wave')document.documentElement.dataset.helloWaves=String(Number(document.documentElement.dataset.helloWaves??0)+1);
      });
    });
    await page.goto('/');
    const hello=page.getByRole('button',{name:'Say hello 👋',exact:true}),hand=hello.locator('span');
    await expect(hello).toBeVisible();
    await workshop(page);
    await page.locator('.project-menu>summary').click();
    await page.getByRole('button',{name:'Rename project',exact:true}).click();
    await page.getByLabel('Project name',{exact:true}).fill('My cutting / job: sample');
    await page.getByRole('button',{name:'Rename',exact:true}).click();
    let pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Save project',exact:true}).click();await pending;
    await expect(hand).not.toHaveClass('hello-wave');
    await page.getByRole('button',{name:'Nest parts',exact:true}).click();
    await page.getByRole('button',{name:'Best valid solution',exact:true}).click({timeout:20_000});
    const stop=page.getByRole('button',{name:'Stop',exact:true});if(await stop.isVisible())await stop.click();
    const format=first==='reduced-motion'?'svg':first;
    if(format!=='project')await page.getByLabel('Export format').selectOption(format);
    pending=page.waitForEvent('download');
    await page.getByRole('button',{name:format==='project'?'Save project':`Download ${format.toUpperCase()}`,exact:true}).click();
    expect((await pending).suggestedFilename()).toBe(`My cutting - job- sample.${format==='project'?'sparrow-project.json':format}`);
    await expect(hand).toHaveClass('hello-wave');
    if(first==='reduced-motion') {
      await expect(hand).toHaveCSS('animation-name','none');
      await expect(hand).toHaveCSS('transform','none');
    } else {
      await expect(page.locator('html')).toHaveAttribute('data-hello-waves','1');
      await expect.poll(()=>hand.evaluate(element=>getComputedStyle(element).transform)).not.toBe('none');
      await expect.poll(()=>hand.evaluate(element=>element.getAnimations().length)).toBe(0);
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Save project',exact:true}).click();await pending;
    expect(await hand.evaluate(element=>element.getAnimations().length)).toBe(0);
    expect(await page.locator('html').getAttribute('data-hello-waves')).toBe(first==='reduced-motion'?null:'1');
    await hello.click();
    await expect(page.getByRole('dialog',{name:'Say hello',exact:true})).toContainText('I’d like to hear how you’re using sparrow and what you’d like to do with it next.');
  });
}
