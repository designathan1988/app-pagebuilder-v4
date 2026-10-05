// The code pane (manifest features code-panel-view, code-panel-copy-download and code-panel-selection-sync; PRODUCT.md
// §5.3 "Files, tabs and code"): what the pane shows is what the export writes — the same page's HTML and the same
// stylesheet, byte for byte — Copy hands away exactly the pane's text, Download the same text as a file, selecting an
// element marks and scrolls to its lines, and a click inside an element's markup selects that element. The document
// is read through the read-only test port, the pane through its own lines.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { unzip } from '../../tools/runner/unzip.ts';
import { control, runDoor, runs, openExplorer } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';
const VIEW = (view: string) => `view.setEditorView#toolbar-canvas-toolbar-${view}` as const;
const PANE = (pane: string) => `codePanel.setPane#code-panel-tab-${pane}` as const;
const COPY = 'codePanel.copyPane#code-panel-copy';
const DOWNLOAD = 'codePanel.downloadPane#code-panel-download';
const LINE = 'selection.select#code-panel-html-line';
const ROW = 'selection.select#layers-row';

// the pane's text: every line, its number apart (the numbers are drawn in their own column)
const paneText = (page: Page): Promise<string> =>
  page.locator('.code-line').evaluateAll((els) => els.map((el) => el.textContent ?? '').join('\n'));

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"]')).toHaveCount(1);
  await runDoor(page, VIEW('code'));
  await expect(page.locator('.code-pane')).toBeVisible();
}

const exported = async (page: Page): Promise<Map<string, Buffer>> => {
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  return unzip(fs.readFileSync(await (await download).path()));
};

test('the HTML pane shows the exported page, line for line', runs(OPEN, VIEW('code'), PANE('html')), async ({ page }) => {
  await open(page);
  const files = await exported(page);
  const html = files.get('index.html')?.toString('utf8') ?? '';
  expect(html, 'the export wrote the page').not.toBe('');
  expect(await paneText(page), 'the pane shows the page the export writes').toBe(html);
  // the CSS tab shows the stylesheet the export writes, and the export's own text
  await runDoor(page, PANE('css'));
  const css = files.get('css/styles.css')?.toString('utf8') ?? '';
  expect(css, 'the export wrote the stylesheet').not.toBe('');
  expect(await paneText(page), 'the pane shows the stylesheet the export writes').toBe(css);
  // every line carries a number, and the file's name stands in the pane's head
  expect(await page.locator('.code-row__number').count(), 'every line is numbered').toBe((await page.locator('.code-line').count()));
  // every line is as tall as the others, and a line that selects its element names its line (the audit's U-023:
  // element lines stood 28 px among 18 px ones, all named "Select")
  await runDoor(page, PANE('html'));
  const heights = await page.locator('.code-row').evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))]);
  expect(heights, 'one line height').toHaveLength(1);
  const names = await page.locator(`.code-line[data-door="${LINE}"]`).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((name) => /^Select line \d+$/.test(name ?? '')), names.slice(0, 3).join(', ')).toBe(true);
  await runDoor(page, PANE('css'));
  await expect(control(page, PANE('html')).or(control(page, PANE('css'))).first()).toBeVisible();
  await runDoor(page, PANE('html'));
  await expect(page.locator('.code-pane__name')).toHaveText('index.html');
});

test('Copy hands exactly the pane\'s text, and Download the same as a file', runs(COPY, DOWNLOAD), async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const shown = await paneText(page);
  await runDoor(page, COPY);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // the system clipboard hands the text back with the platform's line ends (Windows writes CR): what the clipboard
  // holds is the pane's text, whatever the platform makes of a line's end
  expect(copied.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'the clipboard holds exactly the pane\'s text').toBe(shown);
  const download = page.waitForEvent('download');
  await runDoor(page, DOWNLOAD);
  const file = await download;
  expect(file.suggestedFilename(), 'the file is the one the pane shows').toBe('index.html');
  const bytes = fs.readFileSync(await file.path());
  expect(bytes.toString('utf8'), 'the file holds exactly the pane\'s text').toBe(shown);
});

