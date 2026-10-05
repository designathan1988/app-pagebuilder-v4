// The Style tab's organisation (the user's real-use audit, item 5.1): the pair rows of properties.json (two fields
// read together under the first one's label), the groups of a section drawn as titles from properties.json, and the
// opening rule — a section the selected element holds no value in is drawn collapsed with its header summarising what
// is in force, and a value set in it opens it again. Read on the geometry Chrome lays out and on the document the
// read-only test port returns; the panel's own data (rows, groups) comes from properties.json.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, runDoor, runs, setSectionOpen } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SECTION = 'inspector.toggleSection#inspector-section-header';
const WIDTH = 'style.set#inspector-width';
const HEIGHT = 'style.set#inspector-height';
const LETTER_SPACING = 'style.set#inspector-letter-spacing';
const ESSENTIALS = 'inspector.setMode#inspector-mode-essentials';
const ALL = 'inspector.setMode#inspector-mode-all';
const POSITION = 'position.setMode#inspector-position';

const PROPERTIES = JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')) as {
  sections: { id: string; groups: { id: string }[] }[];
  rows: { id: string; section: string; labelKey: string | null; fields: { target: string; prefixKey: string | null }[] }[];
  properties: { id: string; section: string; group: string }[];
  composites: { id: string; section: string; group: string }[];
};
const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;

const panel = (page: Page) => page.locator('[data-region="inspector-style"]');
const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).boundingBox();
  if (found === null) throw new Error(`${selector} is not laid out`);
  return found;
};

interface Node {
  readonly id: string;
  readonly styles?: Record<string, Record<string, Record<string, string>>>;
  readonly children: readonly Node[];
}
// the styles the document holds for one node, at the base breakpoint and state
const stylesOf = async (page: Page, id: string): Promise<Record<string, string>> => {
  const tree = await page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document().pages[0]?.tree);
  const find = (n: Node): Node | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  const node = tree === undefined ? undefined : find(tree);
  return node?.styles?.desktop?.base ?? {};
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a"]')).toHaveCount(1);
});

test('two fields read together share one row, under the row’s label, each named and keeping its own door', runs(OPEN, ROW, SECTION, WIDTH, HEIGHT), async ({ page }) => {
  const pair = PROPERTIES.rows.find((r) => r.fields.some((f) => f.target === 'width'));
  expect(pair, 'properties.json declares the width|height row').toBeDefined();
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  await openEverySection(page);
  const row = panel(page).locator(`[data-pair="${pair?.id ?? ''}"]`);
  await expect(row, 'the pair is one row').toHaveCount(1);
  // both fields are drawn, each its own door, side by side or, while the panel is too narrow for two whole cells
  // (304 px of inspector against the ~310 px they need), one under the other in the same value column
  const width = row.locator(`[data-door="${WIDTH}"]`);
  const height = row.locator(`[data-door="${HEIGHT}"]`);
  await expect(width).toHaveCount(1);
  await expect(height).toHaveCount(1);
  const first = await box(page, `[data-pair="${pair?.id ?? ''}"] [data-door="${WIDTH}"]`);
  const second = await box(page, `[data-pair="${pair?.id ?? ''}"] [data-door="${HEIGHT}"]`);
  // the two fields share one line, side by side in their own columns (the design's pair row: the panel never stacks a
  // pair, which is what it did while the fields carried steppers and a unit menu of their own at every width)
  expect(Math.round(first.y), 'both fields on one line').toBe(Math.round(second.y));
  expect(first.x, 'the height field in its own column, after the width').toBeLessThan(second.x);
  // the row carries one label, the concept's (Size), and each field says which it is by its own short name, W and H as
  // in the quick panel (the user's review of 2026-10-05: "Width" beside "H" read as two conventions)
  const labels = await row.locator('.field-row__label').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
  expect(labels).toEqual([EN[pair?.labelKey ?? 'property.width']]);
  for (const [field, index] of [[width, 0], [height, 1]] as const) {
    const prefix = pair?.fields[index]?.prefixKey ?? null;
    await expect(field.locator('.field__prefix'), 'each field carries its short name').toHaveText(prefix === null ? '' : (EN[prefix] ?? ''));
  }
  // each field writes its own property
  await width.locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('120\n');
  await expect.poll(async () => (await stylesOf(page, 'n-card-a'))['width'] ?? null).toBe('120px');
  await height.locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('80\n');
  await expect.poll(async () => (await stylesOf(page, 'n-card-a'))['height'] ?? null).toBe('80px');
});

