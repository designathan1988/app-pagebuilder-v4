// wrap-row-column beyond its scenarios (spec/BEHAVIOUR.md#wrap-row-column; src/core/structure/wrap.ts): the Arrange
// menu's two items wrap as R and C do, each one undo step; C wraps an element its only child covers on the canvas,
// reached with ArrowUp from that child (spec select-click, "Nested elements"); R wraps several selected siblings in
// their order and refuses elements of different parents; a parent that accepts no <div> refuses the wrapper. The
// document, the selection and the history are read through the read-only test port, the wrapper's style inside the
// frame, the message in the status bar.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';

interface Tree {
  readonly id: string;
  readonly name: string;
  readonly children: readonly Tree[];
}
// the page's tree as names, the selection as names and the history's steps, through the read-only test port
const read = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number; redoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    const names = new Map<string, string>();
    const outline = (n: Tree): string => {
      names.set(n.id, n.name);
      return n.children.length === 0 ? n.name : `${n.name}(${n.children.map(outline).join(' ')})`;
    };
    const tree = outline(p.document().pages[0]?.tree as Tree);
    return { tree, selection: p.selection().map((id) => names.get(id) ?? id), undoSteps: p.history().undoSteps };
  });

// the ids of the children of the node of that name: a wrapper holds the very nodes it wraps, with their ids
const childIds = (page: Page, name: string) =>
  page.evaluate((wanted) => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] } }>).__builderTestPort;
    const find = (n: Tree): Tree | undefined => (n.name === wanted ? n : n.children.map(find).find((x) => x !== undefined));
    const node = p ? find(p.document().pages[0]?.tree as Tree) : undefined;
    return node ? node.children.map((c) => c.id) : null;
  }, name);

// the computed display and flex-direction of the element drawn for the node of that name inside the frame
const flexOf = (page: Page, name: string) =>
  page.evaluate((wanted) => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] } }>).__builderTestPort;
    const find = (n: Tree): Tree | undefined => (n.name === wanted ? n : n.children.map(find).find((x) => x !== undefined));
    const node = p ? find(p.document().pages[0]?.tree as Tree) : undefined;
    const el = node ? document.querySelector<HTMLIFrameElement>('.frame__page')?.contentDocument?.querySelector(`[data-node="${node.id}"]`) : null;
    if (!el) return null;
    const style = getComputedStyle(el);
    return `${style.display} ${style.flexDirection}`;
  }, name);

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
}

// a click at the centre of a node's element on the canvas, through the frame's CSS zoom, with a key held
async function clickNode(page: Page, id: string, key?: 'Shift') {
  const at = await page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
    if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
  }, id);
  if (key) await page.keyboard.down(key);
  await page.mouse.click(at.x, at.y);
  if (key) await page.keyboard.up(key);
}

const HERO = 'Hero(Title Intro Actions)';
const REST = 'Plans(Grid(CardA(CardATitle) CardB(CardBTitle) CardC) Perks(PerkOne(PerkOneText) PerkTwo(PerkTwoText))) Footer(Note)';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  await openAurora(page);
});

test(
  'Arrange › Wrap in a row and Wrap in a column wrap the selection as R and C do, one undo step each',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapRow#menu-arrange', 'element.wrapColumn#menu-arrange', 'history.undo#toolbar-top-bar'),
  async ({ page }) => {
    const status = page.getByRole('status');
    await clickNode(page, 'n-intro');
    await runDoor(page, 'element.wrapRow#menu-arrange');
    expect(await read(page)).toEqual({ tree: `Page(Hero(Title Row(Intro) Actions) ${REST})`, selection: ['Row'], undoSteps: 1 });
    expect(await childIds(page, 'Row'), 'the Row holds Intro itself, with its id').toEqual(['n-intro']);
    await expect(status).toHaveText('Wrapped Intro in Row (display: flex; flex-direction: row; column-gap: 16px).');
    await expect.poll(() => flexOf(page, 'Row')).toBe('flex row');

    await runDoor(page, 'history.undo#toolbar-top-bar');
    expect(await read(page)).toEqual({ tree: `Page(${HERO} ${REST})`, selection: ['Intro'], undoSteps: 0 });

    await runDoor(page, 'element.wrapColumn#menu-arrange');
    expect(await read(page)).toEqual({ tree: `Page(Hero(Title Column(Intro) Actions) ${REST})`, selection: ['Column'], undoSteps: 1 });
    expect(await childIds(page, 'Column'), 'the Column holds Intro itself, with its id').toEqual(['n-intro']);
    await expect(status).toHaveText('Wrapped Intro in Column (display: flex; flex-direction: column; row-gap: 16px).');
    await expect.poll(() => flexOf(page, 'Column')).toBe('flex column');
  },
);

