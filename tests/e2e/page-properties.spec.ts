// page-properties beyond its scenarios (spec/BEHAVIOUR.md#page-properties): Page properties from any selection and the
// fields of the page's settings in their order, those of features still to come not available yet; a setting kept
// with Enter never renames the page root and undo gives back its value and the selection; an emptied field removes the
// setting from the page root and from the canvas's <html>, also after a reload (Problems in Pager 5); leaving a field
// (Tab, a click on the canvas) keeps what was typed and the canvas's <html> takes the language and the direction;
// a refused value leaves the document as it was and the field shows the document's value again (Problems in Pager 3).
// The document, the selection and the history are read through the read-only test port; the page through the frame.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { isFeatureBuilt } from '../../src/app/features.ts';
import type { FeatureId } from '../../src/generated/ids.ts';
import { DOORS, control, openMenu, runDoor, runs } from './door.ts';
import { unzip } from '../../tools/runner/unzip.ts';

// the language Aurora's project is written in: what a page without a language of its own says (spec export-clean)
const PROJECT_LANGUAGE = 'en';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const SELECT = 'selection.select#canvas-click-element-or-page';
const PAGE_PROPERTIES = 'page.openProperties#inspector-page-properties-button';
const TITLE = 'page.setSetting#inspector-page-title';
const LANGUAGE = 'page.setSetting#inspector-page-language';
const DIRECTION = 'page.setSetting#inspector-page-direction';
const ROOT_CLASSES = 'page.setSetting#inspector-page-html-classes';
const DESCRIPTION = 'page.setSetting#inspector-page-description';
const CANONICAL = 'page.setSetting#inspector-page-canonical';
const OG_TITLE = 'page.setSetting#inspector-page-og-title';
const OG_IMAGE = 'page.setSetting#inspector-page-og-image';
const FAVICON = 'page.setSetting#inspector-page-favicon';
const EXPORT = 'project.export#toolbar-top-bar-export';
const UNDO = 'history.undo#toolbar-top-bar';
const REDO = 'history.redo#toolbar-top-bar';

const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
const ELEMENTS = JSON.parse(fs.readFileSync('manifest/elements.json', 'utf8')) as { attributes: { id: string; labelKey: string; elements: string[] | 'all' }[] };
const words = (key: string, params: Record<string, string> = {}) => (EN[key] ?? '').replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
const labelOf = (attribute: string) => EN[ELEMENTS.attributes.find((a) => a.id === attribute)?.labelKey ?? ''] ?? '';
// the settings of the page: the attributes elements.json gives the page root alone, in their order, with the door of
// each in the Settings tab
// The page's own settings that the panel draws: the grid and fold toggles left it for the canvas tools and Guides &
// Grids (the user's real-use audit, item 7.2), so an attribute without an inspector door is not a field of the panel.
const SETTINGS = ELEMENTS.attributes
  .filter((a) => Array.isArray(a.elements) && a.elements.length === 1 && a.elements[0] === 'page')
  .map((a) => ({ attribute: a.id, ref: [...DOORS].find(([, d]) => d.kind === 'inspector-field' && (d as { attribute?: string }).attribute === a.id)?.[0] ?? '' }))
  .filter((s) => s.ref !== '');

interface Tree {
  readonly id: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly children: readonly Tree[];
}
const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document(), selection: p.selection(), undoSteps: p.history().undoSteps };
  });
// the page root as the port reads it
const root = async (page: Page) => {
  const tree = (await port(page)).document.pages[0]?.tree;
  if (!tree) throw new Error('the document has no page');
  return tree;
};
const settingOf = async (page: Page, attribute: string) => (await root(page)).attributes[attribute] ?? null;
// the canvas page's <html> and <body>: their language and direction attributes, and the direction the body computes
const framePage = (page: Page) =>
  page
    .frameLocator('.frame__page')
    .locator('html')
    .evaluate((html) => {
      const body = html.ownerDocument.body;
      return { lang: html.getAttribute('lang'), dir: html.getAttribute('dir'), bodyLang: body.getAttribute('lang'), bodyDir: body.getAttribute('dir'), direction: getComputedStyle(body).direction };
    });