test('selecting an element marks its lines, and a click on a line selects its element', runs(LINE, ROW), async ({ page }) => {
  await open(page);
  // the whole page's markup, with nothing selected: a click on a line selects the element it belongs to (the port,
  // the Layers row and the canvas agree)
  await control(page, LINE, { args: { target: 'n-title' } }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection()))[0], { message: 'the click selected the element whose markup it hit' }).toBe('n-title');
  await expect(page.getByRole('status')).toHaveText('Title selected.');
  await expect(control(page, ROW, { args: { target: 'n-title' } }), 'the Layers row of that element is selected').toHaveClass(/is-selected/);
  // selecting an element shows its own part of the code, which is what its Apply writes back: the Hero's markup, the
  // class the export invents for its stylesheet left out (it is not the element's data)
  await runDoor(page, ROW, { args: { target: 'n-hero' } });
  const shown = await editorText(page);
  expect(shown.split('\n')[0], 'the pane holds the selected element\'s own markup').toMatch(/^<section/);
  expect(shown, 'and everything inside it').toContain('<h1>');
});

test('the view switch shows the code pane, beside the canvas or alone', runs(VIEW('code'), VIEW('split'), VIEW('canvas')), async ({ page }) => {
  await open(page);
  expect(await page.locator('.stage').count(), 'the code view draws no canvas').toBe(0);
  await runDoor(page, VIEW('split'));
  await expect(page.locator('.stage')).toHaveCount(1);
  await expect(page.locator('.code-pane')).toBeVisible();
  await runDoor(page, VIEW('canvas'));
  await expect(page.locator('.code-pane')).toHaveCount(0);
  await expect(page.locator('.stage')).toHaveCount(1);
});

// The pane's editing surface: the text of the element's own part of the code (its rule, its markup), read from the
// field that holds it. Typing into it replaces what the select-all took.
const editorText = (page: Page): Promise<string> =>
  page.locator('[data-code-editor]').evaluate((el) => (el instanceof HTMLTextAreaElement ? el.value : [...el.querySelectorAll('.code-line')].map((line) => line.textContent ?? '').join('\n')));
async function typeInPane(page: Page, text: string): Promise<void> {
  const editor = page.locator('[data-code-editor]');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
}

// the document as the port reads it, the tree of the page the editor shows
const tree = (page: Page): Promise<unknown> =>
  page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: unknown }[] } } }).__builderTestPort.document().pages[0]?.tree);
interface Node { readonly id: string; readonly name: string; readonly tag: string | null; readonly text: string | null; readonly inline?: unknown; readonly attributes?: Readonly<Record<string, unknown>>; readonly styles?: unknown; readonly children: readonly Node[] }
const find = (node: Node, name: string): Node | null => (node.name === name ? node : node.children.map((c) => find(c, name)).find((x) => x !== null) ?? null);

test('the markup pane writes the element\'s subtree, and the nodes it keeps keep their ids', runs('element.applyHtml#code-panel-html-apply'), async ({ page }) => {
  await open(page);
  // the Hero selected: the pane shows its own markup, with the class the export invents taken off
  await runDoor(page, ROW, { args: { target: 'n-hero' } });
  const shown = await editorText(page);
  expect(shown.startsWith('<section'), 'the pane shows the element\'s own markup').toBe(true);
  expect(shown).toContain('<h1>');
  const before = (await tree(page)) as unknown as Node;
  const introId = find(before, 'Intro')?.id ?? '';
  expect(introId, 'the fixture holds the Intro').not.toBe('');
  // the person changes the heading's text and adds a paragraph after it, then applies
  const edited = shown.replace('<h1>Welcome to Aurora</h1>', '<h1>Welcome to <strong>Aurora</strong></h1>\n  <p id="note">Fresh</p>');
  await control(page, 'codePanel.setPane#code-panel-tab-html').click();
  await typeInPane(page, edited);
  await runDoor(page, 'element.applyHtml#code-panel-html-apply');
  await expect(page.getByRole('status')).toHaveText('Applied the HTML of Hero.');
  const after = (await tree(page)) as unknown as Node;
  const hero = find(after, 'Hero');
  const title = find(after, 'Title');
  const para = hero?.children.find((c) => c.tag === 'p') ?? null;
  expect(title?.text, 'the heading\'s text is what the markup says').toBe('Welcome to Aurora');
  expect(title?.inline, 'and its marks, in the document\'s own tree').toEqual(['Welcome to ', { tag: 'strong', children: ['Aurora'] }]);
  expect(para?.attributes ?? null, 'the paragraph the markup added carries its id').toMatchObject({ id: 'note' });
  expect(find(after, 'Intro')?.id, 'a node the markup left where it was keeps its id').toBe(introId);
  // undo takes the whole markup back
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => find((await tree(page)) as unknown as Node, 'Title')?.inline ?? null, { message: 'one undo takes the markup back' }).toBeNull();
});