test(
  'C wraps an element its only child covers on the canvas, reached with ArrowUp from that child',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.walkParent#key-arrow-up-in-canvas', 'element.wrapColumn#key-c-in-canvas', 'history.undo#toolbar-top-bar'),
  async ({ page }) => {
    await clickNode(page, 'n-card-b-title');
    await runDoor(page, 'selection.walkParent#key-arrow-up-in-canvas');
    expect((await read(page)).selection).toEqual(['CardB']);
    await runDoor(page, 'element.wrapColumn#key-c-in-canvas');
    const after = `Page(${HERO} Plans(Grid(CardA(CardATitle) Column(CardB(CardBTitle)) CardC) Perks(PerkOne(PerkOneText) PerkTwo(PerkTwoText))) Footer(Note))`;
    expect(await read(page)).toEqual({ tree: after, selection: ['Column'], undoSteps: 1 });
    expect(await childIds(page, 'Column'), 'the Column holds CardB itself, with its id').toEqual(['n-card-b']);
    expect(await childIds(page, 'CardB'), 'CardB keeps its title, with its id').toEqual(['n-card-b-title']);
    await expect(page.getByRole('status')).toHaveText('Wrapped CardB in Column (display: flex; flex-direction: column; row-gap: 16px).');
    await expect.poll(() => flexOf(page, 'Column')).toBe('flex column');
    await runDoor(page, 'history.undo#toolbar-top-bar');
    expect(await read(page)).toEqual({ tree: `Page(${HERO} ${REST})`, selection: ['CardB'], undoSteps: 0 });
  },
);

test(
  'R wraps several selected siblings in their document order, and refuses elements of different parents',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.add#canvas-click-element-shift', 'element.wrapRow#key-r-in-canvas'),
  async ({ page }) => {
    const status = page.getByRole('status');
    // Actions first, then Title: the Row holds them as the document orders them
    await clickNode(page, 'n-actions');
    await clickNode(page, 'n-title', 'Shift');
    await runDoor(page, 'element.wrapRow#key-r-in-canvas');
    // Title and Actions are not next to each other, so wrapping them moves Intro past them: the command tells the
    // person the order changes and asks first (the user's real-use audit, A3.13). Answering wraps them, in the
    // document's order.
    await expect(page.getByRole('alertdialog')).toContainText('Putting these elements together may change their position on the page. Continue?');
    fs.mkdirSync('.cache/logs/j28-copy', { recursive: true });
    await page.screenshot({ path: '.cache/logs/j28-copy/wrap-en.png' });
    await page.locator('[data-confirmation="confirm"]').click();
    expect(await read(page)).toEqual({ tree: `Page(Hero(Row(Title Actions) Intro) ${REST})`, selection: ['Row'], undoSteps: 1 });
    expect(await childIds(page, 'Row'), 'the Row holds Title and Actions themselves, with their ids').toEqual(['n-title', 'n-actions']);
    await expect(status).toHaveText('Wrapped 2 elements in Row (display: flex; flex-direction: row; column-gap: 16px).');
    await expect.poll(() => flexOf(page, 'Row')).toBe('flex row');

    // Intro (in Hero) and Note (in Footer): refused, nothing changes
    await clickNode(page, 'n-intro');
    await clickNode(page, 'n-note', 'Shift');
    const before = await read(page);
    await runDoor(page, 'element.wrapRow#key-r-in-canvas');
    await expect(status).toHaveText('These elements must share a parent.');
    expect(await read(page)).toEqual(before);
  },
);

