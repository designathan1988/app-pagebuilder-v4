// The command bar (PRODUCT.md §5; spec command-bar; PRODUCT.md §5.3 `command-palette`): commandBar.open shows it and
// ui.dismiss closes it (menus/overlays.ts). What it offers is the manifest's command-bar doors, one entry per door, but
// an insert door gives one entry per palette entry and an open-panel door one per panel the shell draws a body for;
// commands first, then insert, open panel, set property and edit property, each group in the order of the command
// files. An entry is offered only while its door is built and its command can run on the selection. The query filters
// and ranks them (matchScore): each word of the query matches a word of the label from its start, anywhere in it, the
// initials of its words; the recently run entries come first while the query is empty.
import { registerHandler } from '../../core/commands/registry.ts';
import { functionsOf } from '../../core/style/functions.ts';
import { fold } from '../../core/text/fold.ts';
import type { DoorId } from '../../generated/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { TEXTY_ARG_TYPES } from '../../manifest/schema.ts';
import type { EditorUi } from '../state.ts';

export const openCommandBar = registerHandler<'commandBar.open', EditorUi>('commandBar.open', ({ state }) => (state.ui.commandBar === true ? { kind: 'change' } : { kind: 'change', ui: { ...state.ui, commandBar: true } }));

const constant = (id: string): number => {
  const value = manifest.interactions.constants.find((c) => c.id === id)?.value;
  if (typeof value !== 'number') throw new Error(`interactions.json has no number ${id}`);
  return value;
};
export const MAX_RESULTS = constant('commandBar.maxResults');
const RECENT_COUNT = constant('commandBar.recentCount');

export type EntryKind = 'command' | 'insert' | 'open-panel' | 'set-property' | 'edit-property' | 'go-to-page' | 'select-layer' | 'apply-class';
const KIND_ORDER: readonly EntryKind[] = ['command', 'insert', 'open-panel', 'set-property', 'edit-property', 'go-to-page', 'select-layer', 'apply-class'];
// a scope typed before the query keeps one kind of entry (PRODUCT.md §5.3: Commands >, Insert +, Panels /, Properties
// #) and @ the project's own things: its pages to go to, the open page's layers to select, its classes to apply (J12)
const SCOPES: Readonly<Record<string, readonly EntryKind[]>> = { '>': ['command'], '+': ['insert'], '/': ['open-panel'], '#': ['set-property', 'edit-property'], '@': ['go-to-page', 'select-layer', 'apply-class'] };
// the title of the group an entry is listed under (the canonical palette: Commands, Panels), by the scope that keeps it
const GROUP_TITLES: Readonly<Record<string, string>> = { '>': 'commandBar.group.commands', '+': 'commandBar.group.insert', '/': 'commandBar.group.panels', '#': 'commandBar.group.properties', '@': 'commandBar.group.find' };
function groupTitleOf(kind: EntryKind): string {
  const prefix = Object.entries(SCOPES).find(([, kinds]) => kinds.includes(kind))?.[0] ?? '>';
  return GROUP_TITLES[prefix] ?? 'commandBar.group.commands';
}
// The entries shown, under their groups: each group where its best entry stands, its entries in the order shown, so
// the first entry stays the best match (the one Enter runs).
export function groupedEntries<T extends { readonly entry: DoorEntry }>(shown: readonly T[]): readonly { readonly title: string; readonly entries: readonly T[] }[] {
  const groups: { title: string; entries: T[] }[] = [];
  for (const one of shown) {
    const title = groupTitleOf(kindOf(one.entry));
    const group = groups.find((g) => g.title === title);
    if (group === undefined) groups.push({ title, entries: [one] });
    else group.entries.push(one);
  }
  return groups;
}
// the scopes as the bar's pills name them (the canonical palette's scope pills), All first: no prefix
export const SCOPE_PILLS: readonly { readonly prefix: string; readonly labelKey: string }[] = [
  { prefix: '', labelKey: 'commandBar.scope.all' },
  { prefix: '>', labelKey: 'commandBar.scope.commands' },
  { prefix: '+', labelKey: 'commandBar.scope.insert' },
  { prefix: '/', labelKey: 'commandBar.scope.panels' },
  { prefix: '#', labelKey: 'commandBar.scope.properties' },
  { prefix: '@', labelKey: 'commandBar.scope.find' },
];
// the scope a query is in (its prefix, '' for All), and its words
export function scopeOf(query: string): { readonly prefix: string; readonly words: string } {
  const trimmed = query.trimStart();
  const first = trimmed.charAt(0);
  return SCOPES[first] !== undefined ? { prefix: first, words: trimmed.slice(1) } : { prefix: '', words: trimmed };
}

// the command-bar doors, grouped by kind in the bar's order, each group in the order of the command files
export const BAR_DOORS: readonly DoorEntry[] = KIND_ORDER.flatMap((kind) => manifest.doors.filter((d) => d.door.kind === 'command-bar' && d.door.entry === kind));
export const kindOf = (entry: DoorEntry): EntryKind => (entry.door.kind === 'command-bar' ? entry.door.entry : 'command');

