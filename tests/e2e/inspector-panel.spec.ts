// inspector-panel beyond its scenarios (spec/BEHAVIOUR.md#inspector-panel): the hints with nothing selected and Page
// properties as the feature table says, the selector bar's icon, name and tag, the eight sections in their order, the
// summaries of collapsed sections read from the page, the section header's keys, the collapsed sections kept for
// another element and after a reload, the Settings and Style tabs, the text field (its Enter and Escape doors, the text
// area's own Shift+Enter, Tab, a click elsewhere, drawn for one text element only), Element actions › Hide, and the
// dock's tab. The document, the selection and the history
// are read through the read-only test port; the page through the frame; the editor's regions by their geometry.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { isFeatureBuilt } from '../../src/app/features.ts';
import { control, openEverySection, openMenu, runDoor, runs, setSectionOpen, openStyleControl } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const ALL = 'inspector.setMode#inspector-mode-all';
const OPEN = 'project.open#menu-file';
const SELECT = 'selection.select#canvas-click-element-or-page';
const ADD = 'selection.add#canvas-click-element-shift';
const ROW = 'selection.select#layers-row';
const SECTION = 'inspector.toggleSection#inspector-section-header';
const STYLE = 'workspace.setActiveTab#inspector-tab-style';
const SETTINGS = 'workspace.setActiveTab#inspector-tab-settings';
const INTERACTIONS = 'workspace.setActiveTab#inspector-tab-interactions';
const DOCK_TAB = 'workspace.setActiveTab#tab-strip-tab';
const DOCK_ICON = 'workspace.setPanelOpen#dock-strip-timeline';
const TEXT = 'text.set#inspector-text';
const ENTER = 'text.set#key-enter-in-element-text-field';
const ESCAPE = 'text.cancelEdit#key-escape-in-element-text-field';
const HIDE = 'element.toggleHidden#menu-element-actions';
const PAGE_PROPERTIES = 'page.openProperties#inspector-page-properties-button';
const INTRO = 'Fresh coffee, roasted every week.';

const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
const LAYOUT = JSON.parse(fs.readFileSync('manifest/layout.json', 'utf8')) as { panels: Record<string, { labelKey: string }> };
const ELEMENTS = JSON.parse(fs.readFileSync('manifest/elements.json', 'utf8')) as { elements: { id: string; icon: string }[] };
const PROPERTIES = JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')) as {
  sections: { id: string }[];
  properties: { id: string; section: string }[];
  composites: { id: string; section: string }[];
  recipes: { id: string; section: string }[];
};
const iconOf = (type: string) => ELEMENTS.elements.find((e) => e.id === type)?.icon ?? '';
const words = (key: string, params: Record<string, string> = {}) => (EN[key] ?? '').replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');

// the Style sections: those of properties.json with a field in the Style tab (an inspector field of one of their
// properties, composites or recipes placed in inspector-style), in the order of properties.json
const STYLE_FIELDS = new Set<string>();
for (const file of fs.readdirSync('manifest/commands')) {
  const { commands } = JSON.parse(fs.readFileSync(`manifest/commands/${file}`, 'utf8')) as {
    commands: { entryPoints: { kind: string; property?: string | null; composite?: string | null; recipe?: string | null; placement: { region: string } | string }[] }[];
  };
  for (const c of commands)
    for (const d of c.entryPoints) {
      const id = d.property ?? d.composite ?? d.recipe ?? null;
      if (d.kind === 'inspector-field' && id !== null && typeof d.placement === 'object' && d.placement.region === 'inspector-style') STYLE_FIELDS.add(id);
    }
}
const sectionOf = new Map([...PROPERTIES.properties, ...PROPERTIES.composites, ...PROPERTIES.recipes].map((p) => [p.id, p.section]));
const STYLE_SECTIONS = PROPERTIES.sections.map((s) => s.id).filter((s) => [...STYLE_FIELDS].some((id) => sectionOf.get(id) === s));

interface Tree {
  readonly id: string;
  readonly text: string | null;
  readonly hidden?: true;
  readonly children: readonly Tree[];
  readonly styles?: Record<string, Record<string, Record<string, unknown>>>;
}
const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document(), selection: p.selection(), undoSteps: p.history().undoSteps };
  });