test.describe('Portuguese wrap copy', () => {
  test.use({ locale: 'pt-BR' });
  test('the confirmation explains the layout change without technical wording', runs('element.wrapRow#key-r-in-canvas'), async ({ page }) => {
    await clickNode(page, 'n-actions');
    await clickNode(page, 'n-title', 'Shift');
    await runDoor(page, 'element.wrapRow#key-r-in-canvas');
    await expect(page.getByRole('alertdialog')).toContainText('Colocar estes elementos juntos pode mudar a posição deles na página. Continuar?');
    fs.mkdirSync('.cache/logs/j28-copy', { recursive: true });
    await page.screenshot({ path: '.cache/logs/j28-copy/wrap-pt-BR.png' });
  });
});

test(
  'a parent that accepts no <div> refuses the wrapper, and nothing changes',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.walkParent#key-arrow-up-in-canvas', 'element.wrapColumn#key-c-in-canvas'),
  async ({ page }) => {
    await clickNode(page, 'n-perk-one-text');
    await runDoor(page, 'selection.walkParent#key-arrow-up-in-canvas');
    const before = await read(page);
    expect(before.selection).toEqual(['PerkOne']);
    await runDoor(page, 'element.wrapColumn#key-c-in-canvas');
    await expect(page.getByRole('status')).toHaveText('Refused. <ul> only accepts <li>.');
    expect(await read(page)).toEqual(before);
  },
);

// Words typed on the canvas are not shortcuts (keys.typingBurst; the dogfooding pass: words typed on the canvas wrapped,
// moved and nested elements one letter at a time; jornada03 J2: the first letters still ran, "Grãos" wrapped an image in
// a grid and a row). Changed on purpose with J2: once a letter of the burst binds nothing (the "a"), the shortcuts the
// burst already ran are taken back and the letters after it do not run; shortcuts pressed in a row (R then S, scenario
// swapping-the-direction-of-a-row) still do; a letter on its own later runs again.
test('a typed word on the canvas runs no shortcut: the letters it ran before the word showed are taken back', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapRow#key-r-in-canvas', 'element.wrapColumn#key-c-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  const before = await read(page);
  await page.keyboard.type('racgm');
  await expect(page.getByRole('status')).toHaveText('Typing is not a shortcut: took back R.');
  expect(await read(page)).toMatchObject({ tree: before.tree, undoSteps: 0 });
  await page.waitForTimeout(500);
  await page.keyboard.press('c');
  await expect.poll(() => read(page)).toMatchObject({ undoSteps: 1 });
  expect((await read(page)).tree).toContain('Column(Intro)');
});

for (const word of ['Grãos de café', 'Cardápio']) {
  test(`typing ${word} on the canvas preserves the document and view`, runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page'), async ({ page }) => {
    await clickNode(page, 'n-intro');
    const before = await read(page);
    await page.keyboard.type(word);
    expect(await read(page)).toEqual(before);
    await expect(page.locator('.frame__page')).toBeVisible();
  });
}

test('a shifted letter in a recognized word does not run a structure shortcut', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapRow#key-r-in-canvas', 'element.stackOnPhone#key-shift-s-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document());
  await page.keyboard.type('a');
  await page.keyboard.press('Shift+s');
  expect(await page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document())).toEqual(before);
});

test('a word beginning with M leaves no keyboard move active', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'hand.take#key-m-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  const before = await read(page);
  await page.keyboard.type('marina');
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  expect(await read(page)).toEqual(before);
});

test('typing a word preserves the earlier redo action', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapColumn#key-c-in-canvas', 'history.undo#key-ctrl-z-in-global', 'history.redo#key-ctrl-shift-z-in-global'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  await page.keyboard.press('c');
  await page.keyboard.press('Control+z');
  await page.keyboard.type('racgm');
  await page.keyboard.press('Control+Shift+z');
  expect((await read(page)).tree).toContain('Column(Intro)');
});

