// No text of the inspector is cut, in either language (spec inspector-panel, Problem 12; the audit's AUD-23: in
// Portuguese the Size pair's cells read "autom… 120", "A auto… 47", "máx nenh…"). For one element of each kind inserted
// on a fresh page, in each tab of the inspector with every section and row open, nothing the inspector writes is cut
// by its box: a value, a keyword, a summary, a tab, a placeholder; and no word of a label is broken across two lines.
// Only a value of several parts (a list of fonts, a shorthand such as a border), which no field holds, may end in an
// ellipsis, and then its field's tooltip carries it whole. Text read only by assistive technology is not drawn, so it is not measured.
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import fs from 'node:fs';
import { control, openEverySection, runDoor, runs } from './door.ts';

const INSERT = 'element.insert#elements-tile';
const TABS = ['workspace.setActiveTab#inspector-tab-style', 'workspace.setActiveTab#inspector-tab-settings', 'workspace.setActiveTab#inspector-tab-interactions'] as const;
const ALL = 'inspector.setMode#inspector-mode-all';
const MASK_KIND = 'element.setAttribute#forms-mask-kind';
const MASK_PRESET = 'element.setAttribute#forms-mask-preset';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const ADD_EVENT = 'interactions.add#inspector-interaction-add';
const ADD_MOTION = 'motion.add#inspector-motion-add';
// the value an input holds, wider than the room it gives it (an input cuts its text with no ellipsis)
const cutValues = (page: Page, scope: string) =>
  page.locator(scope).evaluate((region) => {
    const canvas = document.createElement('canvas').getContext('2d');
    return [...region.querySelectorAll<HTMLInputElement>('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])')]
      .filter((input) => input.value !== '' && input.getClientRects().length > 0 && getComputedStyle(input).color !== 'rgba(0, 0, 0, 0)')
      .filter((input) => {
        const style = getComputedStyle(input);
        if (canvas === null) return false;
        canvas.font = style.font;
        const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        // what the field scrolls counts what its text cannot see, the list's drop-down indicator included
        return canvas.measureText(input.value).width > room + 1 || input.scrollWidth > input.clientWidth + 1;
      })
      .map((input) => `${input.labels?.[0]?.textContent ?? input.getAttribute('aria-label') ?? ''}: ${input.value}`);
  });
// one element of each kind whose inspector draws sections of its own: a box, text, a link and a button, media, form
// controls, a list, a table, a disclosure, a dialog, a drawing
const ENTRIES = ['section', 'heading', 'link', 'button', 'image', 'video', 'form', 'input-text', 'select', 'input-range', 'unordered-list', 'table', 'details', 'dialog', 'svg'];

interface Cut {
  readonly what: string;
  readonly text: string;
  readonly needs: number;
  readonly has: number;
}