function nodeIn(tree: Tree, id: string): Tree | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const found = nodeIn(c, id);
    if (found) return found;
  }
  return null;
}
const nodeOf = async (page: Page, id: string) => {
  const tree = (await port(page)).document.pages[0]?.tree;
  return tree ? nodeIn(tree, id) : null;
};
const textOf = async (page: Page, id: string) => (await nodeOf(page, id))?.text ?? null;
const drawn = (page: Page, id: string) => page.frameLocator('.frame__page').locator(`[data-node="${id}"]`);

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-door="${OPEN}"]`).click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
}

// a screen point of a node's element on the canvas: its centre (a leaf), or a point inside its top-left corner (the
// padding of a section, which its children do not cover)
function pointOf(page: Page, id: string, at: 'centre' | 'corner' = 'centre') {
  return page.evaluate(
    ([node, where]) => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
      if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
      const zoom = iframe.currentCSSZoom;
      const frame = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const [x, y] = where === 'centre' ? [r.left + r.width / 2, r.top + r.height / 2] : [r.left + 12, r.top + 12];
      return { x: frame.left + x * zoom, y: frame.top + y * zoom };
    },
    [id, at] as const,
  );
}
async function select(page: Page, id: string, at: 'centre' | 'corner' = 'centre') {
  const p = await pointOf(page, id, at);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await port(page)).selection).toEqual([id]);
}

const header = (page: Page, section: string) => control(page, SECTION, { args: { section } });
const topOf = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())?.y ?? Number.NaN;
// how far below the Space header the Size header sits: one header row while Space is collapsed, its fields below it
// while it is open
const spaceRoom = async (page: Page) => {
  const space = await header(page, 'space').boundingBox();
  const size = await header(page, 'size').boundingBox();
  return space && size ? size.y - space.y : Number.NaN;
};
const textField = (page: Page) => control(page, TEXT).locator('textarea');

// A3.24: the Style tab keeps one Tab stop per control — a segmented group (the four directions) and the alignment
// matrix rove, so Tab walks the fields and not every button; and the reset names the property it resets, which is what
// a screen reader reads.
test('Display to Wrap costs two Tab stops, and a reset names its property', runs(OPEN, ROW), async ({ page }) => {
  await openAurora(page);
  // the Hero's own padding: a section its children do not cover whole
  await select(page, 'n-hero', 'corner');
  const panel = page.locator('[data-region="inspector-style"]');
  // the whole panel drawn open: this test walks its Tab stops, which a collapsed section would hide
  await openEverySection(page);
  const display = panel.locator('[data-door="style.set#inspector-display"] input').first();
  // a flex container: Display, the direction group and Wrap are the section's first three controls (the group holds
  // one Tab stop, so the four arrows do not add three)
  await display.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('flex');
  await page.keyboard.press('Enter');
  await expect.poll(async () => panel.locator('[data-door="style.set#inspector-flex-wrap"]').count()).toBe(1);
  // the four arrows of the direction group hold one Tab stop between them, and the next stop after the group is Wrap
  const arrows = panel.locator('[data-door="style.set#inspector-flex-direction"]');
  await expect(arrows).toHaveCount(4);
  expect(await arrows.evaluateAll((els) => els.filter((el) => el.tabIndex >= 0).length), 'one arrow holds the stop').toBe(1);
  await arrows.first().focus();
  await page.keyboard.press('Tab');
  const after = await page.evaluate(() => (document.activeElement?.closest('[data-door]') as Element | null)?.getAttribute('data-door') ?? null);
  expect(after, `the next Tab after the direction group reaches Wrap`).toContain('flex-wrap');
  // a value set on Width makes its Reset appear, named with the property
  const width = panel.locator('[data-door="style.set#inspector-width"] input').first();
  await width.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('120\n');
  const reset = panel.locator(`[data-door="style.reset#inspector-property-reset"][data-args*='"property":"width"']`);
  await expect(reset).toHaveCount(1);
  await expect(reset).toHaveAttribute('aria-label', 'Reset Width');
});


// A property that acts on a layout the element is in (spec props-element-specific, "Our rule"): a card in block
// shows the Layout section's own controls and none of a flex or grid container's until flex is chosen, and a child's
// controls only while its parent lays out with flex or grid.
test('a card in block shows no flex or grid control until flex is chosen, and an item shows one only under a flex or grid parent', runs(OPEN, ROW), async ({ page }) => {
  await openAurora(page);
  // the card's own children cover it (a card of the fixture is about 20 px tall), so the title's parent is reached
  // with the keyboard walk from it
  await select(page, 'n-card-a-title');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-a']);
  const panel = page.locator('[data-region="inspector-style"]');
  const panelDoor = (ref: string) => panel.locator(`[data-door="${ref}"]`);
  // every section is drawn open: this test reads which controls a layout brings
  await openEverySection(page);
  await expect(panelDoor('style.set#inspector-display'), 'display applies always').toHaveCount(1);
  await expect(panelDoor('style.set#inspector-flex-direction'), 'no flex-direction on a block').toHaveCount(0);
  await expect(panelDoor('style.set#inspector-grid-template-columns'), 'no grid columns on a block').toHaveCount(0);
  await expect(panelDoor('style.set#inspector-flex-grow'), 'no flex-grow: the parent is a grid, the child is not a flex item').toHaveCount(0);
  // choosing flex brings the container's controls at once
  await panelDoor('style.set#inspector-display').locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('flex');
  await page.keyboard.press('Enter');
  // the page computes it before the panel is read (the context is what the page computes)
  await expect.poll(async () => drawn(page, 'n-card-a').evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  await expect.poll(async () => (await port(page)).selection, 'the write leaves the selection').toEqual(['n-card-a']);
  await expect(panelDoor('style.set#inspector-flex-direction').first(), 'a flex container: the direction arrows').toBeVisible();
  // justify-content stands in the details of Alignment (spec inspector-panel, item 4a)
  await openStyleControl(page, 'style.set#inspector-justify-content');
  await expect(panelDoor('style.set#inspector-justify-content').first()).toBeVisible();
  await expect(panelDoor('style.set#inspector-grid-template-columns'), 'still no grid').toHaveCount(0);
  // the card's parent (named Grid in the fixture, but laid out as a block until grid is chosen): choosing grid there
  // brings the grid container's controls, and its child's own grid controls with them
  await runDoor(page, ROW, { args: { target: 'n-grid' } });
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-grid']);
  await expect(panelDoor('style.set#inspector-grid-template-columns'), 'the fixture lays the Grid out as a block').toHaveCount(0);
  await panelDoor('style.set#inspector-display').locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('grid');
  await page.keyboard.press('Enter');
  await expect.poll(async () => drawn(page, 'n-grid').evaluate((el) => getComputedStyle(el).display)).toBe('grid');
  // the raw track list stands in the details of Grid columns (spec inspector-panel, item 4a)
  await openStyleControl(page, 'style.set#inspector-grid-template-columns');
  await expect(panelDoor('style.set#inspector-grid-template-columns').first(), 'a grid container').toBeVisible();
  await expect(panelDoor('style.set#inspector-flex-direction'), 'a grid is no flex container').toHaveCount(0);
  // and one of its cards, selected through its row, shows the grid item's controls
  await runDoor(page, ROW, { args: { target: 'n-card-a' } });
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-a']);
  // a grid item's column stands in the details of Item
  await openStyleControl(page, 'style.set#inspector-grid-column');
  await expect(panelDoor('style.set#inspector-grid-column').first(), 'a card inside the grid: its column').toBeVisible();
  await expect(panelDoor('style.set#inspector-flex-grow'), 'not a flex item: the parent is a grid').toHaveCount(0);
  // the card itself is a flex container (the first choice above), never a grid one
  await expect(panelDoor('style.set#inspector-flex-direction').first()).toBeVisible();
  await expect(panelDoor('style.set#inspector-grid-template-columns'), 'a flex container is no grid').toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
});

test('with nothing selected the Style tab gives the hints first; Page properties waits as the feature table says', runs(OPEN, SELECT), async ({ page }) => {
  await openAurora(page);
  const hints = page.locator('[data-region="inspector-style"] .inspector-hints li');
  const panel = words(LAYOUT.panels.elements?.labelKey ?? '');
  await expect(hints).toHaveText([words('inspector.hint.insert', { panel }), words('inspector.hint.select'), words('inspector.hint.editText')]);
  await expect(page.locator('.selector-bar__element')).toHaveText(EN['inspector.nothingSelected'] ?? '');
  const pageProperties = page.locator(`[data-door="${PAGE_PROPERTIES}"]`);
  if (isFeatureBuilt('page-properties')) await expect(pageProperties).not.toHaveAttribute('aria-disabled', 'true');
  else {
    await expect(pageProperties).toHaveAttribute('aria-disabled', 'true');
    await expect(pageProperties).toHaveAttribute('title', new RegExp(EN['common.notAvailableYet'] ?? 'not available yet'));
  }
  await select(page, 'n-intro');
  await expect(hints).toHaveCount(0);
});

test("the selector bar shows the icon of the element's type, its name and its exported tag", runs(OPEN, SELECT, ROW), async ({ page }) => {
  await openAurora(page);
  const bar = page.locator('.selector-bar__element');
  await select(page, 'n-intro');
  await expect(bar.locator('use')).toHaveAttribute('href', `#${iconOf('paragraph')}`);
  await expect(bar.locator('.selector-bar__name')).toHaveText('Intro');
  await expect(bar.locator('.selector-bar__tag')).toHaveText('p');
  await select(page, 'n-hero', 'corner');
  await expect(bar.locator('use')).toHaveAttribute('href', `#${iconOf('section')}`);
  await expect(bar.locator('.selector-bar__tag')).toHaveText('section');
  await runDoor(page, ROW, { args: { target: 'n-page' } });
  await expect(bar.locator('use')).toHaveAttribute('href', `#${iconOf('page')}`);
  await expect(bar.locator('.selector-bar__name')).toHaveText('Page');
  await expect(bar.locator('.selector-bar__tag')).toHaveText('body');
});

