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
