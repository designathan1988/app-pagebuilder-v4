// The link picker and the references between elements (spec elements-structure; the user's real-use audit, items 7.4,
// A3.4 and A3.44): the picker chooses what a link points at (a page of the project, an element of the page, an address),
// a reference is kept by the target's node id so renaming the target's ID leaves it working and the export writes the
// ID as it stands, a delete says how many references it takes away and removes them in the same undo step, and a
// project file whose semantics are broken is refused with the reason at File › Open.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';
import { unzip } from '../../tools/runner/unzip.ts';

const INSERT = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const SETTINGS = 'workspace.setActiveTab#inspector-tab-settings';
const OPEN_PICKER = 'linkPicker.open#field-href-choose';
const KIND = (kind: string) => `linkPicker.setKind#link-picker-${kind}`;
const ANCHOR_ITEM = 'element.setLink#link-picker-anchor-item';
const PAGE_ITEM = 'element.setLink#link-picker-page-item';
const CLOSE = 'linkPicker.close#link-picker-close';
const ID_FIELD = 'element.setId#inspector-id';
const LABEL_FOR = 'element.setLabelTarget#inspector-label-for';
const OPEN = 'project.open#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';
const ROW = 'selection.select#layers-row';

interface Node { readonly id: string; readonly type: string; readonly name: string; readonly attributes: Readonly<Record<string, unknown>>; readonly children: readonly Node[] }
const tree = async (page: Page): Promise<Node> =>
  page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document().pages[0]?.tree as Node);
const find = (node: Node, type: string): Node | null => (node.type === type ? node : node.children.map((c) => find(c, type)).find((x) => x !== null) ?? null);
async function typeInto(page: Page, ref: string, text: string, keep: 'enter' | 'tab' = 'enter'): Promise<void> {
  const field = control(page, ref).locator('textarea, input').first();
  await field.click();
  await page.keyboard.press('Control+A');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(text);
  await page.keyboard.press(keep === 'tab' ? 'Tab' : 'Enter');
}
async function exportedHtml(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  return unzip(fs.readFileSync(await (await download).path())).get('index.html')?.toString('utf8') ?? '';
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await openEditor(page);
  await runDoor(page, INSERT);
});

test('the link picker chooses a section, a page or an address, and closes with Escape or its button', runs(INSERT, TILE, SETTINGS, OPEN_PICKER, KIND('page'), KIND('anchor'), KIND('url'), ANCHOR_ITEM, PAGE_ITEM, CLOSE, EXPORT), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'heading' } });
  await runDoor(page, SETTINGS);
  await typeInto(page, ID_FIELD, 'inicio');
  await runDoor(page, TILE, { args: { entry: 'link' } });
  await runDoor(page, SETTINGS);
  const link = find(await tree(page), 'link');
  const heading = find(await tree(page), 'heading');
  if (link === null || heading === null) throw new Error('the Link and the Heading are missing');
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  const picker = page.locator('[data-region="link-picker"]');
  await expect(picker).toBeVisible();
  // the kinds are the region's five segments; the anchor kind lists the elements that carry an ID, by name and ID
  expect(await picker.locator('[data-door^="linkPicker.setKind"] ').count()).toBe(5);
  await runDoor(page, KIND('anchor'));
  await expect(control(page, ANCHOR_ITEM, { args: { anchor: heading.id } })).toBeVisible();
  await expect(control(page, ANCHOR_ITEM, { args: { anchor: heading.id } })).toContainText('· #inicio');
  await runDoor(page, KIND('page'));
  await expect(control(page, PAGE_ITEM, { args: { page: 'index.html' } })).toBeVisible();
  await runDoor(page, KIND('url'));
  await expect(picker.locator('input[type="text"]')).toBeVisible();
  await picker.locator('input[type="text"]').fill('/about');
  await picker.locator('input[type="text"]').press('Enter');
  await expect.poll(async () => find(await tree(page), 'link')?.attributes.href).toBe('/about');
  // the anchor writes the section; the export carries the fragment the target's ID names
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await runDoor(page, KIND('anchor'));
  await runDoor(page, ANCHOR_ITEM, { args: { anchor: heading.id } });
  await expect.poll(async () => find(await tree(page), 'link')?.attributes.href).toBe(`#${heading.id}`);
  // choosing an element ends the choice: the picker closes (the journey "site")
  await expect(picker).toHaveCount(0);
  expect(await exportedHtml(page)).toContain('<a href="#inicio">A link</a>');
  // Escape closes the picker; the close button too
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await runDoor(page, CLOSE);
  await expect(picker).toHaveCount(0);
  // and renaming the target's ID leaves the link working: the export follows it (A3.4)
  await control(page, ROW, { args: { target: heading.id } }).click();
  await runDoor(page, SETTINGS);
  await typeInto(page, ID_FIELD, 'cta');
  expect(await exportedHtml(page)).toContain('<a href="#cta">A link</a>');
});