test('the Style tab draws the sections that hold style fields, in the order of properties.json, for every element', runs(OPEN, SELECT), async ({ page }) => {
  // the manifest's own count: layout, space, size, position, text, paint, border, effects and the advanced section's
  // fields (break-before, containment, the counters) — nine
  expect(STYLE_SECTIONS).toHaveLength(9);
  await openAurora(page);
  const order = () => page.locator(`[data-door="${SECTION}"]`).evaluateAll((els) => els.map((el) => (JSON.parse(el.getAttribute('data-args') ?? '{}') as { section?: string }).section));
  await select(page, 'n-intro');
  expect(await order()).toEqual(STYLE_SECTIONS);
  await select(page, 'n-hero', 'corner');
  expect(await order()).toEqual(STYLE_SECTIONS);
});

test('a collapsed section summarises the values the page computes; an open one shows its fields instead', runs(OPEN, SELECT, SECTION), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-hero', 'corner');
  // the Hero holds its padding, so the Space section is drawn open by itself; every section is pressed until it reads
  // collapsed (a section the element holds nothing in already is: the user's real-use audit, item 5.1)
  for (const s of STYLE_SECTIONS) await setSectionOpen(page, s, false);
  const summary = (s: string) => header(page, s).locator('.inspector-section__summary');
  const none = EN['inspector.summary.none'] ?? '';
  // the fixture gives the Hero a padding of 56px 40px; everything else is the browser's default for a section
  await expect(summary('space')).toHaveText('P 56px 40px');
  await expect(summary('position')).toHaveText('static · z auto');
  await expect(summary('size')).toHaveText('auto × auto');
  await expect(summary('layout')).toHaveText('block');
  await expect(summary('paint')).toHaveText(none);
  await expect(summary('border')).toHaveText(none);
  await expect(summary('text')).toHaveText('16px · 400');
  await expect(summary('effects')).toHaveText(none);
  // a paragraph carries the project's base style: margin 0 0 1rem (core/render/base.ts, spec base-style), so the page
  // computes 0 in top, 16px at the bottom — the summary says exactly that
  await select(page, 'n-intro');
  await expect(summary('space')).toHaveText('M 0px 0px 16px');
  await runDoor(page, SECTION, { args: { section: 'space' } });
  await expect(summary('space')).toHaveCount(0);
});