// An entry the bar can list: its door, the arguments the entry adds to the door's, and its label as shown.
export interface BarEntry {
  readonly entry: DoorEntry;
  readonly args: Readonly<Record<string, unknown>>;
  readonly label: string;
  readonly key: string;
}
export const entryKey = (entry: DoorEntry, args: Readonly<Record<string, unknown>>): string => `${entry.ref} ${JSON.stringify(args)}`;

// the words of a text as matched (core/text/fold.ts: lower case, without accents)
const wordsOf = (text: string): string[] => fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

// How well a query matches a label: null when a word of the query matches nothing; higher is better. The words of the
// query match in any order ("hero insert" finds "Insert Hero"), each from the start of a word of the label ("ins"),
// anywhere in the label, or as the initials of its words ("wiar" finds "Wrap in a row").
export function matchScore(query: string, label: string): number | null {
  const words = wordsOf(query);
  if (words.length === 0) return 0;
  const labelWords = wordsOf(label);
  const text = labelWords.join(' ');
  const initials = labelWords.map((w) => w[0] ?? '').join('');
  let score = 0;
  for (const word of words) {
    if (labelWords.some((w) => w.startsWith(word))) score += 4;
    else if (text.includes(word)) score += 3;
    else if (word.length > 1 && initials.includes(word)) score += 2;
    else return null;
  }
  // the label that starts as the query does comes first
  const first = words[0];
  return first !== undefined && text.startsWith(first) ? score + 1 : score;
}

