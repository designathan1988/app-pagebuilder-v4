// The interface's contrast, targets and states (the user's real-use audit, item A3.43; archive/DESIGN.md "Density and
// tokens"):
// an automatic measurement over the whole editor — every visible text's contrast against the surface behind it, every
// control's size, the states of a field (rest, hover, focus, error) told apart, and a disabled control told apart from
// an inactive one. It reads what Chrome computes, so a colour that only works in one theme fails here.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, runDoor, runs, setSectionOpen } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const ALL = 'inspector.setMode#inspector-mode-all';
const WIDTH = 'style.set#inspector-width';

// What the page computes of every element the editor draws: its own text, its contrast against the first opaque surface
// behind it (4.5:1, or 3:1 for text 24 px and larger), and its size when it is a control (24 x 24 at least).
async function measure(page: Page) {
  return page.evaluate(() => {
    const parse = (colour: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(colour);
      if (m === null) return null;
      const p = (m[1] ?? '').split(/[,\s/]+/).filter((x) => x !== '').map(Number);
      return { rgb: p.slice(0, 3) as number[], a: p.length > 3 ? (p[3] as number) : 1 };
    };
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (fg: number[], bg: number[]) => {
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
      return (a + 0.05) / (b + 0.05);
    };
    const behind = (el: Element) => {
      let node: Element | null = el;
      while (node !== null) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c !== null && c.a === 1) return c.rgb;
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    const shown = (el: Element) => {
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const lowContrast: Record<string, unknown>[] = [];
    const small: Record<string, unknown>[] = [];
    const weakCursor: Record<string, unknown>[] = [];
    const root = document.querySelector('.workbench') ?? document.body;
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.frame__page') !== null) continue;
      if (!shown(el)) continue;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (own !== '') {
        const fg = parse(getComputedStyle(el).color);
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        const has = fg === null ? 21 : ratio(fg.rgb, behind(el));
        const needs = size >= 24 ? 3 : 4.5;
        if (has < needs) lowContrast.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 44), text: own.slice(0, 28), ratio: Math.round(has * 100) / 100, size });
      }
      if (el.matches('button, input, select, textarea, [role="button"], [role="tab"]')) {
        const b = el.getBoundingClientRect();
        if (b.width < 24 || b.height < 24) small.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 44), w: Math.round(b.width), h: Math.round(b.height), label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) });
      }
      // a control that acts on a click says so: the pointer; a disabled one, which takes no click, says not-allowed
      if (el.matches('button:not([disabled]):not([aria-disabled="true"]), [role="button"]:not([aria-disabled="true"])')) {
        const cursor = getComputedStyle(el).cursor;
        if (cursor !== 'pointer' && cursor !== 'grab' && cursor !== 'ew-resize' && cursor !== 'col-resize') weakCursor.push({ cls: String(el.className).slice(0, 44), cursor, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) });
      }
    }
    return { lowContrast, small, weakCursor };
  });
}

async function openAurora(page: Page, target: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await control(page, ROW, { args: { target } }).click();
}

test('no text falls below the contrast its size needs, and no control is under 24 x 24', runs(OPEN, ROW, ALL, WIDTH), async ({ page }) => {
  await openAurora(page, 'n-card-a');
  // every field of the panel is drawn: the walk sees the longest screen of the inspector (a section the card holds no
  // value in is drawn collapsed by itself, item 5.1)
  await openEverySection(page);
  await runDoor(page, ALL);
  await expect(control(page, WIDTH)).toHaveCount(1);
  const held = await measure(page);
  expect(held.lowContrast, 'texts below 4.5:1 (3:1 from 24 px)').toEqual([]);
  expect(held.small, 'controls under 24 x 24').toEqual([]);
  expect(held.weakCursor, 'controls that take a click without the pointer cursor').toEqual([]);
});

