// A phone's or a tablet's browser draws its scrollbar over the page, taking no width: the page in their frames keeps
// the breakpoint's whole width (the user's audit order of 2026-10-05: the phone breakpoint measured 375 px for its
// 390), while a desktop's keeps its scrollbar's width free (A3.22). Playwright's Chrome hides scrollbars by default
// (--hide-scrollbars), which hid this from every other test: this file shows them.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const OPEN = 'project.open#menu-file';
const TAB = (id: string) => `view.setBreakpoint#toolbar-breakpoint-tabs-${id}`;

test('the page keeps a phone’s and a tablet’s whole width, a desktop’s less its scrollbar', runs(OPEN, TAB('phone'), TAB('tablet'), TAB('desktop')), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="c-hero"]')).toHaveCount(1);
  const body = () => page.evaluate(() => Math.round(document.querySelector<HTMLIFrameElement>('.frame__page')?.contentDocument?.body.getBoundingClientRect().width ?? 0));
  const scrollbar = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;overflow:scroll;width:100px;height:100px';
    document.body.append(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  });
  expect(scrollbar, 'the premise: this browser draws a scrollbar with a width').toBeGreaterThan(0);
  await control(page, TAB('phone')).click();
  await expect.poll(body, 'the phone page is 390 px wide').toBe(390);
  await control(page, TAB('tablet')).click();
  await expect.poll(body, 'the tablet page is 834 px wide').toBe(834);
  await control(page, TAB('desktop')).click();
  await expect.poll(body, 'the desktop page keeps the scrollbar free').toBe(1440 - scrollbar);
});