test('Enter or Space on a focused section header collapses and expands it, and the focus stays on it', runs(OPEN, SELECT, SECTION), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  // A paragraph holds no border, and Border carries no essential, so its section is drawn collapsed; the press on
  // its header opens it and leaves the focus on it, and Enter then collapses it, Space expands it again. (The
  // sections that carry the essentials — Space among them — are the ones drawn open, the user's correction.)
  await expect(header(page, 'border')).toHaveAttribute('aria-expanded', 'false');
  await header(page, 'border').click();
  await expect(header(page, 'border')).toHaveAttribute('aria-expanded', 'true');
  await expect(header(page, 'border')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(header(page, 'border')).toHaveAttribute('aria-expanded', 'false');
  await expect(header(page, 'border')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(header(page, 'border')).toHaveAttribute('aria-expanded', 'true');
  await expect(header(page, 'border')).toBeFocused();
});

test('a collapsed section stays collapsed for another element and after an immediate reload', runs(OPEN, SELECT, SECTION), async ({ page }) => {
  await openAurora(page);
  // the Hero holds its padding, so its Space section is drawn open and the press closes it for this user
  await select(page, 'n-hero', 'corner');
  await expect.poll(() => spaceRoom(page)).toBeGreaterThan(100);
  await setSectionOpen(page, 'space', false);
  await expect.poll(() => spaceRoom(page)).toBeLessThan(48);
  // another element that holds nothing, and then the Hero again: what the user closed stays closed, although the
  // value in it would open the section by itself
  await select(page, 'n-intro');
  await expect.poll(() => spaceRoom(page)).toBeLessThan(48);
  await select(page, 'n-hero', 'corner');
  await expect.poll(() => spaceRoom(page)).toBeLessThan(48);
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  // the work and its selection come back (autosave-restore), and so does the collapsed section
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-hero']);
  await expect.poll(() => spaceRoom(page)).toBeLessThan(48);
});

test('the Settings tab shows its region under the header, and the Style tab brings back the selector bar', runs(OPEN, SELECT, SETTINGS, STYLE), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  const interactions = page.locator(`[data-door="${INTERACTIONS}"]`);
  // the Interactions tab waits for its feature
  if (!isFeatureBuilt('events-actions')) await expect(interactions).toHaveAttribute('aria-disabled', 'true');
  await runDoor(page, SETTINGS);
  await expect(page.locator(`[data-door="${SETTINGS}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-region="inspector-settings"]')).toBeVisible();
  await expect(page.locator('[data-region="inspector-selector-bar"]')).toHaveCount(0);
  await expect(page.locator('[data-region="inspector-style"]')).toHaveCount(0);
  expect(await topOf(page, '[data-region="inspector-settings"]')).toBeLessThan((await topOf(page, '[data-region="inspector-header"]')) + 48);
  await runDoor(page, STYLE);
  await expect(page.locator(`[data-door="${STYLE}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-region="inspector-settings"]')).toHaveCount(0);
  expect(await topOf(page, '[data-region="inspector-style"]')).toBeGreaterThan(await topOf(page, '[data-region="inspector-selector-bar"]'));
});

test('the text field keeps the typed text with Enter, as one undo step, and the canvas draws it', runs(OPEN, SELECT, SETTINGS, TEXT, ENTER), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, SETTINGS);
  await expect(textField(page)).toHaveValue(INTRO);
  await textField(page).click();
  await page.keyboard.press('Control+A');
  // the letters of canvas keys (P, R, C, M) type into the field, never onto the tree
  await page.keyboard.type('Pour-over coffee, prepared every morning.');
  expect(await textOf(page, 'n-intro')).toBe(INTRO);
  await page.keyboard.press('Enter');
  await expect.poll(() => textOf(page, 'n-intro')).toBe('Pour-over coffee, prepared every morning.');
  await expect(drawn(page, 'n-intro')).toHaveText('Pour-over coffee, prepared every morning.');
  await expect(textField(page)).toHaveValue('Pour-over coffee, prepared every morning.');
  const after = await port(page);
  expect(after.undoSteps).toBe(1);
  expect(after.selection).toEqual(['n-intro']);
  expect(nodeIn(after.document.pages[0]?.tree ?? { id: '', text: null, children: [] }, 'n-hero')?.children.map((c) => c.id)).toEqual(['n-title', 'n-intro', 'n-actions']);
  await expect(page.getByRole('status')).toHaveText(words('status.textEdit.committed', { name: 'Intro' }));
});

test('Escape puts the text field back to the text the document holds, and leaving it then keeps nothing', runs(OPEN, SELECT, SETTINGS, TEXT, ESCAPE), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, SETTINGS);
  await textField(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Something else entirely');
  await page.keyboard.press('Escape');
  await expect(textField(page)).toHaveValue(INTRO);
  await expect(textField(page)).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(words('status.textEdit.cancelled', { name: 'Intro' }));
  // leaving the field now keeps nothing: Escape left no typing behind
  await page.keyboard.press('Tab');
  await expect(textField(page)).not.toBeFocused();
  expect(await textOf(page, 'n-intro')).toBe(INTRO);
  expect((await port(page)).undoSteps).toBe(0);
});

