// The screen guard (DEC-74; the root-cause study of 2026-10-06, CR2): what a person sees wrong on the editor's screen,
// checked at the end of every browser test, as the incident guard checks the document (tests/support/test.ts). Before
// it, the only check of the screen was the audit's detector, run when someone audited (.cache/scratch/audit/detect.ts),
// and each fix added a probe of one surface (nine `*-fits` tests): the same kinds came back in every audit. Here every
// test that leaves a screen drawn proves it holds:
//
// - cut: a text of the interface wider (or taller) than the box that clips it, with no ellipsis, or with one and its
//   whole text nowhere a person can read it (a title or an accessible name on it or on its control);
// - wrapped: a one-line name of the interface (a field's name, a button, a tab, a menu item, an option, a chip, a
//   title) drawn on two lines or more (DEC-68, DEC-69);
// - off-window: a control a person must reach whose visible part passes the window's edge;
// - covered: a control whose centre takes no press, because another part of the editor that is not a layer opened above
//   it (a menu, a dialog, a popover, the command bar) lies over it — two canvas controls over each other among them
//   (AU6-20: the rotation zone over the quick panel's chip);
// - english: in Portuguese, an interface text that is an English catalogue text.
//
// Exceptions are only those of tests/support/screen-guard-allowed.ts, each with its reason and decision. With
// SCREEN_GUARD=report a test's findings are written to .cache/screen-guard/ and never fail it (the triage run); the
// kinds listed in ENFORCED fail the test that leaves them on screen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { ALLOWED } from './screen-guard-allowed.ts';

export type FindingKind = 'cut' | 'wrapped' | 'off-window' | 'covered' | 'english';
export interface Finding {
  readonly kind: FindingKind;
  readonly text: string;
  readonly where: string;
  readonly box: readonly [number, number, number, number];
}

export const SCREEN_GUARD_DIR = path.join('.cache', 'screen-guard');
export const MODE: 'report' | 'enforce' = process.env.SCREEN_GUARD === 'report' ? 'report' : 'enforce';
// the kinds that fail a test; the others are reported until their triage is done
export const ENFORCED: ReadonlySet<FindingKind> = new Set<FindingKind>([]);

// the English texts of the interface whose Portuguese differs (a CSS value is written as CSS in both: DEC-65)
const catalogue = (locale: string) => JSON.parse(fs.readFileSync(path.join('src', 'i18n', 'locales', `${locale}.json`), 'utf8')) as Record<string, string>;
const en = catalogue('en');
const ptBR = catalogue('pt-BR');
const ENGLISH: readonly string[] = [
  ...new Set(
    Object.entries(en)
      .filter(([key, value]) => ptBR[key] !== undefined && ptBR[key] !== value && !value.includes('{') && /[a-z]{3}/.test(value))
      .map(([, value]) => value.trim()),
  ),
];