const drawn = (page: Page, id: string) => page.frameLocator('.frame__page').locator(`[data-node="${id}"]`);
const status = (page: Page) => page.getByRole('status');
const input = (page: Page, ref: string) => control(page, ref).locator('input');

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-door="${OPEN}"]`).click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
}

// a click on the centre of a node's element on the canvas, which selects it
async function select(page: Page, id: string) {
  const at = await page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
    if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
  }, id);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await port(page)).selection).toEqual([id]);
}

// Page properties from the inspector's header: the page root selected, the fields of its settings shown
async function openPageProperties(page: Page) {
  await runDoor(page, PAGE_PROPERTIES);
  await expect.poll(async () => (await port(page)).selection, 'Page properties selects the page root').toEqual(['n-page']);
  await expect(input(page, TITLE), 'the Settings tab shows the page title').toBeVisible();
}

// types into a setting's field as a person does: a click on it, everything it holds selected, then the text (an
// empty text deletes what it holds)
async function typeInto(page: Page, ref: string, text: string) {
  await input(page, ref).click();
  await page.keyboard.press('Control+A');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(text);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
});

test('Page properties selects the page root from any selection and shows the fields of its settings in their order; those of features still to come are not available yet', runs(OPEN, SELECT, PAGE_PROPERTIES), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, PAGE_PROPERTIES);
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-page']);
  await expect(status(page)).toHaveText(words('status.selected', { name: 'Page' }));
  expect((await port(page)).undoSteps).toBe(0);
  // the fields of the page's settings, in the order of elements.json, each enabled exactly when its feature is built
  const rows = page.locator('[data-region="inspector-settings"] [data-door^="page.setSetting#"]');
  expect(SETTINGS.slice(0, 3).map((s) => s.attribute)).toEqual(['pageTitle', 'pageLanguage', 'pageDirection']);
  await expect(rows).toHaveCount(SETTINGS.length);
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-door')))).toEqual(SETTINGS.map((s) => s.ref));
  for (const s of SETTINGS) {
    const field = input(page, s.ref);
    await expect(field).toHaveAccessibleName(labelOf(s.attribute));
    const feature = DOORS.get(s.ref)?.feature ?? '';
    if (isFeatureBuilt(feature as FeatureId)) await expect(field).toBeEnabled();
    else {
      await expect(field).toBeDisabled();
      await expect(control(page, s.ref)).toHaveAttribute('title', new RegExp(EN['common.notAvailableYet'] ?? 'not available yet'));
    }
  }
  // from the page root itself, it stays selected and the tab stays shown
  await runDoor(page, PAGE_PROPERTIES);
  expect((await port(page)).selection).toEqual(['n-page']);
  await expect(input(page, TITLE)).toBeVisible();
});

test('an authored page can edit its HTML root classes and undo the change', runs(OPEN, PAGE_PROPERTIES, ROOT_CLASSES, UNDO, EXPORT), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  fs.mkdirSync('.cache/logs/qa268', { recursive: true });
  await page.screenshot({ path: '.cache/logs/qa268/root-classes-before.png' });
  await typeInto(page, ROOT_CLASSES, 'font-brand');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageHtmlClasses')).toBe('font-brand');
  await expect.poll(() => page.frameLocator('.frame__page').locator('html').evaluate((html) => html.className)).toBe('font-brand');
  await page.screenshot({ path: '.cache/logs/qa268/root-classes-after.png' });
  const downloading = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const html = String(files.get('index.html'));
  expect(html).toMatch(/<html\b[^>]*\bclass="font-brand"/);
  expect(html).toMatch(/<html\b[^>]*\blang="en"/);
  await runDoor(page, UNDO);
  await expect.poll(() => settingOf(page, 'pageHtmlClasses')).toBeNull();
  await expect.poll(() => page.frameLocator('.frame__page').locator('html').evaluate((html) => html.className)).toBe('');
  await page.screenshot({ path: '.cache/logs/qa268/root-classes-undone.png' });
});

test('a saved version-one page opens with its authored content in version three', runs(OPEN), async ({ page }) => {
  const legacy = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  legacy.version = 1;
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-door="${OPEN}"]`).click();
  await (await chooser).setFiles({ name: 'aurora-v1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
  expect((await root(page)).name).toBe('Page');
  const version = await page.evaluate(() => (window as unknown as { __builderTestPort: { document(): { version: number } } }).__builderTestPort.document().version);
  expect(version).toBe(3);
});