test('one outside click leaves the link picker and edits the chosen ID field', runs(INSERT, TILE, SETTINGS, OPEN_PICKER, ID_FIELD), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'link' } });
  await runDoor(page, SETTINGS);
  await runDoor(page, OPEN_PICKER);
  const field = control(page, ID_FIELD).locator('input');
  await field.click();
  await expect(page.locator('[data-region="link-picker"]')).toHaveCount(0);
  await expect(field).toBeFocused();
  await page.keyboard.type('contact');
  await page.keyboard.press('Enter');
  await expect.poll(async () => find(await tree(page), 'link')?.attributes.id).toBe('contact');
});

test('a label points at a control by name or ID, follows the ID, and a delete says what it takes away', runs(INSERT, TILE, SETTINGS, LABEL_FOR, ID_FIELD, 'element.delete#menu-edit', EXPORT), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'input-text' } });
  await runDoor(page, TILE, { args: { entry: 'label' } });
  await runDoor(page, SETTINGS);
  const label = find(await tree(page), 'label');
  const input = find(await tree(page), 'input');
  if (label === null || input === null) throw new Error('the Label and the Input are missing');
  // the field shows the control it points at, by name and ID, and takes either of them
  await runDoor(page, LABEL_FOR);
  const field = control(page, LABEL_FOR).locator('input');
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Input');
  await page.keyboard.press('Enter');
  await expect.poll(async () => find(await tree(page), 'label')?.attributes.labelFor).toBe(input.id);
  await expect(field).toHaveValue('Input');
  const named = String(find(await tree(page), 'input')?.attributes.id ?? '');
  expect(named, 'the control got an ID').not.toBe('');
  expect(await exportedHtml(page)).toContain(`for="${named}"`);
  // the label follows a new ID of its control
  await control(page, ROW, { args: { target: input.id } }).click();
  await runDoor(page, SETTINGS);
  await typeInto(page, ID_FIELD, 'email-field');
  expect(await exportedHtml(page)).toContain('for="email-field"');
  // deleting the control says how many references go with it, and the export has no orphan for
  await control(page, ROW, { args: { target: input.id } }).click();
  await runDoor(page, 'element.delete#menu-edit');
  await expect(page.getByRole('status')).toContainText('references');
  expect(find(await tree(page), 'label')?.attributes.labelFor).toBeUndefined();
  expect(await exportedHtml(page)).not.toContain('for=');
  // one undo gives both back
  await runDoor(page, 'history.undo#toolbar-top-bar');
  await expect.poll(async () => find(await tree(page), 'label')?.attributes.labelFor).toBe(input.id);
});

test('a project file whose semantics are broken is refused with the reason', runs(OPEN, 'element.insert#elements-tile'), async ({ page }) => {
  const held = await page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document());
  // an input whose type is not an HTML input type, and a label pointing at nothing
  const broken = JSON.parse(JSON.stringify(held)) as { pages: { tree: { children: unknown[] } }[] };
  const root = broken.pages[0]?.tree;
  if (root === undefined) throw new Error('no page');
  root.children = [
    { id: 'a1', type: 'input', name: 'Input', tag: 'input', attributes: { inputType: 'potato' }, classes: [], styles: {}, text: null, children: [] },
    { id: 'a2', type: 'label', name: 'Label', tag: 'label', attributes: { labelFor: 'gone:01' }, classes: [], styles: {}, text: null, children: [] },
  ];
  // a plain id attribute the file carried ('button-24') is left alone; a reference that names no element is refused
  for (const [broken1, expected] of [[true, 'potato'], [false, 'names no element']] as const) {
    if (!broken1) delete (root.children[0] as { attributes: Record<string, unknown> }).attributes.inputType;
    await openMenu(page, 'file');
    const chooser = page.waitForEvent('filechooser');
    await page.locator(`[data-door="${OPEN}"]`).click();
    await (await chooser).setFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken), 'utf8') });
    await expect(page.getByRole('status')).toContainText(expected);
    // nothing was opened: the document is still the empty project
    expect(await page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { children: unknown[] } }[] } } }).__builderTestPort.document().pages[0]?.tree.children.length)).toBe(0);
  }});