// what the inspector shows cut: a box whose text is wider than it (it clips), a placeholder wider than its field, a word
// wider than the label it is in (broken across lines)
const cutTexts = (page: Page) =>
  page.evaluate((): Cut[] => {
    const root = document.querySelector('aside.inspector');
    if (root === null) return [{ what: 'inspector', text: 'not drawn', needs: 0, has: 0 }];
    const canvas = document.createElement('canvas').getContext('2d');
    const widthOf = (text: string, style: CSSStyleDeclaration): number => {
      if (canvas === null) return 0;
      canvas.font = style.font;
      return canvas.measureText(text).width;
    };
    const contentWidth = (el: Element, style: CSSStyleDeclaration) => el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.closest('[data-door]') ? ` in ${el.closest('[data-door]')?.getAttribute('data-door') ?? ''}` : ''}`;
    const found: Cut[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('svg') !== null || el.closest('.visually-hidden') !== null || el.getClientRects().length === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'inline') continue;
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value === '' && el.placeholder !== '') {
        // a placeholder the field shows (the inspector's own faces draw over a transparent one)
        if (style.color !== 'rgba(0, 0, 0, 0)' && getComputedStyle(el, '::placeholder').color !== 'rgba(0, 0, 0, 0)') {
          const needs = widthOf(el.placeholder, style);
          if (needs > contentWidth(el, style) + 1) found.push({ what: `placeholder of ${name(el)}`, text: el.placeholder, needs: Math.ceil(needs), has: Math.floor(contentWidth(el, style)) });
        }
        continue;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) continue;
      const text = el.innerText.trim();
      if (text === '') continue;
      if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
        // a value of several parts, whole in its field's tooltip
        const parts = /[\s,]/u.test(text);
        if (parts && el.matches('.field__rest-value') && el.closest('[title]')?.getAttribute('title') === el.textContent) continue;
        found.push({ what: name(el), text: text.slice(0, 60), needs: el.scrollWidth, has: el.clientWidth });
        continue;
      }
      // a word broken across lines: a word of the element's own text wider than its box
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join(' ');
      for (const word of own.split(/\s+/).filter((w) => w !== '')) {
        const needs = widthOf(word, style);
        if (needs > contentWidth(el, style) + 1) found.push({ what: `a word of ${name(el)}`, text: word, needs: Math.ceil(needs), has: Math.floor(contentWidth(el, style)) });
      }
    }
    return found;
  });

for (const locale of ['en-US', 'pt-BR']) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEditor(page);
    });

    test('no text of the inspector is cut, for each kind of element, in every tab with every section open', runs(INSERT, ALL, ...TABS), async ({ page }) => {
      test.setTimeout(240_000);
      const cut: (Cut & { readonly entry: string; readonly tab: string })[] = [];
      for (const entry of ENTRIES) {
        await control(page, INSERT, { args: { entry } }).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, { selection: () => unknown[] }>).__builderTestPort?.selection().length ?? 0)).toBe(1);
        for (const tab of TABS) {
          await runDoor(page, tab);
          if (tab === TABS[0]) {
            await runDoor(page, ALL);
            await openEverySection(page);
          }
          await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          for (const one of await cutTexts(page)) cut.push({ ...one, entry, tab: tab.split('-').pop() ?? tab });
        }
        await runDoor(page, TABS[0]);
      }
      expect(cut).toEqual([]);
    });

    // A field of offered values shows the words of its choice whole (CL1: once a mask preset was chosen the Form
    // section read "Brazilian taxpaye…", "When leaving th…", "Create automatica…"; an input cuts its text with no
    // ellipsis, so the walk above, which reads an input's placeholder only, never saw it). The preset is typed as its
    // value, which the field takes in any language.
    test('a field of offered values shows its chosen words whole once a mask preset is chosen', runs(INSERT, MASK_KIND), async ({ page }) => {
      await control(page, INSERT, { args: { entry: 'input-text' } }).click();
      await runDoor(page, TABS[1]);
      const kind = control(page, MASK_KIND).locator('input');
      await kind.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('preset\n');
      await expect(control(page, MASK_PRESET).locator('input')).not.toHaveValue('');
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const cutChoices = await page.locator('[data-region="forms-settings"]').evaluate((region) => {
        const canvas = document.createElement('canvas').getContext('2d');
        return [...region.querySelectorAll<HTMLInputElement>('input[list]')]
          .filter((input) => input.value !== '' && input.getClientRects().length > 0)
          .filter((input) => {
            const style = getComputedStyle(input);
            if (canvas === null) return false;
            canvas.font = style.font;
            const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return canvas.measureText(input.value).width > room + 1;
          })
          .map((input) => `${input.getAttribute('aria-label') ?? ''}: ${input.value}`);
      });
      expect(cutChoices).toEqual([]);
    });

    // The Interactions tab's fields show their values whole (the audit of 2026-10-04: with an event and a motion on the
    // Hero, Reduced motion read "Respect it (no movemer" at 1440 px, cut mid-word with no ellipsis).
    test('the Interactions tab shows every field value whole with an event and a motion', runs(OPEN, ROW, ADD_EVENT, ADD_MOTION), async ({ page }) => {
      const chooser = page.waitForEvent('filechooser');
      await runDoor(page, OPEN);
      await (await chooser).setFiles({ name: 'motion.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/motion.json') });
      await control(page, ROW, { args: { target: 'n-hero' } }).click();
      await runDoor(page, TABS[2]);
      await runDoor(page, ADD_EVENT);
      await runDoor(page, ADD_MOTION);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await cutValues(page, 'aside.inspector')).toEqual([]);
    });
  });
}
