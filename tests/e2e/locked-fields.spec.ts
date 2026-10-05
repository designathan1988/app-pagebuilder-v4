// Style fields of a locked element (spec lock-element, Problems in Pager 3; the audit's A3.11): while the selected
// element, or an element above it, is locked, every style field's door is drawn disabled before anything is typed, its
// title gives the lock's reason naming the lock ("Unlock Actions before changing it."), and a forced attempt on it
// changes nothing; unlocked, the same door takes input again and writes. These are the ten doors whose scenarios typed
// into a locked element's field and expected the refusal afterwards (retired for this test). The document is read
// through the read-only test port; the doors' state and reason are the drawn controls.
import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const LOCK = 'element.toggleLock#layers-row-lock';
const ALL = 'inspector.setMode#inspector-mode-all';
const WIDTH = 'style.set#inspector-width';
const DISPLAY = 'style.set#inspector-display';
const PADDING_TOP = 'style.setSpacing#inspector-padding-top-box-model';
const OVERFLOW = 'style.set#inspector-overflow';
const FONT_SIZE = 'style.set#inspector-font-size';
const IMAGE = 'style.setBackgroundImage#inspector-background-image';
const GRADIENT_ADD = 'style.setBackgroundImage#inspector-background-image-gradient-add';
const GRADIENT_REVERSE = 'style.setBackgroundImage#inspector-background-image-gradient-reverse';
const BORDER = 'style.setBorder#inspector-border-border-editor';
const SHADOW_ADD = 'style.setShadows#inspector-box-shadow-shadow-add';
const SWATCH = 'colorPicker.open#field-color-swatch';
const PICKER_VALUE = 'style.set#color-picker-value';
const QUICK_WIDTH = 'style.set#quick-panel-width';

const documentText = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document()));
interface Node {
  readonly id: string;
  readonly locked?: boolean;
  readonly styles: Record<string, Record<string, Record<string, unknown>>>;
  readonly children: readonly Node[];
}
const nodeOf = async (page: Page, id: string): Promise<Node | null> => {
  const d = JSON.parse(await documentText(page)) as { pages: { tree: Node }[] };
  const find = (n: Node): Node | null => (n.id === id ? n : n.children.map(find).find((x) => x !== null) ?? null);
  const tree = d.pages[0]?.tree;
  return tree === undefined ? null : find(tree);
};

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-grid"]')).toHaveCount(1);
  await page.keyboard.press('Control+0');
}
// The mode switch and the section headers exist for a selection alone: with nothing selected the Style tab is the
// guidance alone (spec inspector-empty-style). Each test calls this with the element it works on; every section is drawn
// open, since a section the selected element holds no value in is drawn collapsed by itself (item 5.1) and this spec
// reads the fields of every section.
async function prepared(page: Page, target: string): Promise<void> {
  await control(page, ROW, { args: { target } }).click();
  await runDoor(page, ALL);
  await openEverySection(page);
}
// the element typed into or pressed: a field's input, else its button, else the control itself
async function operated(c: Locator): Promise<{ readonly target: Locator; readonly typed: boolean }> {
  const input = c.locator('input, textarea');
  if ((await input.count()) > 0) return { target: input.first(), typed: true };
  const button = c.locator('button');
  return { target: (await button.count()) > 0 ? button.first() : c, typed: false };
}
// a door drawn disabled with the lock's reason, and a forced attempt on it changing nothing
async function refusedBeforeTyping(page: Page, ref: string, name: string): Promise<void> {
  const c = control(page, ref).first();
  await expect(c).toHaveAttribute('title', new RegExp(`Unlock ${name} before changing it\\.$`));
  const { target, typed } = await operated(c);
  if (typed) await expect(target).toBeDisabled();
  else await expect(target).toHaveAttribute('aria-disabled', 'true');
  const before = await documentText(page);
  await target.click({ force: true });
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  expect(await documentText(page)).toBe(before);
}
// unlocked: the door takes input again, and no lock is its reason
async function usableAgain(page: Page, ref: string): Promise<void> {
  const c = control(page, ref).first();
  await expect(c).not.toHaveAttribute('title', /Unlock/);
  const { target, typed } = await operated(c);
  if (typed) await expect(target).toBeEnabled();
  else await expect(target).not.toHaveAttribute('aria-disabled', 'true');
}
async function lock(page: Page, id: string): Promise<void> {
  await control(page, LOCK, { args: { target: id } }).click();
  await expect.poll(async () => (await nodeOf(page, id))?.locked).toBe(true);
}
async function unlock(page: Page, id: string): Promise<void> {
  await control(page, LOCK, { args: { target: id } }).click();
  await expect.poll(async () => (await nodeOf(page, id))?.locked).toBeUndefined();
}