test('the rule pane writes the element\'s declarations, and refuses a line that is not one', runs('style.applyCssRule#code-panel-css-apply'), async ({ page }) => {
  await open(page);
  await runDoor(page, ROW, { args: { target: 'n-title' } });
  await runDoor(page, 'codePanel.setPane#code-panel-tab-css');
  const editor = page.locator('[data-code-editor]');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('color: #00aa00;\nletter-spacing: 2px;');
  await runDoor(page, 'style.applyCssRule#code-panel-css-apply');
  await expect(page.getByRole('status')).toHaveText('Applied the CSS of Title.');
  const styles = await page.evaluate(() => {
    const d = (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document();
    const walk = (n: Node): Node | null => (n.name === 'Title' ? n : n.children.map(walk).find((x) => x !== null) ?? null);
    return (walk(d.pages[0]?.tree as Node) as unknown as { styles: unknown }).styles;
  });
  expect(styles, 'the document holds exactly the declarations the pane kept').toEqual({ desktop: { base: { color: '#00aa00', 'letter-spacing': '2px' } } });
  // a line that is not "property: value" is refused with its line, and the document keeps what it holds
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('color: #00aa00;\nnot a declaration');
  await runDoor(page, 'style.applyCssRule#code-panel-css-apply');
  await expect(page.getByRole('status')).toHaveText('Line 2: "not a declaration" is not "property: value".');
  expect(await editorText(page), 'the pane keeps what was typed').toContain('not a declaration');
});

// A project's own JavaScript (manifest feature code-panel-edit-js): the pane edits the file's text and Save writes it
// in the project (files.saveContent, one undo step); a syntax error is refused with its line and the file keeps what it
// held; a page that links the script runs it in the Preview (whose frame has an opaque origin: the script's own text
// goes in, not a URL of it).
const NEW_FILE = 'files.createFile#explorer-new-file';
const SAVE = 'files.saveContent#code-panel-save';
const SCRIPTS = 'page.setSetting#inspector-page-scripts';
const ROW_ICON = 'files.open#explorer-file-row';
const SETTINGS_TAB = 'workspace.setActiveTab#inspector-tab-settings';
const PREVIEW = 'view.enterPreview#toolbar-top-bar-preview';

const fileBytes = (page: Page, path: string): Promise<string | null> =>
  page.evaluate((wanted) => (window as unknown as { __builderTestPort: { document: () => { files?: { path: string; bytes: string }[] } } }).__builderTestPort.document().files?.find((f) => f.path === wanted)?.bytes ?? null, path);

test('a JS file is edited and saved, and the page that links it runs it in the Preview', runs(NEW_FILE, SAVE, SCRIPTS, ROW_ICON, PREVIEW), async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openExplorer(page);
  await control(page, NEW_FILE).fill('js/main.js');
  await control(page, NEW_FILE).press('Enter');
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { files?: unknown[] } } }).__builderTestPort.document().files?.length ?? 0)).toBe(1);
  // its row opens it in the pane, which shows its (empty) text
  const row = page.locator('[data-file="js/main.js"]');
  await row.hover();
  await control(page, ROW_ICON, { args: { path: 'js/main.js' } }).click();
  await expect(page.locator('[data-code-editor]')).toBeVisible();
  await typeInPane(page, 'document.title = "Ran from the script";');
  await runDoor(page, SAVE);
  await expect(page.getByRole('status')).toHaveText('Saved js/main.js.');
  expect(Buffer.from((await fileBytes(page, 'js/main.js')) ?? '', 'base64').toString('utf8'), 'the file holds what was typed').toBe('document.title = "Ran from the script";');
  // a syntax error is refused with its line, and the file keeps its text
  await typeInPane(page, 'const = ;');
  await runDoor(page, SAVE);
  await expect(page.getByRole('status')).toContainText('JavaScript error on line');
  expect(Buffer.from((await fileBytes(page, 'js/main.js')) ?? '', 'base64').toString('utf8'), 'a refused save writes nothing').toBe('document.title = "Ran from the script";');
  // the page links it, and the Preview runs it
  await typeInPane(page, 'document.title = "Ran from the script";');
  await runDoor(page, SAVE);
  await page.locator('[data-door="selection.select#layers-row"]').first().click();
  await runDoor(page, SETTINGS_TAB);
  await control(page, SCRIPTS).locator('input, textarea').first().fill('js/main.js');
  await control(page, SCRIPTS).locator('input, textarea').first().press('Enter');
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { attributes: Record<string, unknown> } }[] } } }).__builderTestPort.document().pages[0]?.tree.attributes.pageScripts ?? null)).toBe('js/main.js');
  await runDoor(page, PREVIEW);
  await expect.poll(async () => page.locator('iframe.preview__page').contentFrame().locator('title').textContent().catch(() => null), { message: 'the linked script runs in the Preview' }).toBe('Ran from the script');
});