test('a setting kept with Enter is stored on the page root, never renames it, and undo gives back the value and the selection', runs(OPEN, PAGE_PROPERTIES, TITLE, SELECT, UNDO, REDO), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  await typeInto(page, TITLE, 'Landing');
  // typing changes only the field
  expect(await settingOf(page, 'pageTitle')).toBeNull();
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageTitle')).toBe('Landing');
  await expect(status(page)).toHaveText(words('status.page.settingSet', { setting: labelOf('pageTitle'), value: 'Landing' }));
  expect((await root(page)).name).toBe('Page');
  expect((await port(page)).undoSteps).toBe(1);
  // Enter again with the same text records nothing
  await page.keyboard.press('Enter');
  expect((await port(page)).undoSteps).toBe(1);
  await select(page, 'n-intro');
  await runDoor(page, UNDO);
  await expect.poll(() => settingOf(page, 'pageTitle')).toBeNull();
  expect((await port(page)).selection).toEqual(['n-page']);
  await runDoor(page, REDO);
  await expect.poll(() => settingOf(page, 'pageTitle')).toBe('Landing');
});

test("emptying a field and keeping it removes the setting from the page root and from the canvas's <html>, also after a reload", runs(OPEN, PAGE_PROPERTIES, LANGUAGE, UNDO, REDO), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  await typeInto(page, LANGUAGE, 'pt-BR');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageLanguage')).toBe('pt-BR');
  await expect.poll(async () => (await framePage(page)).lang).toBe('pt-BR');
  expect((await framePage(page)).bodyLang).toBeNull();
  await typeInto(page, LANGUAGE, '');
  await page.keyboard.press('Enter');
  await expect.poll(async () => 'pageLanguage' in (await root(page)).attributes).toBe(false);
  await expect(status(page)).toHaveText(words('status.page.settingRemoved', { setting: labelOf('pageLanguage') }));
  // the page's own language gone, the canvas's <html> says the project's (the effective language: spec export-clean)
  await expect.poll(async () => (await framePage(page)).lang).toBe(PROJECT_LANGUAGE);
  expect((await port(page)).undoSteps).toBe(2);
  await runDoor(page, UNDO);
  await expect.poll(async () => (await framePage(page)).lang).toBe('pt-BR');
  expect(await settingOf(page, 'pageLanguage')).toBe('pt-BR');
  await runDoor(page, REDO);
  await expect.poll(async () => (await framePage(page)).lang).toBe(PROJECT_LANGUAGE);
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
  expect('pageLanguage' in (await root(page)).attributes).toBe(false);
  expect((await framePage(page)).lang).toBe(PROJECT_LANGUAGE);
});

test("leaving a field keeps what was typed, with Tab or a click on the canvas, and the canvas's <html> takes the direction and the language", runs(OPEN, PAGE_PROPERTIES, DIRECTION, LANGUAGE, SELECT), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  expect((await framePage(page)).direction).toBe('ltr');
  await typeInto(page, DIRECTION, 'rtl');
  await page.keyboard.press('Tab');
  await expect.poll(() => settingOf(page, 'pageDirection')).toBe('rtl');
  await expect.poll(async () => (await framePage(page)).dir).toBe('rtl');
  const shown = await framePage(page);
  expect(shown.direction).toBe('rtl');
  expect(shown.bodyDir).toBeNull();
  expect((await port(page)).undoSteps).toBe(1);
  await typeInto(page, LANGUAGE, 'pt-BR');
  await select(page, 'n-intro');
  await expect.poll(() => settingOf(page, 'pageLanguage')).toBe('pt-BR');
  await expect.poll(async () => (await framePage(page)).lang).toBe('pt-BR');
  expect((await port(page)).undoSteps).toBe(2);
  // after an immediate reload, the canvas draws the page in its language and direction again
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
  expect(await settingOf(page, 'pageDirection')).toBe('rtl');
  const reloaded = await framePage(page);
  expect([reloaded.lang, reloaded.dir, reloaded.direction]).toEqual(['pt-BR', 'rtl', 'rtl']);
});