// Runs in the editor's page (never inside the canvas's frame): the findings on screen now.
export function screenFindings(input: { readonly english: readonly string[] | null; readonly allowed: readonly { readonly kind: string; readonly selector: string }[] }): Finding[] {
  const out: Finding[] = [];
  const SHORT_VALUE = 24;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const english = input.english === null ? null : new Set(input.english);
  const allowed = (kind: string, el: Element) => input.allowed.some((rule) => rule.kind === kind && el.closest(rule.selector) !== null);
  // the layers a person opens over the editor, which cover what lies under them on purpose until they close: the open
  // quick panel stands over the selection's handles (canvas-editing.css, DEC-75)
  const LAYERS = '.quick-panel,[role=menu],[role=dialog],[role=alertdialog],[role=listbox],[role=tooltip],.popover,.menu,.command-bar,[data-region=toast],[data-region=command-palette],.floating,.panel-window,[data-drag-ghost],.chrome-ghost-stack,.backdrop,[class*="backdrop"]';
  const style = (el: Element) => getComputedStyle(el);
  const shown = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const s = style(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const ps = style(p);
      if (Number(ps.opacity) === 0 || ps.visibility === 'hidden') return null;
    }
    return r;
  };
  // the part of a box a person sees: clipped by every ancestor that clips, up to a fixed layer
  const seen = (el: Element, r: DOMRect): [number, number, number, number] | null => {
    let [l, t, ri, b] = [r.left, r.top, r.right, r.bottom];
    for (let p = el.parentElement; p !== null && p !== document.documentElement; p = p.parentElement) {
      const s = style(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
        const pr = p.getBoundingClientRect();
        if (s.overflowX !== 'visible') {
          l = Math.max(l, pr.left);
          ri = Math.min(ri, pr.right);
        }
        if (s.overflowY !== 'visible') {
          t = Math.max(t, pr.top);
          b = Math.min(b, pr.bottom);
        }
      }
      if (s.position === 'fixed') break;
    }
    return ri - l < 1 || b - t < 1 ? null : [l, t, ri, b];
  };
  const where = (el: Element): string => {
    const region = el.closest('[data-region]')?.getAttribute('data-region') ?? '';
    const parts: string[] = [];
    let e: Element | null = el;
    for (let i = 0; i < 3 && e !== null && e !== document.body; i += 1, e = e.parentElement) {
      const cls = [...e.classList].slice(0, 2).join('.');
      const door = e.getAttribute('data-door');
      parts.unshift(`${e.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${door ? `[${door}]` : ''}`);
    }
    return `${region} :: ${parts.join(' > ')}`;
  };
  const box = (b: readonly [number, number, number, number]): [number, number, number, number] => [Math.round(b[0]), Math.round(b[1]), Math.round(b[2] - b[0]), Math.round(b[3] - b[1])];
  const rect = (r: DOMRect): [number, number, number, number] => [r.left, r.top, r.right, r.bottom];
  const ownText = (el: Element): string =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  const named = (el: Element, text: string): boolean => {
    // the whole text readable elsewhere: a title or an accessible name on it, or on the control it belongs to
    for (let e: Element | null = el, i = 0; e !== null && i < 4; e = e.parentElement, i += 1) {
      for (const attribute of ['title', 'aria-label']) {
        const value = e.getAttribute(attribute);
        if (value !== null && value.replace(/\s+/g, ' ').includes(text)) return true;
      }
      if (e.hasAttribute('data-door')) break;
    }
    return false;
  };
  const CONTROL = 'button,input:not([type=hidden]),select,textarea,a[href],[data-door],[role=button],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=option],[role=checkbox],[role=radio],[role=switch],[role=slider]';
  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => el.tagName !== 'IFRAME' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.closest('svg') === null && el.closest('.is-measuring,.visually-hidden,[aria-hidden="true"],[inert]') === null,
  );
  for (const el of all) {
    const r = shown(el);
    if (r === null) continue;
    const s = style(el);
    const tag = el.tagName;
    const text = ownText(el);
    const visible = seen(el, r);
    if (visible === null) continue;
    // CUT
    if ((text !== '' || tag === 'INPUT') && tag !== 'TEXTAREA') {
      const clips = s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis';
      if (clips && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 4) {
        const input = tag === 'INPUT' ? (el as HTMLInputElement) : null;
        const value = input === null ? text : input.value || input.placeholder;
        // a short value (a keyword, a number with its unit, a colour, a tag, a font's name) fits its field whole; a
        // longer one (an address, a sentence) scrolls in its field as typed text does, and a field being typed in
        // scrolls with the caret
        const skip = input !== null && (['range', 'checkbox', 'radio', 'color', 'file'].includes(input.type) || document.activeElement === input || value.length > SHORT_VALUE);
        const ellipsisNamed = s.textOverflow === 'ellipsis' && named(el, value);
        if (value !== '' && !skip && !ellipsisNamed && !allowed('cut', el)) out.push({ kind: 'cut', text: value.slice(0, 80), where: where(el), box: box(visible) });
      }
      if (text !== '' && s.whiteSpace === 'normal' && (s.overflowY === 'hidden' || s.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2 && !named(el, text) && !allowed('cut', el)) {
        out.push({ kind: 'cut', text: text.slice(0, 80), where: where(el), box: box(visible) });
      }
    }
    // WRAPPED: a short name of the interface drawn on two lines or more
    if (text.length > 2 && text.length <= 40) {
      const role = el.getAttribute('role') ?? '';
      const name =
        tag === 'BUTTON' ||
        tag === 'LABEL' ||
        tag === 'TH' ||
        tag === 'DT' ||
        ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'button'].includes(role) ||
        /(^|[-_])(label|name|title|head|caption|chip|tab)s?($|[-_])/.test(el.className.toString());
      if (name && el.closest('p,[role=alert],[role=status],.toast,.notice,.hint,.empty,[data-region=assistant]') === null) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        const line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3;
        if (tops.size > 1 && r.height > line * 1.6 && !allowed('wrapped', el)) out.push({ kind: 'wrapped', text: text.slice(0, 80), where: where(el), box: box(visible) });
      }
    }
    if (el.matches(CONTROL)) {
      // OFF-WINDOW
      if ((visible[0] < -1 || visible[1] < -1 || visible[2] > W + 1 || visible[3] > H + 1) && !allowed('off-window', el)) {
        out.push({ kind: 'off-window', text: (text || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-door') || tag).slice(0, 80), where: where(el), box: box(visible) });
      }
      // COVERED: what is seen of it takes no press of its own at most of five points along its length (its centre and
      // four more, so a long grip with a handle at its middle still takes presses, and a strip lying wholly under
      // another control does not)
      const [l, t, ri, b] = visible;
      if (ri - l >= 4 && b - t >= 4 && s.pointerEvents !== 'none' && l >= 0 && t >= 0 && ri <= W && b <= H) {
        const wide = ri - l >= b - t;
        const points = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => (wide ? [l + (ri - l) * f, (t + b) / 2] : [(l + ri) / 2, t + (b - t) * f]) as [number, number]);
        const covering = points.flatMap(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          const own = hit !== null && (el.contains(hit) || hit.contains(el) || (hit as HTMLLabelElement).control === el);
          // a layer opened above (a menu, a dialog, a popover) covers what is under it on purpose, until it closes
          const above = hit !== null && !own && hit.closest(LAYERS) !== null && el.closest(LAYERS) !== hit.closest(LAYERS);
          return hit !== null && !own && !above ? [hit] : [];
        });
        if (covering.length >= 3 && !allowed('covered', el)) {
          out.push({ kind: 'covered', text: `${(text || el.getAttribute('aria-label') || el.getAttribute('data-door') || tag).slice(0, 50)} under ${where(covering[0] as Element)}`, where: where(el), box: box(visible) });
        }
      }
    }
    // ENGLISH
    if (english !== null && text.length > 3 && english.has(text) && !allowed('english', el)) out.push({ kind: 'english', text, where: where(el), box: box(rect(r)) });
  }
  return out;
}