test('a section orders its fields by the groups properties.json declares, and draws no title of its own', runs(OPEN, ROW, SECTION), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  await openEverySection(page);
  // the panel draws no group title: the design runs Display, Direction, Alignment, Gap without a heading between them,
  // and the groups are the order the fields are drawn in (inspector/rows.ts orderByGroup)
  await expect(panel(page).locator('.inspector-group')).toHaveCount(0);
  const doorsOf = (section: string) =>
    panel(page)
      .locator(`.inspector-section[data-section="${section}"] .field-row, .inspector-section[data-section="${section}"] [data-pair]`)
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-door') ?? el.querySelector('[data-door]')?.getAttribute('data-door') ?? el.getAttribute('data-pair') ?? ''));
  // the layout of a card in block: its display group's field first, its columns group's later, and no flex control
  // (the page computes no flex layout for it)
  const layout = await doorsOf('layout');
  const index = (ref: string) => layout.findIndex((door) => door === ref);
  expect(index('style.set#inspector-display'), 'the display field is drawn first').toBe(0);
  expect(index('style.set#inspector-column-span'), 'the columns fields follow it').toBeGreaterThan(0);
  expect(layout.join(' '), 'no flex control on a block').not.toContain('flex-direction');
});

test('a section with no essential and no value is drawn collapsed, a value set in it opens it again', runs(OPEN, ROW, SECTION, LETTER_SPACING), async ({ page }) => {
  // Intro holds no style of its own: a section that carries no essential property is drawn collapsed, its header
  // saying what is in force; the sections that carry the essentials stay open (the user's correction, 2026-09-28)
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  const header = (section: string) => control(page, SECTION, { args: { section } }).first();
  await expect(header('border')).toHaveAttribute('aria-expanded', 'false');
  await expect(header('border').locator('.inspector-section__summary')).toHaveText('None');
  await expect(header('advanced')).toHaveAttribute('aria-expanded', 'false');
  // and the sections that carry the essentials are open, so the panel shows something to edit
  await expect(header('text')).toHaveAttribute('aria-expanded', 'true');
  await expect(header('space')).toHaveAttribute('aria-expanded', 'true');
  // a field of a collapsed section is not drawn; the open Text section draws its own, and writing one keeps it open
  await expect(panel(page).locator('[data-door="style.set#inspector-border-top-width"]'), 'no field of the collapsed Border section').toHaveCount(0);
  const field = panel(page).locator(`[data-door="${LETTER_SPACING}"] input`).first();
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2px\n');
  // another element, then back: the value keeps the section open
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await expect(header('text')).toHaveAttribute('aria-expanded', 'true');
});

