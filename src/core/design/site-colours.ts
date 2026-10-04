// The colours the site uses, and changing one everywhere at once (the plan's stage 7, "achar usos e trocar no site";
// journey C1: a rebrand was a hunt through every element). The one owner of:
//  - siteColoursOf: every colour a style value of the project names — an element's own styles on every page, a class's,
//    a component's tree — with how many values name it, the most used first. A colour is a hex colour (#rgb, #rrggbb,
//    with alpha too) or an rgb()/rgba() written as the whole value; it is compared as lowercase #rrggbb(aa), so #FFF
//    and #ffffff and rgb(255, 255, 255) are one colour. A value naming a variable is the variable's, not a colour's.
//  - design.replaceColour: every value naming the colour names another one, in one undo step;
//  - design.colourToVariable: a colour variable is made with that colour and every value that is the colour names the
//    variable instead (var(--name)), in one undo step — the rebrand is then one change of the variable.
import { message, registerHandler, type HandlerContext, type Message, type Outcome } from '../commands/registry.ts';
import type { DocNode, DocumentJson, NodeId, StoredValue } from '../document/model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import type { Patch } from '../history/transaction.ts';
import { readValue } from '../style/set.ts';
import { IDENTIFIER_SOURCE } from '../text/identifier.ts';
import { probeOf, timelineTexts, tokensOf } from './tokens.ts';

type Path = readonly (string | number)[];

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;
const two = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// A colour's one spelling: lowercase #rrggbb, with its alpha as a fourth pair when it is not opaque; null for a text
// that is no colour of these forms.
export function colourKey(text: string): string | null {
  const t = text.trim();
  if (/^#[0-9a-f]+$/i.test(t)) {
    const h = t.slice(1).toLowerCase();
    if (h.length === 3 || h.length === 4) return colourKey(`#${[...h].map((c) => c + c).join('')}`);
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) return h.endsWith('ff') ? `#${h.slice(0, 6)}` : `#${h}`;
    return null;
  }
  const rgb = RGB.exec(t);
  if (rgb === null) return null;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
  const raw = rgb[4];
  const alpha = raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return `#${two(r)}${two(g)}${two(b)}${alpha >= 1 ? '' : two(alpha * 255)}`;
}

// the colours one text names: the whole text when it is one colour, else every hex colour written in it (a border's
// "1px solid #e5e7eb")
function coloursIn(text: string): readonly string[] {
  if (new RegExp(`var\\(\\s*--${IDENTIFIER_SOURCE}`, 'u').test(text)) return [];
  const whole = colourKey(text);
  if (whole !== null) return [whole];
  return [...text.matchAll(HEX)].flatMap((m) => colourKey(m[0]) ?? []);
}

// the text with every spelling of the colour replaced
function replacedIn(text: string, colour: string, next: string): string {
  if (colourKey(text) === colour) return next;
  return text.replace(HEX, (found) => (colourKey(found) === colour ? next : found));
}

const texts = (value: StoredValue): readonly string[] =>
  typeof value === 'string' ? [value] : value.flatMap((layer) => Object.values(layer).filter((field): field is string => typeof field === 'string'));

function replacedValue(value: StoredValue, colour: string, next: string): StoredValue {
  if (typeof value === 'string') return replacedIn(value, colour, next);
  return value.map((layer) => Object.fromEntries(Object.entries(layer).map(([field, held]) => [field, typeof held === 'string' ? replacedIn(held, colour, next) : held])));
}

// One style value of the project and where it lives.
interface Held {
  readonly path: Path;
  readonly value: StoredValue;
}

// every style value of one styles object (breakpoint → state → declarations)
function valuesInStyles(styles: DocNode['styles'] | undefined, base: Path, into: Held[]): void {
  for (const [breakpoint, states] of Object.entries(styles ?? {})) {
    for (const [state, declarations] of Object.entries(states ?? {})) {
      for (const [property, value] of Object.entries((declarations ?? {}) as Record<string, StoredValue | undefined>)) {
        if (value !== undefined) into.push({ path: [...base, breakpoint, state, property], value });
      }
    }
  }
}

function valuesInTree(node: DocNode, base: Path, into: Held[]): void {
  valuesInStyles(node.styles, [...base, 'styles'], into);
  // the element's own animations: their keyframes' declarations are colours of the site too (the audit's SV1)
  (node.animations ?? []).forEach((animation, a) => animation.keyframes.forEach((frame, k) => {
    for (const [property, value] of Object.entries(frame.declarations as Record<string, StoredValue | undefined>)) if (value !== undefined) into.push({ path: [...base, 'animations', a, 'keyframes', k, 'declarations', property], value });
  }));
  node.children.forEach((child, i) => valuesInTree(child, [...base, 'children', i], into));
}