test('Shift+Enter types a line break in the text field, and Enter keeps it as "\\n", drawn as a line break', runs(OPEN, SELECT, SETTINGS, TEXT, ENTER), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, SETTINGS);
  await textField(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('One');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Two');
  // the line break is the field's own: nothing is kept yet
  await expect(textField(page)).toHaveValue('One\nTwo');
  expect(await textOf(page, 'n-intro')).toBe(INTRO);
  await page.keyboard.press('Enter');
  await expect.poll(() => textOf(page, 'n-intro')).toBe('One\nTwo');
  await expect(drawn(page, 'n-intro').locator('br')).toHaveCount(1);
  await expect(textField(page)).toHaveValue('One\nTwo');
  expect((await port(page)).undoSteps).toBe(1);
});

test('leaving the text field with Tab keeps the typed text', runs(OPEN, SELECT, SETTINGS, TEXT), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, SETTINGS);
  await textField(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hello');
  expect(await textOf(page, 'n-intro')).toBe(INTRO);
  await page.keyboard.press('Tab');
  await expect.poll(() => textOf(page, 'n-intro')).toBe('Hello');
  await expect(textField(page)).not.toBeFocused();
  expect((await port(page)).undoSteps).toBe(1);
});

test('a click on another element keeps the typed text for the element it was typed for', runs(OPEN, SELECT, SETTINGS, TEXT), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, SETTINGS);
  await textField(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hi there');
  await select(page, 'n-title');
  await expect.poll(() => textOf(page, 'n-intro')).toBe('Hi there');
  expect(await textOf(page, 'n-title')).toBe('Welcome to Aurora');
  await expect(textField(page)).toHaveValue('Welcome to Aurora');
});

