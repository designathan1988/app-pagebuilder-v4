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
// (the complete run of 950f604 left no finding of these two kinds; cut, covered and wrapped have seven open defects of the
// product, PRODUCT.md RC-02, and fail tests once those are fixed)
export const ENFORCED: ReadonlySet<FindingKind> = new Set<FindingKind>(['off-window', 'english']);

// the English texts of the interface whose Portuguese differs (a CSS value is written as CSS in both: DEC-65)
const catalogue = (locale: string) => JSON.parse(fs.readFileSync(path.join('src', 'i18n', 'locales', `${locale}.json`), 'utf8')) as Record<string, string>;
const en = catalogue('en');
const ptBR = catalogue('pt-BR');
// a word that is the Portuguese text of some key is Portuguese too ("Canvas" names the canvas element in both, and is the
// English of the canvas view, "Tela")
const PORTUGUESE = new Set(Object.values(ptBR).map((value) => value.trim()));
const ENGLISH: readonly string[] = [
  ...new Set(
    Object.entries(en)
      .filter(([key, value]) => ptBR[key] !== undefined && ptBR[key] !== value && !value.includes('{') && /[a-z]{3}/.test(value))
      .map(([, value]) => value.trim())
      .filter((value) => !PORTUGUESE.has(value)),
  ),
];

