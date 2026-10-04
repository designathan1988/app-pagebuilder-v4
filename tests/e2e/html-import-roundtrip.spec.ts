// The canonical page's repeated layer names belong to different BEM blocks. Its ZIP must stay byte-identical
// after the person imports it through File > Import HTML and exports it again.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const IMPORT = 'project.importHtml#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';
const PHOTOS = '.cache/logs/nr1';

test('canonical export stays byte-identical after a real import', runs(OPEN, IMPORT, EXPORT), async ({ page }) => {
  fs.mkdirSync(PHOTOS, { recursive: true });
  await openEditor(page);
  const opening = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await opening).setFiles('manifest/features/fixtures/canonical.json');
  await expect(page.frameLocator('.frame__page').locator('body')).toContainText('Cardápio');
  await page.screenshot({ path: `${PHOTOS}/before-import.png` });

  const firstDownload = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const first = fs.readFileSync(await (await firstDownload).path());
  const choosing = page.waitForEvent('filechooser');
  await runDoor(page, IMPORT);
  await (await choosing).setFiles({ name: 'site.zip', mimeType: 'application/zip', buffer: first });
  await page.locator('[data-door="project.importHtml#destination-replace"]').click();
  await page.locator('[data-confirmation="confirm"]').click();
  await expect(page.frameLocator('.frame__page').locator('body')).toContainText('Cardápio');
  await page.screenshot({ path: `${PHOTOS}/after-import.png` });

  const secondDownload = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const second = fs.readFileSync(await (await secondDownload).path());
  expect(second).toEqual(first);
});

test('one author class alone on an unstyled element survives an export and import', runs(OPEN, IMPORT, EXPORT), async ({ page }) => {
  const photos = '.cache/logs/rt1';
  fs.mkdirSync(photos, { recursive: true });
  const fixture = JSON.parse(fs.readFileSync('manifest/features/fixtures/brand-title.json', 'utf8')) as {
    pages: { tree: { children: { classes: string[]; styles: object }[] } }[];
    classes?: { name: string; styles: object }[];
  };
  const title = fixture.pages[0]?.tree.children[0];
  if (title === undefined) throw new Error('the fixture has no title');
  title.classes = ['accent'];
  title.styles = {};
  fixture.classes = [{ name: 'accent', styles: { desktop: { base: { color: 'red' } } } }];

  await openEditor(page);
  const opening = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await opening).setFiles({ name: 'single-class.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.frameLocator('.frame__page').getByRole('heading', { name: 'Fresh coffee' })).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.screenshot({ path: `${photos}/before-import.png` });

  const firstDownload = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const first = fs.readFileSync(await (await firstDownload).path());
  const choosing = page.waitForEvent('filechooser');
  await runDoor(page, IMPORT);
  await (await choosing).setFiles({ name: 'site.zip', mimeType: 'application/zip', buffer: first });
  await page.locator('[data-door="project.importHtml#destination-replace"]').click();
  await page.locator('[data-confirmation="confirm"]').click();
  await expect(page.frameLocator('.frame__page').getByRole('heading', { name: 'Fresh coffee' })).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.screenshot({ path: `${photos}/after-import.png` });

  const secondDownload = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  expect(fs.readFileSync(await (await secondDownload).path())).toEqual(first);
});