test('the text field is drawn for one selected text element only', runs(OPEN, SELECT, ADD, SETTINGS), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-hero', 'corner');
  await runDoor(page, SETTINGS);
  await expect(page.locator('[data-region="inspector-settings"]')).toBeVisible();
  await expect(control(page, TEXT)).toHaveCount(0);
  await select(page, 'n-intro');
  await expect(textField(page)).toHaveValue(INTRO);
  const title = await pointOf(page, 'n-title');
  await page.keyboard.down('Shift');
  await page.mouse.click(title.x, title.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-intro', 'n-title']);
  await expect(control(page, TEXT)).toHaveCount(0);
  await expect(page.locator('[data-region="inspector-settings"]')).toHaveText(words('canvas.selectedCount', { count: '2' }));
});

test('Element actions › Hide hides the selected element on the canvas, as one undo step', runs(OPEN, SELECT, HIDE), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-intro');
  await runDoor(page, HIDE);
  await expect.poll(async () => (await nodeOf(page, 'n-intro'))?.hidden ?? false).toBe(true);
  await expect.poll(() => drawn(page, 'n-intro').evaluate((el) => getComputedStyle(el).display)).toBe('none');
  expect((await port(page)).undoSteps).toBe(1);
  await expect(page.getByRole('status')).toHaveText(words('status.hidden', { name: 'Intro' }));
});

test('the Timeline tab of the closed strip opens the collapsed dock on its panel, where the tab then switches it', runs(DOCK_ICON, DOCK_TAB), async ({ page }) => {
  // the dock's own body: the sidebar's panel area draws a tabpanel of its own (the workspace panels), so the
  // collapsed dock is measured by what it draws
  await expect(page.locator('.dock-body')).toHaveCount(0);
  // a collapsed dock's strip draws the doors that open it on a panel, not the open dock's tabs
  await expect(control(page, DOCK_TAB, { args: { panel: 'timeline' } })).toHaveCount(0);
  await runDoor(page, DOCK_ICON, { args: { panel: 'timeline' } });
  const panel = page.locator('.dock-body');
  await expect(panel).toHaveAttribute('aria-label', words(LAYOUT.panels.timeline?.labelKey ?? ''));
  const tab = control(page, DOCK_TAB, { args: { panel: 'timeline' } });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  // the Timeline itself, beyond the panel's name (the audit's AUD-35): its animations and track, laid out in the dock
  const timeline = page.locator('[data-region="dock-timeline"]');
  await expect(timeline).toBeVisible();
  expect((await timeline.boundingBox())?.height ?? 0, 'the Timeline has room in the opened dock').toBeGreaterThan(40);
  // and the strip's own tab reaches the same panel while the dock is open
  await runDoor(page, DOCK_TAB, { args: { panel: 'timeline' } });
  await expect(panel).toHaveAttribute('aria-label', words(LAYOUT.panels.timeline?.labelKey ?? ''));
  await expect(timeline).toBeVisible();
});

// A3.30: a field's slider writes what the pointer releases on — nothing while it is held, one undo step on release —
// and the ready values the manifest declares are offered beside the generated ones.
test('the opacity slider writes what the pointer releases on, in one undo step', runs(OPEN, ROW, 'style.set#inspector-opacity'), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, ROW, { args: { target: 'n-hero' } });
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-hero']);
  await setSectionOpen(page, 'effects', true);
  const row = page.locator('[data-door="style.set#inspector-opacity"]').first();
  await row.scrollIntoViewIfNeeded();
  const slider = row.locator('.field__slider');
  await expect(slider, 'the field draws its slider').toHaveCount(1);
  const box = await slider.boundingBox();
  if (box === null) throw new Error('the slider is not laid out');
  const opacity = async () => (await nodeOf(page, 'n-hero'))?.styles?.desktop?.base?.opacity ?? null;
  const before = await opacity();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
  const held = await slider.inputValue();
  expect(held, 'the pointer moved the thumb off the value the field held').not.toBe('1');
  expect(await opacity(), 'nothing is written while the pointer is held').toBe(before);
  await page.mouse.up();
  await expect.poll(async () => opacity(), 'the release wrote it').not.toBe(before);
  expect(Number(await opacity()), 'the value the pointer was left on').toBeCloseTo(Number(held), 2);
  expect((await port(page)).undoSteps, 'one drag, one undo step').toBe(1);
  await expect(page.getByRole('status')).toHaveText(words('status.style.set', { property: 'Opacity', name: 'Hero', value: held }));
});