// every style value of the project: the pages' elements, the classes, the components' trees
function styleValues(document: DocumentJson): readonly Held[] {
  const found: Held[] = [];
  document.pages.forEach((page, index) => valuesInTree(page.tree, ['pages', index, 'tree'], found));
  (document.classes ?? []).forEach((styleClass, index) => valuesInStyles(styleClass.styles, ['classes', index, 'styles'], found));
  (document.components ?? []).forEach((definition, index) => valuesInTree(definition.tree, ['components', index, 'tree'], found));
  // the motion timelines' CSS texts (SV1)
  for (const { path, value } of timelineTexts(document)) found.push({ path, value });
  return found;
}

export interface SiteColour {
  readonly colour: string;
  readonly uses: number;
}

// the colours the site uses, the most used first (then in the order first met)
export function siteColoursOf(document: DocumentJson): readonly SiteColour[] {
  const counts = new Map<string, number>();
  for (const held of styleValues(document)) {
    for (const colour of new Set(texts(held.value).flatMap(coloursIn))) counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  return [...counts.entries()].map(([colour, uses]) => ({ colour, uses })).sort((a, b) => b.uses - a.uses);
}

// the patches that make every value naming the colour name `next`; `whole`: only the values that are the colour (a
// variable stands for a whole value: inside a border written whole it would read otherwise)
// The lock over the elements these patches change (an element's own style value; a class or a component holds none),
// or null: a site-wide replace leaves a locked element as it is, so it refuses naming the lock (the audit's LK1).
function lockedBy(document: DocumentJson, patches: readonly Patch[]): Message | null {
  for (const patch of patches) {
    if (patch.path[0] !== 'pages') continue;
    let node: DocNode | undefined = document.pages[patch.path[1] as number]?.tree;
    for (let at = 3; node !== undefined && patch.path[at] === 'children'; at += 2) node = node.children[patch.path[at + 1] as number];
    const refused = node === undefined ? null : lockRefusal(document, node.id as NodeId, 'status.locked.edit');
    if (refused !== null) return refused;
  }
  return null;
}

function replacing(document: DocumentJson, colour: string, next: string, whole = false): readonly Patch[] {
  return styleValues(document).flatMap((held): Patch[] => {
    if (whole) return typeof held.value === 'string' && colourKey(held.value) === colour ? [{ op: 'replace', path: [...held.path], value: next }] : [];
    if (!texts(held.value).some((text) => coloursIn(text).includes(colour))) return [];
    return [{ op: 'replace', path: [...held.path], value: replacedValue(held.value, colour, next) }];
  });
}

function knownColour<Ui>(context: HandlerContext<Ui>, typed: string): string | null {
  const key = colourKey(typed);
  if (key === null || !siteColoursOf(context.state.document).some((one) => one.colour === key)) return null;
  return key;
}

export const replaceColourCommand = registerHandler('design.replaceColour', (context, { colour, value }): Outcome<never> => {
  const from = knownColour(context, colour);
  if (from === null) return { kind: 'refused', message: message('status.siteColours.notUsed', { colour }) };
  const next = value.trim();
  // a colour the browser takes, or a variable of the project (var(--name), or the name typed bare), read as a colour
  // variable's value is read
  const probe = probeOf(context, COLOUR_KIND);
  const read = probe === null ? null : readValue(context, probe, next);
  if (read === null) return { kind: 'refused', message: message('status.siteColours.invalid', { value: next }) };
  const written = read.css;
  if (colourKey(written) === from) return { kind: 'change' };
  const patches = replacing(context.state.document, from, written);
  const locked = lockedBy(context.state.document, patches);
  if (locked !== null) return { kind: 'refused', message: locked };
  return { kind: 'change', patches, message: message('status.siteColours.replaced', { colour: from, value: written, count: patches.length }) };
});

export const colourToVariableCommand = registerHandler('design.colourToVariable', (context, { colour, name }): Outcome<never> => {
  const { state } = context;
  const from = knownColour(context, colour);
  if (from === null) return { kind: 'refused', message: message('status.siteColours.notUsed', { colour }) };
  const typed = name.trim();
  if (!new RegExp(`^${IDENTIFIER_SOURCE}$`, 'u').test(typed)) return { kind: 'refused', message: message('status.tokens.badName', { name: typed }) };
  if (tokensOf(state.document).some((t) => t.name === typed)) return { kind: 'refused', message: message('status.tokens.nameTaken', { name: typed }) };
  const token = { name: typed, kind: COLOUR_KIND, value: from };
  const held = tokensOf(state.document);
  const made: Patch = state.document.tokens === undefined ? { op: 'add', path: ['tokens'], value: [token] } : { op: 'add', path: ['tokens', held.length], value: token };
  const patches = replacing(state.document, from, `var(--${typed})`, true);
  const locked = lockedBy(state.document, patches);
  if (locked !== null) return { kind: 'refused', message: locked };
  return { kind: 'change', patches: [made, ...patches], message: message('status.siteColours.madeVariable', { colour: from, name: typed, count: patches.length }) };
});

// the colour kind of tokens.create (manifest: its kinds are colour, length, font size, in that order)
const [COLOUR_KIND = ''] = 'color length font-size'.split(' ');