// The keys of the canvas belong to the stage: with the focus on the code pane's own controls, Delete, Backspace and the
// arrows are no canvas keys — the element selected before stays, and so does the document (the code audit's E-01:
// Delete in the Code view deleted the element the canvas no longer drew).
test('Delete on the code pane keeps the selected element', runs(VIEW('code'), ROW), async ({ page }) => {
  await open(page);
  await runDoor(page, VIEW('split'));
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection())).toEqual(['n-title']);
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document()));
  await page.locator('.code-pane [data-door], .code-pane button').first().focus();
  for (const key of ['Delete', 'Backspace', 'ArrowDown']) await page.keyboard.press(key);
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document()))).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection())).toEqual(['n-title']);
});

// A text file shows one tab of its own and a named editor (spec code-panel-selection-sync; the audit's U-053: the HTML,
// CSS and JS tabs with none selected, the editor named for the selected element's markup).
test('a text file shows its own tab, its extension, and an editor named after it', runs(NEW_FILE, ROW_ICON), async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openExplorer(page);
  await control(page, NEW_FILE).fill('notes.txt');
  await control(page, NEW_FILE).press('Enter');
  const row = page.locator('[data-file="notes.txt"]');
  await row.hover();
  await control(page, ROW_ICON, { args: { path: 'notes.txt' } }).click();
  const tabs = page.locator('.code-pane__tabs [role="tab"]');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText('TXT');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-code-editor]')).toHaveAttribute('aria-label', 'The text of notes.txt');
});

// The Code view keeps its pane within its column (the user's review of 2026-10-05, LR2: with the canonical project the
// pane was 993 px wide in an 840 px column, 153 px of it under the inspector — the file's name read "ind", the lines'
// ends were hidden and nothing scrolled to them; a flex item does not shrink below its content without min-width: 0,
// CSS Flexbox §4.5). Its lines scroll across inside it.
test('the Code view keeps the pane in its column, the file named whole and the long lines scrolled across', runs(OPEN, VIEW('code')), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await runDoor(page, VIEW('code'));
  const found = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const work = box('.centre__work');
    const pane = box('.code-pane');
    const name = document.querySelector<HTMLElement>('.code-pane__name');
    const body = document.querySelector<HTMLElement>('.code-pane__body');
    return {
      inside: work !== null && pane !== null && pane.right <= work.right + 1,
      named: name !== null && name.scrollWidth <= name.clientWidth + 1 && (name.getBoundingClientRect().right <= (pane?.right ?? 0) + 1),
      scrolls: body !== null && body.scrollWidth > body.clientWidth,
    };
  });
  expect(found).toEqual({ inside: true, named: true, scrolls: true });
});