test('a press elsewhere after F6 cancels the canvas choice even before its first letter', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'focus.nextRegion#key-f6-in-global'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  const before = await read(page);
  await page.locator('[data-region="status-bar"]').click({ position: { x: 4, y: 4 } });
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('F6');
    if (await page.evaluate(() => document.activeElement?.closest('.stage') !== null)) break;
  }
  await page.locator('[data-region="status-bar"]').click({ position: { x: 4, y: 4 } });
  await page.keyboard.type('r');
  expect(await read(page)).toEqual(before);
});

test('F6 onto the canvas deliberately enables its letter shortcuts after focus elsewhere', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'focus.nextRegion#key-f6-in-global', 'element.wrapRow#key-r-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  await page.locator('[data-region="status-bar"]').click({ position: { x: 4, y: 4 } });
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('F6');
    if (await page.evaluate(() => document.activeElement?.closest('.stage') !== null)) break;
  }
  expect(await page.evaluate(() => document.activeElement?.closest('.stage') !== null)).toBe(true);
  await page.keyboard.press('r');
  expect((await read(page)).tree).toContain('Row(Intro)');
});

test('an intervening modified shortcut ends the typing burst, so later typing cannot undo it', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapRow#key-r-in-canvas', 'history.undo#key-ctrl-z-in-global', 'history.redo#key-ctrl-shift-z-in-global'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  await page.keyboard.press('r');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  const before = await read(page);
  await page.keyboard.type('a');
  expect(await read(page)).toEqual(before);
});

test('autosave never records the accidental wrapper in a word but saves an isolated shortcut', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapRow#key-r-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  const savedDocument = () => page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('work');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('projects').objectStore('projects').get('current');
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => { database.close(); resolve((read.result as { document?: unknown } | undefined)?.document); };
    };
  }));
  const before = await savedDocument();
  expect(before).toBeDefined();
  await page.keyboard.press('r');
  expect(await savedDocument()).toEqual(before);
  await page.keyboard.type('acgm');
  await page.waitForTimeout(400);
  const versions = await page.evaluate(() => new Promise<{ document: { pages: { tree: Tree }[] } }[]>((resolve, reject) => {
    const request = indexedDB.open('work');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('versions').objectStore('versions').getAll();
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => { database.close(); resolve(read.result as { document: { pages: { tree: Tree }[] } }[]); };
    };
  }));
  expect(versions.length).toBeGreaterThan(0);
  const hasRow = (node: Tree): boolean => node.name === 'Row' || node.children.some(hasRow);
  expect(versions.some((version) => version.document.pages.some((page) => hasRow(page.tree)))).toBe(false);
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  expect((await read(page)).tree).toContain('Row(Intro)');
});

// jornada03 J2: a press away from the canvas (Marina chose an image in the picker, which closed; her next click was
// swallowed) leaves the focus on the page body, and the letters she typed for the Alt text ran the canvas's keys. The
// canvas's typed keys act only where the person chose the canvas or the Layers: elsewhere they do nothing and say why,
// once; Escape on the canvas, or a press on it, chooses it again.
test('letters typed after a press away from the canvas run nothing and say why; Escape chooses the canvas again', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.wrapGrid#key-g-in-canvas'), async ({ page }) => {
  await clickNode(page, 'n-intro');
  const before = await read(page);
  // a press on the status bar's message: no control there takes the focus, which rests on the page body
  await page.locator('[data-region="status-bar"]').click({ position: { x: 4, y: 4 } });
  await page.keyboard.type('Gr');
  await expect(page.getByRole('status')).toHaveText('Letters typed here do nothing: click the canvas or a Layers row to use their keys, or a field to type into it.');
  expect(await read(page)).toMatchObject({ tree: before.tree, undoSteps: 0 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await clickNode(page, 'n-intro');
  await page.keyboard.press('g');
  await expect.poll(() => read(page)).toMatchObject({ undoSteps: 1 });
});