// A3.30: the Aspect ratio field offers the ratios properties.json declares as its presets, and writes what it offers.
test('Aspect ratio offers the ratio presets and writes the one chosen', runs(OPEN, ROW, 'style.set#inspector-aspect-ratio'), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, ROW, { args: { target: 'n-card-a' } });
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-a']);
  await setSectionOpen(page, 'size', true);
  const field = page.locator('[data-door="style.set#inspector-aspect-ratio"] input').first();
  await field.scrollIntoViewIfNeeded();
  const listId = await field.getAttribute('list');
  expect(listId, 'the field suggests a list').not.toBeNull();
  const offered = await page.locator(`datalist#${String(listId)} option`).evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  for (const ratio of ['16 / 9', '4 / 3', '3 / 2', '1 / 1']) expect(offered, `${ratio} is offered`).toContain(ratio);
  await field.click();
  await page.keyboard.type('4 / 3\n');
  await expect.poll(async () => (await nodeOf(page, 'n-card-a'))?.styles?.desktop?.base?.['aspect-ratio'] ?? null).toBe('4 / 3');
  await expect.poll(() => drawn(page, 'n-card-a').evaluate((el) => getComputedStyle(el).aspectRatio)).toBe('4 / 3');
});

// A3.33 and 5.2: a unit menu offers a short list — the units a person reaches for — with the rest of the units and the
// property's keywords behind "More units"; and a field of a fixed list of values (Display) opens every value at once,
// so a value typed into the field never hides the others.
test('the unit menu keeps its list short, and a value field opens every value', runs(OPEN, ROW, ALL, 'field.setUnit#inspector-unit-menu', 'style.set#inspector-display'), async ({ page }) => {
  // a heading: font size, display and font weight all apply to it and it has a size whose unit can change
  await openAurora(page);
  await runDoor(page, ROW, { args: { target: 'n-card-a-title' } });
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-a-title']);
  await runDoor(page, ALL);
  await setSectionOpen(page, 'text', true);
  await setSectionOpen(page, 'layout', true);
  // Font size: a value first (the unit menu converts what the field holds), then at most ten items before "More units"
  const size = page.locator('[data-door="style.set#inspector-font-size"]').first();
  await size.scrollIntoViewIfNeeded();
  const sizeInput = size.locator('input').first();
  if (await sizeInput.isDisabled()) throw new Error('the font size field is disabled: ' + String(await size.getAttribute('title')) + ' | selection ' + JSON.stringify((await port(page)).selection));
  await sizeInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('18px\n');
  await size.locator('.field__unit-button').click();
  const menu = page.locator('.field__menu[role="menu"]').first();
  await expect(menu).toBeVisible();
  const before = await menu.locator('[role="menuitemradio"]').count();
  expect(before, 'Font size shows at most ten units before More units').toBeLessThanOrEqual(10);
  await expect(menu.locator('[data-menu-more]')).toHaveCount(1);
  await menu.locator('[data-menu-more]').click();
  expect(await menu.locator('[role="menuitemradio"]').count(), 'More units reveals the rest').toBeGreaterThan(before);
  await page.keyboard.press('Escape');
  // Display: the open button lists every value the field offers, whatever the field holds
  const display = page.locator('[data-door="style.set#inspector-display"]').first();
  await display.scrollIntoViewIfNeeded();
  const input = display.locator('input').first();
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('block');
  await display.locator('.field__values-button').click();
  const values = page.locator('.field__menu[role="menu"]').last();
  await expect(values).toBeVisible();
  const shown = await values.locator('[role="menuitemradio"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  expect(shown, 'every value is offered while the field holds one').toContain('flex');
  expect(shown).toContain('flex');
  // the door's essentials come first, the rest behind More values (the audit's S-027: 22 raw keywords at once); the
  // value the page computes is checked
  expect(shown, 'the essentials alone before More values').not.toContain('table-cell');
  await expect(values.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveText('block');
  await values.locator('[data-menu-more]').click();
  await expect(values.locator('[role="menuitemradio"]', { hasText: 'table-cell' })).toHaveCount(1);
  await values.locator('[role="menuitemradio"]', { hasText: 'flex' }).first().click();
  await expect.poll(async () => (await nodeOf(page, 'n-card-a-title'))?.styles?.desktop?.base?.['display'] ?? null).toBe('flex');
  // Font weight names its values
  const weight = page.locator('[data-door="style.set#inspector-font-weight"]').first();
  await weight.scrollIntoViewIfNeeded();
  await weight.locator('.field__values-button').click();
  const weights = await page.locator('.field__menu[role="menu"]').last().locator('[role="menuitemradio"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  expect(weights, 'the weights read with their names').toContain('Bold 700');
  await page.keyboard.press('Escape');
});

// The mode switch holds its two segments, Essentials only and All properties, inside the panel: a segmented control a
// section draws (the anchor control of Position) is never drawn there too (the audit's S-001: a clipped third
// segment that threw when pressed).
test('the mode switch holds exactly its two segments, within the panel', runs(OPEN, SELECT, ALL), async ({ page }) => {
  await openAurora(page);
  await select(page, 'n-title');
  const mode = page.locator('.inspector-mode');
  await expect(mode.locator('[data-door]')).toHaveCount(2);
  expect(await mode.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// Keyword buttons never wrap (spec props-position, Problems in Pager 3; the audit's S-015): Position's five words do not
// fit the value column, so it is a keyword menu — its value on a button, the values in the list it opens — while the
// buttons drawn as icons (Text align) stay buttons on one line.
test('Position is a keyword menu when its words do not fit, and choosing an item sets the mode', runs(OPEN, ROW, SECTION, 'position.setMode#inspector-position'), async ({ page }) => {
  await openAurora(page);
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await openEverySection(page);
  const POSITION = 'position.setMode#inspector-position';
  const opener = page.locator(`[data-door="${POSITION}"][aria-haspopup="menu"]`);
  await expect(opener).toHaveCount(1);
  await expect(opener).toHaveText('static');
  await expect(control(page, POSITION, { args: { mode: 'absolute' } })).toHaveCount(0);
  // one line: the row is as tall as its neighbours
  const row = opener.locator('xpath=ancestor::div[contains(@class,"field-row")][1]');
  expect((await row.boundingBox())?.height ?? 0).toBeLessThan(32);
  await opener.click();
  const items = page.locator(`[role="menuitemradio"][data-door="${POSITION}"]`);
  await expect(items).toHaveCount(5);
  await expect(page.locator(`[role="menuitemradio"][data-door="${POSITION}"][aria-checked="true"]`)).toHaveCount(0);
  await control(page, POSITION, { args: { mode: 'absolute' } }).click();
  await expect(items).toHaveCount(0);
  await expect(opener).toHaveText('absolute');
  await expect(opener).toBeFocused();
  // the icon buttons fit and stay buttons
  await expect(page.locator('[data-door="style.set#inspector-text-align"][aria-pressed]')).not.toHaveCount(0);
});

// An empty shadow editor is one row (spec shadow-editor, Problems in Pager 5; the audit's S-025): its list's name,
// "No shadow yet." and the + at its end; Remove every shadow is drawn once there is a shadow to remove.
test('an empty shadow editor is one row, and Remove every shadow comes with the first shadow', runs(OPEN, ROW, SECTION, 'style.setShadows#inspector-box-shadow-shadow-add', 'style.setShadows#inspector-box-shadow-shadow-reset'), async ({ page }) => {
  await openAurora(page);
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  const ADD_SHADOW = 'style.setShadows#inspector-box-shadow-shadow-add';
  const RESET_SHADOWS = 'style.setShadows#inspector-box-shadow-shadow-reset';
  await openStyleControl(page, ADD_SHADOW);
  const add = control(page, ADD_SHADOW);
  await expect(add).toHaveAttribute('aria-label', 'Add a shadow to Box shadow');
  const head = add.locator('xpath=ancestor::div[contains(@class,"field-row")][1]');
  // its name: the list's (Layers), the row it stands in naming the property (the user's review of 2026-10-05)
  await expect(head).toContainText('Layers');
  await expect(head).toContainText('No shadow yet.');
  expect((await head.boundingBox())?.height ?? 0).toBeLessThan(32);
  await expect(control(page, RESET_SHADOWS)).toHaveCount(0);
  await add.click();
  await expect(head).not.toContainText('No shadow yet.');
  await expect(control(page, RESET_SHADOWS)).toHaveCount(1);
});

// A filter function the element does not hold slides from its identity (spec props-filters-clip, Problems in Pager 4; the
// audit's S-024: the eight sliders stayed disabled until a value existed): Brightness sits at 100 and a drag writes it.
test('a filter slider with no value sits at its neutral and a drag writes the function', runs(OPEN, ROW, SECTION, 'style.setFilter#inspector-filter-filter-brightness'), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, ROW, { args: { target: 'n-hero' } });
  const BRIGHTNESS = 'style.setFilter#inspector-filter-filter-brightness';
  await openStyleControl(page, BRIGHTNESS);
  const slider = control(page, BRIGHTNESS).first().locator('.field__slider');
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveValue('100');
  const box = await slider.boundingBox();
  if (box === null) throw new Error('the slider is not laid out');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
  const held = await slider.inputValue();
  await page.mouse.up();
  await expect.poll(async () => String((await nodeOf(page, 'n-hero'))?.styles?.desktop?.base?.filter ?? '')).toBe(`brightness(${held}%)`);
});