// Runs in the editor's page (never inside the canvas's frame): the findings on screen now.
export function screenFindings(input: { readonly english: readonly string[] | null; readonly allowed: readonly { readonly kind: string; readonly selector: string }[]; readonly project?: readonly string[] }): Finding[] {
  const out: Finding[] = [];
  const SHORT_VALUE = 24;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const english = input.english === null ? null : new Set(input.english);
  // the texts the project itself holds (its names, tags, classes, words): the person's, never the interface's
  const project = new Set(input.project ?? []);
  const allowed = (kind: string, el: Element) => input.allowed.some((rule) => rule.kind === kind && el.closest(rule.selector) !== null);
  // the layers a person opens over the editor, which cover what lies under them on purpose until they close, by their
  // roles (WAI-ARIA: a menu, a listbox, a dialog, a tooltip), the editor's own floating surfaces (a popover, a floating
  // panel window, the open quick panel over the selection's handles: canvas-editing.css, DEC-75, a drag's ghost), and
  // any surface fixed over the whole window (a dialog's shield, a menu's backdrop)
  const LAYERS = '.quick-panel,[role=menu],[role=dialog],[role=alertdialog],[role=listbox],[role=tooltip],.popover,.menu,.command-bar,[data-region=toast],.floating,.panel-window,[data-drag-ghost],.chrome-ghost-stack';
  // a surface fixed over the whole window that the hit belongs to and the control does not (a dialog's shield lies over
  // the editor, never over what the dialog itself holds)
  const shield = (hit: Element, under: Element): boolean => {
    for (let e: Element | null = hit; e !== null && e !== document.body; e = e.parentElement) {
      const b = e.getBoundingClientRect();
      if (style(e).position === 'fixed' && b.width * b.height >= 0.9 * W * H) return !e.contains(under);
    }
    return false;
  };
  // a modal dialog open (aria-modal: what lies outside it is inert, WAI-ARIA): only what is inside it must take presses
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter((m) => m.getClientRects().length > 0).at(-1) ?? null;
  const style = (el: Element) => getComputedStyle(el);
  // The window's layers, by the editor's own scale (design/final/tokens.json, z: toast, floating, menu, dialog…): a
  // surface placed at one of them floats over the editor — a floating panel, the narrow window's sidebar opened over
  // the canvas, a toast — and covers what lies under it on purpose
  const floatsFrom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z-toast')) || 40;
  const windowLayer = (e: Element | null): Element | null => {
    for (let x = e; x !== null && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && Number.parseInt(cs.zIndex, 10) >= floatsFrom) return x;
    }
    return null;
  };
  // a value written as CSS writes it, in the code face (DEC-65), and a key's name (kbd) are no interface text
  const codeFace = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const shown = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const s = style(el);
    // clipped to nothing (a text kept for screen readers alone: clip-path inset(50%), or a clip of zero area) is unseen
    const clippedAway = (cs: CSSStyleDeclaration) => /inset\(50%/.test(cs.clipPath) || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0 || clippedAway(s)) return null;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const ps = style(p);
      if (Number(ps.opacity) === 0 || ps.visibility === 'hidden' || clippedAway(ps)) return null;
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
    (el) => el.tagName !== 'IFRAME' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.closest('svg') === null && el.closest('.is-measuring,.visually-hidden,[aria-hidden="true"],[inert],[data-test-harness]') === null,
  );
  for (const el of all) {
    const r = shown(el);
    if (r === null) continue;
    const s = style(el);
    const tag = el.tagName;
    const text = ownText(el);
    const visible = seen(el, r);
    if (visible === null) continue;
    // CUT — of a text a person sees: one drawn in a transparent colour is not (a field at rest draws its value in its
    // face, field-face.tsx, over its input's own text made transparent: the face is what is read)
    const unseen = /^rgba\(.*,\s*0\)$|^transparent$/.test(s.color);
    if ((text !== '' || tag === 'INPUT') && tag !== 'TEXTAREA' && !unseen) {
      const clips = s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis';
      if (clips && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 4) {
        const input = tag === 'INPUT' ? (el as HTMLInputElement) : null;
        const value = input === null ? text : input.value || input.placeholder;
        // a number fits its field whole (a value field shows its face over a transparent input: field-face.tsx); a
        // field of free text (a cell of a data table, a CSS declaration, an address) scrolls its text as any text
        // field does, and a field being typed in scrolls with the caret
        const numeric = input !== null && (input.type === 'number' || input.getAttribute('role') === 'spinbutton');
        const skip = input !== null && (!numeric || document.activeElement === input || value.length > SHORT_VALUE);
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
      // a name drawn to take more than one line on purpose (a line clamp: a palette tile's two lines) is not wrapped
      const clamped = s.getPropertyValue('-webkit-line-clamp') !== '' && s.getPropertyValue('-webkit-line-clamp') !== 'none';
      if (name && !clamped && el.closest('p,[role=alert],[role=status],.toast,.notice,.hint,.empty,[data-region=assistant]') === null) {
        // the lines of its own text only: a label holding its field (a grid of the name over the input) has the field's
        // box below the name, which is no second line of the name
        const tops = new Set(
          [...el.childNodes]
            .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
            .flatMap((n) => {
              const range = document.createRange();
              range.selectNodeContents(n);
              return [...range.getClientRects()];
            })
            .filter((q) => q.width > 0)
            .map((q) => Math.round(q.top)),
        );
        if (tops.size > 1 && !allowed('wrapped', el)) out.push({ kind: 'wrapped', text: text.slice(0, 80), where: where(el), box: box(visible) });
      }
    }
    if (el.matches(CONTROL) && (modal === null || modal.contains(el))) {
      // OFF-WINDOW
      if ((visible[0] < -1 || visible[1] < -1 || visible[2] > W + 1 || visible[3] > H + 1) && !allowed('off-window', el)) {
        out.push({ kind: 'off-window', text: (text || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-door') || tag).slice(0, 80), where: where(el), box: box(visible) });
      }
      // COVERED: what is seen of it takes no press of its own at most of five points along its length (its centre and
      // four more, so a long grip with a handle at its middle still takes presses, and a strip lying wholly under
      // another control does not)
      // only a control at least half in sight: one a scroller holds mostly out of view is the scroller's to bring back
      const [l, t, ri, b] = visible;
      const inSight = ri - l >= r.width / 2 && b - t >= r.height / 2;
      if (inSight && ri - l >= 4 && b - t >= 4 && s.pointerEvents !== 'none' && l >= 0 && t >= 0 && ri <= W && b <= H) {
        const wide = ri - l >= b - t;
        const points = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => (wide ? [l + (ri - l) * f, (t + b) / 2] : [(l + ri) / 2, t + (b - t) * f]) as [number, number]);
        const covering = points.flatMap(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          const own = hit !== null && (el.contains(hit) || hit.contains(el) || (hit as HTMLLabelElement).control === el);
          // a layer opened above (a menu, a dialog, a popover) covers what is under it on purpose, until it closes
          const above = hit !== null && !own && ((hit.closest(LAYERS) !== null && el.closest(LAYERS) !== hit.closest(LAYERS)) || (windowLayer(hit) !== null && windowLayer(hit) !== windowLayer(el)) || shield(hit, el));
          // what a test mounts over the editor for its own proof (data-test-harness) is no part of the screen
          const harness = hit !== null && hit.closest('[data-test-harness]') !== null;
          return hit !== null && !own && !above && !harness ? [hit] : [];
        });
        if (covering.length >= 3 && !allowed('covered', el)) {
          out.push({ kind: 'covered', text: `${(text || el.getAttribute('aria-label') || el.getAttribute('data-door') || tag).slice(0, 50)} under ${where(covering[0] as Element)}`, where: where(el), box: box(visible) });
        }
      }
    }
    // ENGLISH
    const code = tag === 'KBD' || el.closest('kbd') !== null || (codeFace !== '' && s.fontFamily === codeFace);
    if (english !== null && text.length > 3 && english.has(text) && !project.has(text) && !code && !allowed('english', el)) out.push({ kind: 'english', text, where: where(el), box: box(rect(r)) });
  }
  return out;
}

const NOT_FINISHED = new Set(['timedOut', 'interrupted']);

// At the end of a test: the findings of the page it leaves, reported or failing the test.
// `step` names a screen a test checks on its way (screen-sweep.spec.ts: each surface it opens), its findings kept apart
export async function guardScreen(page: Page, info: TestInfo, step = ''): Promise<readonly Finding[]> {
  if (page.isClosed() || NOT_FINISHED.has(info.status ?? '')) return [];
  const editor = await page.evaluate(() => '__builderTestPort' in window && document.querySelector('.workbench') !== null).catch(() => false);
  if (!editor) return [];
  // the screen once it is still, as Playwright's screenshot assertion waits for two equal pictures: what the test did last
  // is drawn and the editor's own placing (the chrome's arrangement, a panel's place) has settled — three frames with
  // nothing changed in the page, at most twenty (a screen that animates on its own is read as it stands then)
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          let changed = false;
          let quiet = 0;
          let frames = 0;
          const seen = new MutationObserver(() => {
            changed = true;
          });
          seen.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
          const tick = () => {
            frames += 1;
            quiet = changed ? 0 : quiet + 1;
            changed = false;
            if (quiet >= 3 || frames >= 20) {
              seen.disconnect();
              resolve();
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    )
    .catch(() => undefined);
  const portuguese = await page.evaluate(() => document.documentElement.lang === 'pt-BR').catch(() => false);
  // every text the project holds, read from the document through the test port (names, tags, classes, the words of its
  // texts): shown in a Portuguese editor, they are the person's own words, whatever their language
  const project = portuguese
    ? await page
        .evaluate(() => {
          const held = new Set<string>();
          const walk = (value: unknown): void => {
            if (typeof value === 'string') held.add(value.replace(/\s+/g, ' ').trim());
            else if (Array.isArray(value)) value.forEach(walk);
            else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
          };
          walk((window as unknown as { __builderTestPort?: { document: () => unknown } }).__builderTestPort?.document());
          return [...held];
        })
        .catch(() => [] as string[])
    : [];
  const found = await page.evaluate(screenFindings, { english: portuguese ? ENGLISH : null, allowed: ALLOWED.map(({ kind, selector }) => ({ kind, selector })), project }).catch(() => [] as Finding[]);
  if (MODE === 'report' && found.length > 0) {
    const test = [path.relative(process.cwd(), info.file).replaceAll('\\', '/'), ...info.titlePath.slice(1), ...(step === '' ? [] : [step])].join(' › ');
    const viewport = page.viewportSize();
    fs.mkdirSync(SCREEN_GUARD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SCREEN_GUARD_DIR, `${crypto.createHash('sha1').update(test).digest('hex')}.json`), JSON.stringify({ test, viewport, portuguese, found }));
  }
  return MODE === 'enforce' ? found.filter((finding) => ENFORCED.has(finding.kind)) : [];
}