test('the page metadata fields write the head of the export', runs(OPEN, PAGE_PROPERTIES, DESCRIPTION, CANONICAL, OG_TITLE, OG_IMAGE, FAVICON, EXPORT), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  // the acceptance of the real-use audit, 7.2: Description and Sharing title typed in the page's Settings reach the
  // exported head; the canonical URL, the sharing image and the favicon go with them
  await typeInto(page, DESCRIPTION, 'Aurora builds the whole page.');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageDescription')).toBe('Aurora builds the whole page.');
  await typeInto(page, OG_TITLE, 'Aurora: build the whole page');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageOgTitle')).toBe('Aurora: build the whole page');
  await typeInto(page, CANONICAL, 'https://aurora.example/');
  await page.keyboard.press('Enter');
  await typeInto(page, OG_IMAGE, 'https://aurora.example/card.png');
  await page.keyboard.press('Enter');
  await typeInto(page, FAVICON, '/favicon.ico');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageFavicon')).toBe('/favicon.ico');
  expect((await port(page)).undoSteps).toBe(5);
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await download).path()));
  const html = files.get('index.html')?.toString('utf8') ?? '';
  expect(html).toContain('<meta name="description" content="Aurora builds the whole page.">');
  expect(html).toContain('<meta property="og:title" content="Aurora: build the whole page">');
  expect(html).toContain('<link rel="canonical" href="https://aurora.example/">');
  expect(html).toContain('<meta property="og:image" content="https://aurora.example/card.png">');
  expect(html).toContain('<link rel="icon" href="/favicon.ico">');
  // emptying one removes it from the page root and from the head of the next export
  await typeInto(page, DESCRIPTION, '');
  await page.keyboard.press('Enter');
  await expect.poll(async () => 'pageDescription' in (await root(page)).attributes).toBe(false);
  const second = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const again = unzip(fs.readFileSync(await (await second).path())).get('index.html')?.toString('utf8') ?? '';
  expect(again).not.toContain('<meta name="description"');
  expect(again).toContain('<meta property="og:title" content="Aurora: build the whole page">');
});

test("a refused value leaves the document as it was, and the field shows the document's value again", runs(OPEN, PAGE_PROPERTIES, LANGUAGE), async ({ page }) => {
  await openAurora(page);
  await openPageProperties(page);
  await typeInto(page, LANGUAGE, 'en');
  await page.keyboard.press('Enter');
  await expect.poll(() => settingOf(page, 'pageLanguage')).toBe('en');
  await typeInto(page, LANGUAGE, 'english!');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(words('status.page.settingInvalid', { setting: labelOf('pageLanguage'), value: 'english!' }));
  expect(await settingOf(page, 'pageLanguage')).toBe('en');
  expect((await port(page)).undoSteps).toBe(1);
  await expect(input(page, LANGUAGE)).toHaveValue('en');
  // the same refused text typed again is refused again, and leaving the field keeps nothing new
  await typeInto(page, LANGUAGE, 'english!');
  await page.keyboard.press('Enter');
  await expect(input(page, LANGUAGE)).toHaveValue('en');
  await page.keyboard.press('Tab');
  expect(await settingOf(page, 'pageLanguage')).toBe('en');
  expect((await port(page)).undoSteps).toBe(1);
  expect((await framePage(page)).lang).toBe('en');
});