test('the grid’s track editor is drawn in the Layout section of the property it writes', runs(OPEN, ROW, 'style.set#inspector-display'), async ({ page }) => {
  // the fixture's Grid laid out as a grid: the Layout section opens by itself (display holds a value) and the
  // tracks the property writes are drawn in it
  await control(page, ROW, { args: { target: 'n-grid' } }).click();
  await setSectionOpen(page, 'layout', true);
  const display = panel(page).locator('[data-door="style.set#inspector-display"] input').first();
  await display.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('grid\n');
  await expect.poll(async () => (await stylesOf(page, 'n-grid'))['display'] ?? null).toBe('grid');
  const layout = page.locator('.inspector-section[aria-label="Layout"]');
  await expect(layout, 'the Layout section is drawn open').toHaveCount(1);
  await expect(control(page, SECTION, { args: { section: 'layout' } }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(layout.locator('[data-door="style.setGridTracks#inspector-grid-template-columns-add-track"]'), 'Add a column is drawn').toHaveCount(1);
  await expect(layout.locator('[data-door="style.setGridTracks#inspector-grid-template-columns-track"]').first(), 'the first track field is drawn').toHaveCount(1);
});

test('the gradient editor draws its controls only while the value holds a gradient', runs(OPEN, ROW, 'style.setBackgroundImage#inspector-background-image-gradient-add'), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  await setSectionOpen(page, 'paint', true);
  const paint = page.locator('.inspector-section[data-section="paint"]');
  const ADD = 'style.setBackgroundImage#inspector-background-image-gradient-add';
  const controls = ['gradient-type', 'gradient-bar', 'gradient-stop-colour', 'gradient-stop-position', 'gradient-angle', 'gradient-reverse', 'gradient-distribute', 'gradient-add-stop', 'gradient-remove-stop', 'gradient-reset'];
  const drawn = async (name: string) => paint.locator(`[data-door="style.setBackgroundImage#inspector-background-image-${name}"]`).count();
  await expect(paint.locator(`[data-door="${ADD}"]`), 'Add a gradient is drawn').toHaveCount(1);
  for (const name of controls) expect(await drawn(name), `${name} is drawn only with a gradient`).toBe(0);
  // a gradient added: the editor's controls are drawn, on the page's value
  await paint.locator(`[data-door="${ADD}"]`).click();
  await expect.poll(async () => (await stylesOf(page, 'n-card-a'))['background-image'] ?? '').toContain('linear-gradient');
  for (const name of controls) expect(await drawn(name), `${name} is drawn`).toBeGreaterThan(0);
  // and Remove the gradient takes them away again
  await paint.locator('[data-door="style.setBackgroundImage#inspector-background-image-gradient-reset"]').click();
  await expect.poll(async () => (await stylesOf(page, 'n-card-a'))['background-image'] ?? '').not.toContain('linear-gradient');
  for (const name of controls) expect(await drawn(name), `${name} is drawn only with a gradient`).toBe(0);
});

test('Essentials draws the Border as its composite rows, not as its per-side fields', runs(OPEN, ROW, ESSENTIALS, ALL, 'inspector.toggleRow#inspector-row-disclosure'), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  await setSectionOpen(page, 'border', true);
  await runDoor(page, ESSENTIALS);
  await setSectionOpen(page, 'border', true);
  const border = page.locator('.inspector-section[aria-label="Border"]');
  const drawn = await border.locator('.field-row[data-door], .field-pair, [data-pair]').evaluateAll((els) => els.map((el) => el.getAttribute('data-door') ?? el.getAttribute('data-pair') ?? ''));
  // the Border, its colour on a line of its own (a pair's half could not hold its name: the user's review of
  // 2026-10-05), and the Radius
  expect(drawn, 'the Border rows and the Radius row').toEqual(['style.setBorder#inspector-border-border-editor', 'style.setBorder#inspector-border-color-border-editor', 'style.setRadius#inspector-border-radius-radius-editor']);
  for (const side of ['inspector-border-top-width-border-editor', 'inspector-border-left-border-editor', 'inspector-border-top-left-radius-radius-editor']) {
    await expect(border.locator(`[data-door="style.setBorder#${side}"]`), `${side} is left out of the essentials`).toHaveCount(0);
  }
  // All properties brings them back, in the Border row's details (spec inspector-panel, item 4a)
  await runDoor(page, ALL);
  await runDoor(page, 'inspector.toggleRow#inspector-row-disclosure', { args: { row: 'border' } });
  await expect(border.locator('[data-door="style.setBorder#inspector-border-top-width-border-editor"]')).toHaveCount(1);
});

// A control that edits no property of its own is drawn in the section properties.json's controls gives it, never in
// whichever section happened to come before it (the audit's S-013, S-023; src/manifest/style-places.ts): the spacing
// link in Space, the custom declarations in Advanced, the anchor control in Position (a margin listed it first); and
// each field in its property's section.
test('each Style control is drawn in its own section', runs(OPEN, ROW, SECTION, ALL, POSITION), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  // the anchor control stands for the insets, which only a positioned element takes
  await openEverySection(page);
  await runDoor(page, POSITION, { args: { property: 'position', mode: 'absolute' } });
  await openEverySection(page);
  await runDoor(page, ALL);
  const PLACED: readonly (readonly [string, string])[] = [
    ['inspector.toggleSpacingLink#inspector-spacing-link', 'space'],
    ['style.setCustomDeclarations#inspector-custom-declarations', 'advanced'],
    ['position.setAnchors#inspector-anchor-control', 'position'],
    [WIDTH, 'size'],
    [LETTER_SPACING, 'text'],
  ];
  for (const [ref, section] of PLACED) {
    const drawn = page.locator(`[data-door="${ref}"]`).first();
    await expect(drawn, `${ref} is drawn`).toHaveCount(1);
    expect(await drawn.evaluate((el) => el.closest('[data-section]')?.getAttribute('data-section') ?? null), ref).toBe(section);
  }
});