test('a field tells its states apart, and a disabled control is not a quiet one', runs(OPEN, ROW, ALL, WIDTH), async ({ page }) => {
  await openAurora(page, 'n-card-a');
  await setSectionOpen(page, 'size', true);
  await runDoor(page, ALL);
  const field = control(page, WIDTH).locator('input').first();
  const borders = async () => field.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderColor, background: s.backgroundColor, outline: s.outlineColor };
  });
  const rest = await borders();
  await field.hover();
  await page.waitForTimeout(60);
  const hovered = await borders();
  await field.focus();
  await page.waitForTimeout(60);
  const focused = await borders();
  // the focus is said by the field itself, not only by the page's ring: its border takes the focus colour, over the
  // hover it may sit in
  expect(focused.border, 'a focused field wears the focus colour on its own border').not.toBe(hovered.border);
  // and the hover is a state of its own
  expect(hovered.background !== rest.background || hovered.border !== rest.border, 'a hovered field differs from the resting one').toBe(true);
  // a refused value wears the error state, apart from the rest, the hover and the focus
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('abc\n');
  await page.waitForTimeout(80);
  const invalid = await borders();
  expect(invalid.outline, 'a refused field wears the error colour').not.toBe(rest.outline);
  expect(invalid.outline, 'the error is not the focus').not.toBe(focused.outline);
  // a disabled control is told apart from an inactive one: Redo, with nothing to redo, against Preview beside it in the
  // top bar (the Interactions tab this compared before is built; and two objects compared with !== always differed)
  const bar = await page.evaluate(() => {
    const ink = (selector: string) => {
      const el = document.querySelector(selector);
      return el === null ? null : getComputedStyle(el).color;
    };
    return { disabled: ink('[data-door="history.redo#toolbar-top-bar"][aria-disabled="true"]'), inactive: ink('[data-door="view.enterPreview#toolbar-top-bar-preview"]:not([aria-disabled="true"])') };
  });
  expect(bar.disabled, 'the disabled Redo is drawn').not.toBeNull();
  expect(bar.inactive, 'the inactive Preview is drawn').not.toBeNull();
  expect(bar.disabled, 'disabled and inactive differ').not.toBe(bar.inactive);
});

// Every control of the Style tab has a name of its own, which a screen reader reads and a person finds by: the colour
// swatches named the field they open the picker for, and a filter's eight sliders their own function (they all read
// "Open the colour picker" and "Slide Filter").
test('every control of the Style tab has a name of its own', runs(OPEN, ROW, ALL), async ({ page }) => {
  await openAurora(page, 'n-card-a');
  for (const target of ['n-card-a', 'n-grid', 'n-title']) {
    await control(page, ROW, { args: { target } }).click();
    await openEverySection(page);
    await runDoor(page, ALL);
    const names = await page.locator('[data-region="inspector-style"]').evaluate((region) =>
      [...region.querySelectorAll('input, button, select, textarea, [role="button"], [role="slider"]')].map((el) => el.getAttribute('aria-label') ?? '').filter((name) => name !== ''),
    );
    const twice = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
    expect(twice, `${target}: names two controls share`).toEqual([]);
  }
});