// The parts of a label the query's words match, as the bar marks them (the canonical palette: "Exp" of "Export
// project"):
// each word where matchScore found it, at the start of a word of the label, else anywhere in it; initials and a label
// whose folded text does not keep its length mark nothing. Ranges in the label's own characters, sorted, never
// overlapping.
export function matchedRanges(query: string, label: string): readonly (readonly [number, number])[] {
  const folded = fold(label);
  if (folded.length !== label.length) return [];
  const ranges: [number, number][] = [];
  for (const word of wordsOf(scopeOf(query).words)) {
    // a word holds letters and digits only (wordsOf): the first place it starts a word of the label, else the first
    let at = -1;
    for (let from = folded.indexOf(word); from >= 0; from = folded.indexOf(word, from + 1)) {
      if (from === 0 || !/[\p{L}\p{N}]/u.test(folded.charAt(from - 1))) {
        at = from;
        break;
      }
    }
    if (at < 0) at = folded.indexOf(word);
    if (at >= 0) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce<[number, number][]>((kept, range) => {
    const last = kept[kept.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else kept.push([range[0], range[1]]);
    return kept;
  }, []);
}

// The entries a query shows, at most MAX_RESULTS: a scope prefix keeps its kind; with no words, the recently run
// entries (newest first) before the others in the bar's order; otherwise the best matches, ties in the bar's order.
export function shownEntries(query: string, offered: readonly BarEntry[], recent: readonly string[]): BarEntry[] {
  const trimmed = query.trimStart();
  const scope = SCOPES[trimmed.charAt(0)];
  const pool = scope ? offered.filter((e) => scope.includes(kindOf(e.entry))) : offered;
  const words = scope ? trimmed.slice(1) : trimmed;
  if (wordsOf(words).length === 0) {
    const first = recent.slice(0, RECENT_COUNT).flatMap((key) => pool.filter((e) => e.key === key));
    return [...first, ...pool.filter((e) => !first.includes(e))].slice(0, MAX_RESULTS);
  }
  return pool
    .flatMap((e, index) => {
      const score = matchScore(words, e.label);
      return score === null ? [] : [{ e, score, index }];
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ e }) => e);
}

// The properties and composites the manifest declares (spec command-bar-set-property): a query naming one offers to
// set it, and every one of them can be revealed in the inspector by its CSS name. The list is the manifest's own data
// (properties.json), so a property it gains is offered at once.
export interface NamedProperty {
  readonly id: string;
  readonly labelKey: string;
  readonly doors: readonly string[];
}
export function namedProperties(): readonly NamedProperty[] {
  const properties = manifest.properties.properties as readonly { readonly id: string; readonly labelKey: string; readonly doors: readonly string[] }[];
  const composites = manifest.properties.composites as readonly { readonly id: string; readonly labelKey: string; readonly doors: readonly string[] }[];
  return [...properties, ...composites].map((one) => ({ id: one.id, labelKey: one.labelKey, doors: one.doors }));
}

// The composite a property belongs to: its own record when it is one, else the one whose longhands name it
// (properties.json); null for a property no composite holds.
function compositeOf(id: string): (typeof manifest.properties.composites)[number] | null {
  const composites = manifest.properties.composites;
  return composites.find((one) => one.id === id) ?? composites.find((one) => (one.longhands as readonly string[]).includes(id)) ?? null;
}
// The side a border or spacing property names, in the writer's own words: the segment of its name the writer offers
// as a side ('padding-top' and 'border-top-color' → top; 'padding' and 'border-color' name no side → all, the whole
// shape).
const sideOf = (id: string, sides: readonly string[]): string => id.split('-').find((part, at) => at > 0 && sides.includes(part)) ?? 'all';
// the corner of a radius longhand ('border-top-left-radius' → 'top-left'), 'all' for the whole shape
const cornerOf = (id: string): string => (id === 'border-radius' ? 'all' : id.replace(/^border-/, '').replace(/-radius$/, ''));

// The arguments that carry the typed text into a writer, read from the writer's own arguments: the value argument it
// declares, or — for a writer whose value is a list of functions or parts (filters, transforms) — the map those
// functions make, read by the parser that owns them, or — for a writer of shadow layers — the CSS text as its own CSS
// field hands it. null when the writer takes a shape no text can be typed into.
function valueArgsOf(command: DoorEntry['command'], property: NamedProperty, text: string, filled: ReadonlySet<string>): Readonly<Record<string, unknown>> | null {
  const args = command.args as Readonly<Record<string, { readonly type: string }>>;
  if (args.value?.type === 'string' || args.value?.type === 'json') return { value: text };
  const list = args.parts !== undefined || args.functions !== undefined ? functionsOf(text) : null;
  if (list !== null && list.length > 0) {
    const map = Object.fromEntries(list.map((one) => [one.name, one.argument]));
    return args.parts !== undefined ? { parts: map } : { functions: map };
  }
  if (args.edit !== undefined) return { edit: { css: text } };
  // A text argument the command declares and no composite argument fills: the one named after the property's own part
  // (a border's width, its style, its colour), else the single one its declaration leaves open (a position's mode).
  const texty = (type: string): boolean => (TEXTY_ARG_TYPES as readonly string[]).includes(type);
  const part = property.id.slice(property.id.lastIndexOf('-') + 1);
  if (args[part] !== undefined && texty(args[part].type) && !filled.has(part)) return { [part]: text };
  const open = Object.entries(args).filter(([name, arg]) => name !== 'property' && !filled.has(name) && texty(arg.type));
  return open.length === 1 ? { [open[0]?.[0] ?? '']: text } : null;
}

// The set entry a property and a text make (spec command-bar-set-property): the write runs through the writer the
// property's own doors name, with the arguments that writer's shape needs — the property, the text, and the composite
// arguments the manifest declares (a box, a side, a corner) — so the entry holds no rule of its own: what is offered
// is what the manifest says that writer takes. null when the manifest names no writer that takes this text.
export function setEntryFor(property: NamedProperty, text: string): { readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>> } | null {
  for (const ref of property.doors) {
    const door = manifest.doorByRef.get(ref as DoorId);
    if (door === undefined) continue;
    const bar = BAR_DOORS.find((one) => one.command.id === door.command.id && kindOf(one) === 'set-property');
    if (bar === undefined) continue;
    const declared = door.command.args as Readonly<Record<string, unknown>>;
    const composite = compositeOf(property.id);
    const args: Record<string, unknown> = {};
    if (Object.hasOwn(declared, 'property')) args.property = property.id;
    if (Object.hasOwn(declared, 'box')) args.box = composite?.id ?? null;
    if (Object.hasOwn(declared, 'sides')) args.sides = sideOf(property.id, (declared.sides as { readonly values?: readonly string[] }).values ?? []);
    if (Object.hasOwn(declared, 'corners')) args.corners = cornerOf(property.id);
    const value = valueArgsOf(door.command, property, text, new Set(Object.keys(args)));
    if (value === null) continue;
    return { entry: bar, args: { ...args, ...value } };
  }
  return null;
}

// A query of the form "<name> <value>" (the spec's own rule: a lower-case kebab-case name, a space, then anything):
// what it names and what it gives. The label the bar itself shows ("Set gap to 24px") is the same query — what a
// person reads in the list can be typed back — and anything else is no set query.
export function askedSet(query: string): { readonly name: string; readonly value: string } | null {
  const trimmed = query.trim();
  const plain = /^([a-z][a-z-]*)\s+(\S.*)$/.exec(trimmed);
  if (plain !== null) return { name: (plain[1] ?? '').toLowerCase(), value: (plain[2] ?? '').trim() };
  const shown = /^set\s+(.+?)\s+to\s+(\S.*)$/i.exec(trimmed);
  return shown === null ? null : { name: (shown[1] ?? '').toLowerCase(), value: (shown[2] ?? '').trim() };
}

// The entries run from the bar in this session, the newest first: a view's memory, like a menu's open item, not the
// editor's state (nothing else reads it).
const ran: string[] = [];
export const recentEntries = (): readonly string[] => ran;
export function remember(key: string): void {
  const at = ran.indexOf(key);
  if (at >= 0) ran.splice(at, 1);
  ran.unshift(key);
  ran.length = Math.min(ran.length, RECENT_COUNT);
}