// Every field of a pair row takes what is typed into it, the narrowest included (a pair's Height beside its H and its
// measured hint took no character while it suggested values through a datalist, and Enter kept ""): typed, it holds
// the text; Escape gives the document's value back.
test('every field of a pair row takes what is typed into it', runs(OPEN, ROW, SECTION, ALL), async ({ page }) => {
  for (const target of ['n-hero', 'n-title']) {
    await control(page, ROW, { args: { target } }).click();
    await openEverySection(page);
    await runDoor(page, ALL);
    const fields = page.locator('[data-region="inspector-style"] .field-row--pair .field-cell input');
    const count = await fields.count();
    expect(count, `${target}: pair fields are drawn`).toBeGreaterThan(4);
    for (let i = 0; i < count; i += 1) {
      const field = fields.nth(i);
      if (!(await field.isEnabled())) continue;
      await field.scrollIntoViewIfNeeded();
      await field.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('12');
      expect(await field.inputValue(), `${target}: ${await field.getAttribute('aria-label')} holds what was typed`).toBe('12');
      await page.keyboard.press('Escape');
    }
  }
});

// J10 of the jornada03 study: a breakpoint that inherits two columns showed "0 tracks"; the lists were unnamed and the
// + moved after the first add. The editor shows the inherited tracks, names its axis, keeps + in its header, and an
// edited inherited track writes the whole list at the edited breakpoint only.
test('a breakpoint that inherits two columns shows them, and editing one writes the list there only', runs(OPEN, ROW, 'style.set#inspector-display', 'style.setGridTracks#inspector-grid-template-columns-add-track', 'style.setGridTracks#inspector-grid-template-columns-track', 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet'), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  const display = panel(page).locator('[data-door="style.set#inspector-display"] input').first();
  await display.fill('grid');
  await display.press('Enter');
  const layout = panel(page).locator('.inspector-section[aria-label="Layout"]');
  const add = layout.locator('[data-door="style.setGridTracks#inspector-grid-template-columns-add-track"]');
  await add.click();
  const header = layout.locator('.grid-tracks__header').first();
  const before = await add.boundingBox();
  await add.click();
  // the + stays where it was: it lives in the header, not after the list
  expect((await add.boundingBox())?.y).toBe(before?.y);
  await expect(header).toContainText('2 tracks');
  await expect.poll(async () => (await stylesOf(page, 'n-card-a'))['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
  await runDoor(page, 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet');
  // the tablet inherits the desktop's two columns: they are shown, never "0 tracks"
  await expect(header).toContainText('2 tracks');
  const first = layout.locator('[data-door="style.setGridTracks#inspector-grid-template-columns-track"] input').first();
  await expect(first).toHaveValue('minmax(0, 1fr)');
  await first.fill('2fr');
  await first.press('Enter');
  const tablet = async () => page.evaluate(() => {
    const port = (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { children: { id: string; styles?: Record<string, Record<string, Record<string, string>>> }[] } }[] } } }).__builderTestPort;
    const walk = (n: { id: string; styles?: Record<string, Record<string, Record<string, string>>>; children?: unknown[] }): typeof n | undefined => n.id === 'n-card-a' ? n : (n.children ?? []).map((c) => walk(c as typeof n)).find((x) => x !== undefined);
    return walk(port.document().pages[0]?.tree as never)?.styles;
  });
  await expect.poll(async () => (await tablet())?.tablet?.base?.['grid-template-columns']).toBe('2fr minmax(0, 1fr)');
  // the desktop keeps its own two equal columns
  expect((await stylesOf(page, 'n-card-a'))['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
});