const NOT_FINISHED = new Set(['timedOut', 'interrupted']);

// At the end of a test: the findings of the page it leaves, reported or failing the test.
export async function guardScreen(page: Page, info: TestInfo): Promise<readonly Finding[]> {
  if (page.isClosed() || NOT_FINISHED.has(info.status ?? '')) return [];
  const editor = await page.evaluate(() => '__builderTestPort' in window && document.querySelector('.workbench') !== null).catch(() => false);
  if (!editor) return [];
  // what the test did last is drawn: two frames
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))).catch(() => undefined);
  const portuguese = await page.evaluate(() => document.documentElement.lang === 'pt-BR').catch(() => false);
  const found = await page.evaluate(screenFindings, { english: portuguese ? ENGLISH : null, allowed: ALLOWED.map(({ kind, selector }) => ({ kind, selector })) }).catch(() => [] as Finding[]);
  if (MODE === 'report' && found.length > 0) {
    const test = [path.relative(process.cwd(), info.file).replaceAll('\\', '/'), ...info.titlePath.slice(1)].join(' › ');
    const viewport = page.viewportSize();
    fs.mkdirSync(SCREEN_GUARD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SCREEN_GUARD_DIR, `${crypto.createHash('sha1').update(test).digest('hex')}.json`), JSON.stringify({ test, viewport, portuguese, found }));
  }
  return MODE === 'enforce' ? found.filter((finding) => ENFORCED.has(finding.kind)) : [];
}
