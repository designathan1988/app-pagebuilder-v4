// The read-only test port (src/editor/test-port.ts): it reads the document, the selection, the history and the export,
// and exposes nothing that writes. Its members are exactly those four readers, it is frozen and cannot be replaced, a
// read is a copy (changing it changes nothing), and calling every member with arguments leaves the editor as it was.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const aurora = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as unknown;

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles(FIXTURE);
}

const read = (page: Page) =>
  page.evaluate(() => {
    const port = (window as unknown as Record<string, { document: () => unknown; selection: () => unknown; history: () => unknown; export: () => unknown }>).__builderTestPort;
    if (!port) throw new Error('no test port');
    return { document: port.document(), selection: port.selection(), history: port.history(), export: port.export() };
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
});

test('the test port has only its readers, frozen and fixed on window', async ({ page }) => {
  const shape = await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, '__builderTestPort');
    const port = descriptor?.value as Record<string, unknown> | undefined;
    return {
      members: port ? Object.getOwnPropertyNames(port).sort() : null,
      kinds: port ? Object.values(port).map((v) => typeof v) : null,
      frozen: port ? Object.isFrozen(port) : null,
      writable: descriptor?.writable,
      configurable: descriptor?.configurable,
    };
  });
  // its readers: the document, the selection, the history and the export, the incident feed's list and its
  // explanations (main.tsx: what the page throws goes to the feed, and the test port carries it), and the message keys
  // shown, which the browser tests' coverage records (DEC-73)
  expect(shape).toEqual({ members: ['document', 'explain', 'export', 'history', 'incidents', 'keys', 'selection'], kinds: ['function', 'function', 'function', 'function', 'function', 'function', 'object'], frozen: true, writable: false, configurable: false });
});

test('the test port reads what File › Open loaded, as copies, and its members change nothing', runs('project.open#menu-file'), async ({ page }) => {
  await openAurora(page);
  await expect.poll(async () => (await read(page)).document).toEqual(aurora);
  expect(await read(page)).toEqual({ document: aurora, selection: [], history: { undoSteps: 0, redoSteps: 0 }, export: null });

  const rendered = () => page.frameLocator('.frame__page').locator('[data-node]').count();
  const nodes = await rendered();
  await page.evaluate(() => {
    const port = (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>).__builderTestPort;
    if (!port) return;
    // change a read, and call every member with arguments, as a test that tried to write would
    const document = port.document?.() as { pages: unknown[] };
    document.pages.length = 0;
    // every reader called with arguments, and every explanation on the port's explain object, as a test that tried to
    // write would (the explain object is not callable itself): a reader that refuses its arguments (an explanation of
    // a command no manifest holds) still changes nothing, which is what this test is about
    const attempt = (call: () => unknown) => {
      try {
        call();
      } catch {
        // a refused read
      }
    };
    for (const member of Object.values(port)) {
      if (typeof member === 'function') attempt(() => member({ version: 1, pages: [] }, ['x'], true));
      else if (member !== null && typeof member === 'object') for (const inner of Object.values(member)) attempt(() => (inner as (...a: unknown[]) => unknown)({ version: 1, pages: [] }, ['x']));
    }
  });
  expect(await read(page)).toEqual({ document: aurora, selection: [], history: { undoSteps: 0, redoSteps: 0 }, export: null });
  expect(await rendered()).toBe(nodes);
});