// the journey "site": the picker stayed open after a page was chosen, the click on the next link of the menu only
// closed it, and the next choice rewrote the first link
const ADD_PAGE = 'pages.add#explorer-add-page';
const EXPLORER = 'workspace.setPanelOpen#toolbar-activity-bar-explorer';
const SWITCH = 'pages.switch#file-tab';
const named = (n: Node | undefined, name: string): Node | undefined => (n === undefined ? undefined : n.name === name ? n : n.children.map((c) => named(c, name)).find(Boolean));

test('a page chosen in the picker closes it, and the next link clicked gets its own page', runs(INSERT, TILE, EXPLORER, ADD_PAGE, SWITCH, ROW, SETTINGS, OPEN_PICKER, KIND('page'), PAGE_ITEM), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'template-navbar' } });
  await runDoor(page, EXPLORER);
  await runDoor(page, ADD_PAGE);
  await page.keyboard.press('Enter');
  await runDoor(page, SWITCH, { args: { page: (await tree(page)).id } });
  const first = named(await tree(page), 'Link 3');
  const second = named(await tree(page), 'Link 4');
  if (first === undefined || second === undefined) throw new Error('the navbar has no Link 3 and Link 4');
  await control(page, ROW, { args: { target: first.id } }).click();
  await runDoor(page, SETTINGS);
  await runDoor(page, OPEN_PICKER);
  await runDoor(page, KIND('page'));
  await runDoor(page, PAGE_ITEM, { args: { page: 'page.html' } });
  await expect(page.locator('[data-region="link-picker"]')).toHaveCount(0);
  // the next click selects the next link (no picker is left to take it), and its choice is its own
  await control(page, ROW, { args: { target: second.id } }).click();
  await runDoor(page, OPEN_PICKER);
  await runDoor(page, KIND('page'));
  await runDoor(page, PAGE_ITEM, { args: { page: 'index.html' } });
  await expect.poll(async () => [named(await tree(page), 'Link 3')?.attributes.href, named(await tree(page), 'Link 4')?.attributes.href]).toEqual(['page.html', 'index.html']);
});

// The picker opens on the kind the link already holds, says its value once, and closes from its head (the user's review
// of 2026-10-05, LR2: a link to planos.html opened on "A web address", its value written twice — once as a line, once
// in the field — and its close button at the picker's foot where every dialog has it at its head).
test('the picker opens on the kind the link holds, says its value once, and closes from its head', runs(INSERT, TILE, SETTINGS, OPEN_PICKER, KIND('page'), KIND('anchor'), KIND('url'), ANCHOR_ITEM, PAGE_ITEM, CLOSE), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'heading' } });
  await runDoor(page, SETTINGS);
  await typeInto(page, ID_FIELD, 'inicio');
  await runDoor(page, TILE, { args: { entry: 'link' } });
  await runDoor(page, SETTINGS);
  const link = find(await tree(page), 'link');
  const heading = find(await tree(page), 'heading');
  if (link === null || heading === null) throw new Error('the Link and the Heading are missing');
  const picker = page.locator('[data-region="link-picker"]');
  const current = (ref: string, args: Readonly<Record<string, unknown>> = {}) => control(page, ref, { args }).first();
  // a page chosen, the picker opened again: on the page kind, the page marked, the value said once
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await runDoor(page, KIND('page'));
  await runDoor(page, PAGE_ITEM, { args: { page: 'index.html' } });
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await expect(current(KIND('page'))).toHaveClass(/is-current/);
  await expect(current(PAGE_ITEM, { page: 'index.html' })).toHaveClass(/is-current/);
  await expect(picker.locator('[data-link-current]')).toHaveCount(0);
  // its close button at its head, above the kinds
  const close = await current(CLOSE).boundingBox();
  const kinds = await current(KIND('url')).boundingBox();
  expect((close?.y ?? 0) + (close?.height ?? 0)).toBeLessThanOrEqual(kinds?.y ?? 0);
  // another kind shown than the link holds: then the line says what it points at now
  await runDoor(page, KIND('url'));
  await expect(picker.locator('[data-link-current]')).toHaveText('index.html');
  // an element of the page chosen: the anchor kind, the element marked
  await runDoor(page, KIND('anchor'));
  await runDoor(page, ANCHOR_ITEM, { args: { anchor: heading.id } });
  await runDoor(page, OPEN_PICKER, { args: { target: link.id } });
  await expect(current(KIND('anchor'))).toHaveClass(/is-current/);
  await expect(current(ANCHOR_ITEM, { anchor: heading.id })).toHaveClass(/is-current/);
  await runDoor(page, CLOSE);
  await expect(picker).toHaveCount(0);
});