// A selected Layers row's detail (its tag) keeps 4.5:1 on the selected fill in the dark theme too (the audit's U-047:
// the subtle ink fell to 3.9:1 there).
test('a selected Layers row keeps its detail readable in the dark theme', runs(OPEN, ROW), async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openAurora(page, 'n-card-a');
  const ratio = await page.locator(`[data-door="${ROW}"][aria-selected="true"]`).first().evaluate((row) => {
    const meta = row.closest('.row')?.querySelector('.row__meta') ?? row.querySelector('.row__meta');
    const rgb = (text: string) => (text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const s = (v ?? 0) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    let surface: Element | null = row;
    while (surface !== null && (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)' || getComputedStyle(surface).backgroundColor === 'transparent')) surface = surface.parentElement;
    if (meta === null || meta === undefined || surface === null) return 0;
    const a = lum(rgb(getComputedStyle(meta).color));
    const b = lum(rgb(getComputedStyle(surface).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

// Every control the pointer takes is at least 24 x 24 CSS px, or stands within WCAG 2.5.8's exceptions (the audit's
// AUD-29: sixteen were smaller — the canvas's spacing bands, the values buttons, the colour swatches — and the splitters
// were not measured). Measured over every control of the editor, the canvas's selection chrome and the dock included,
// with every inspector section open: a field's input counts by the frame a press focuses it from; an undersized control
// passes when a 24 px circle on its centre meets no other control nor another such circle (spacing), or when a control of
// the same name that is large enough does the same on the page (equivalent: a spacing band and the box model's field).
// A panel splitter (6 px) passes by the equivalent exception when the View menu holds its door in both directions
// (TS1, DEC-47: Widen and Narrow the sidebar and the inspector, the Layers taller and shorter), read from the manifest.
test('every control the pointer takes is 24 x 24, or within the target-size exceptions (WCAG 2.5.8)', runs(OPEN, ROW, ALL), async ({ page }) => {
  await openAurora(page, 'n-card-a');
  await openEverySection(page);
  await runDoor(page, ALL);
  await runDoor(page, 'workspace.setPanelOpen#menu-view-workbench');
  const workspace = JSON.parse(fs.readFileSync('manifest/commands/workspace.json', 'utf8')) as { commands: { id: string; entryPoints: { kind: string; menu?: string; args: { splitter?: string; direction?: string } }[] }[] };
  const resize = workspace.commands.find((one) => one.id === 'workspace.resizeSplitter');
  const menuDirections = new Map<string, Set<string>>();
  for (const door of resize?.entryPoints ?? []) {
    if (door.kind !== 'menu' || door.menu !== 'view' || door.args.splitter === undefined || door.args.direction === undefined) continue;
    menuDirections.set(door.args.splitter, (menuDirections.get(door.args.splitter) ?? new Set()).add(door.args.direction));
  }
  const equivalentSplitters = [...menuDirections].filter(([, directions]) => directions.size >= 2).map(([splitter]) => splitter);
  const failing = await page.evaluate((equivalents) => {
    const SIZE = 24;
    const selector = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], [role="combobox"], [role="slider"], [role="switch"], [role="checkbox"], [role="separator"][tabindex]';
    const taken = (el: Element) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && el.closest('[aria-hidden="true"], .frame__page') === null;
    };
    const controls = [...document.querySelectorAll(selector)].filter(taken);
    // a field's input is pressed through its frame
    const boxOf = (el: Element) => (el.matches('input, textarea, select') ? (el.closest('.input-wrap, .box__side, .panel-field__form') ?? el) : el).getBoundingClientRect();
    const nameOf = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
    const boxes = controls.map((el) => ({ el, box: boxOf(el), name: nameOf(el) }));
    // a splitter whose View menu doors grow and shrink its panel (the equivalent exception)
    const splitterEquivalent = (el: Element) => el.matches('.splitter') && equivalents.includes((JSON.parse(el.getAttribute('data-args') ?? '{}') as { splitter?: string }).splitter ?? '');
    const small = boxes.filter((c) => (c.box.width < SIZE || c.box.height < SIZE) && !splitterEquivalent(c.el));
    const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const distanceTo = (p: { x: number; y: number }, r: DOMRect) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
    return small
      .filter((c) => {
        const equivalent = c.name !== '' && boxes.some((o) => o !== c && o.name === c.name && o.box.width >= SIZE && o.box.height >= SIZE);
        if (equivalent) return false;
        const at = centre(c.box);
        const spaced = boxes.every((o) => {
          if (o === c || o.el.contains(c.el) || c.el.contains(o.el)) return true;
          const undersized = o.box.width < SIZE || o.box.height < SIZE;
          return undersized ? Math.hypot(centre(o.box).x - at.x, centre(o.box).y - at.y) >= SIZE : distanceTo(at, o.box) >= SIZE / 2;
        });
        return !spaced;
      })
      .map((c) => `${c.name || c.el.localName} ${Math.round(c.box.width)}x${Math.round(c.box.height)} (${String((c.el as HTMLElement).className).split(' ')[0]})`);
  }, equivalentSplitters);
  // every splitter of the layout has its two View menu doors
  expect(equivalentSplitters.sort()).toEqual(['inspector-width', 'sidebar-stack', 'sidebar-width']);
  expect(failing, 'controls under 24 x 24 outside the exceptions').toEqual([]);
});