test('a locked element: its style fields are disabled with the lock as their reason before anything is typed, and usable once unlocked', runs(OPEN, ROW, LOCK, ALL, WIDTH, DISPLAY, BORDER, SHADOW_ADD, SWATCH, PICKER_VALUE, QUICK_WIDTH), async ({ page }) => {
  await open(page);
  await prepared(page, 'n-actions');
  await lock(page, 'n-actions');
  // the tab says it once, at its top, in the lock's words (Problems in Pager 5)
  const notice = page.locator('.inspector-notice--lock');
  await expect(notice).toHaveText('Unlock Actions before changing it.');
  for (const ref of [WIDTH, DISPLAY, BORDER, SHADOW_ADD]) await refusedBeforeTyping(page, ref, 'Actions');
  // the background colour's swatch, which opens the colour picker, is disabled with the same reason: no picker opens
  const swatch = control(page, SWATCH, { args: { property: 'background-color' } }).first();
  await expect(swatch).toHaveAttribute('title', /Unlock Actions before changing it\.$/);
  await expect(swatch).toHaveAttribute('aria-disabled', 'true');
  await swatch.click({ force: true });
  await expect(control(page, PICKER_VALUE)).toHaveCount(0);
  // the quick panel's Width: the same door rule, the same reason. Its chip stands beside the selection's label, at the
  // element's start (DEC-70), which at 100 % lies left of the canvas: the page is fitted first so the chip is in sight
  await page.keyboard.press('Shift+1');
  await page.locator('[data-quick-panel-chip][aria-expanded="false"]').click();
  await refusedBeforeTyping(page, QUICK_WIDTH, 'Actions');
  await control(page, ROW, { args: { target: 'n-actions' } }).click();
  // unlocked: every one takes input again, the picker opens, and Width writes
  await unlock(page, 'n-actions');
  await expect(notice).toHaveCount(0);
  for (const ref of [WIDTH, DISPLAY, BORDER, SHADOW_ADD]) await usableAgain(page, ref);
  await expect(swatch).not.toHaveAttribute('aria-disabled', 'true');
  await swatch.click();
  await expect(control(page, PICKER_VALUE).first()).toBeVisible();
  await page.keyboard.press('Escape');
  const width = (await operated(control(page, WIDTH).first())).target;
  await width.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('240');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await nodeOf(page, 'n-actions'))?.styles.desktop?.base?.width).toBe('240px');
});

test('inside a locked section: the fields of the section and of a paragraph in it are disabled, the lock named', runs(OPEN, ROW, LOCK, ALL, PADDING_TOP, OVERFLOW, IMAGE, GRADIENT_ADD, GRADIENT_REVERSE, FONT_SIZE), async ({ page }) => {
  await open(page);
  await prepared(page, 'n-hero');
  // a gradient to reverse, added before the lock
  await control(page, GRADIENT_ADD).first().click();
  await expect.poll(async () => String((await nodeOf(page, 'n-hero'))?.styles.desktop?.base?.['background-image'] ?? '')).toContain('linear-gradient');
  await lock(page, 'n-hero');
  for (const ref of [PADDING_TOP, OVERFLOW, IMAGE, GRADIENT_REVERSE]) await refusedBeforeTyping(page, ref, 'Hero');
  // Intro, inside Hero: its reason names the lock above it
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  const c = control(page, FONT_SIZE).first();
  await expect(page.locator('.inspector-notice--lock')).toHaveText('Intro is locked by Hero; unlock Hero first.');
  await expect(c).toHaveAttribute('title', /Intro is locked by Hero; unlock Hero first\.$/);
  await expect((await operated(c)).target).toBeDisabled();
  // unlocked: usable again
  await unlock(page, 'n-hero');
  await usableAgain(page, FONT_SIZE);
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  for (const ref of [PADDING_TOP, OVERFLOW, IMAGE, GRADIENT_REVERSE]) await usableAgain(page, ref);
});
