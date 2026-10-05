// Inline markup (PRODUCT.md §5; spec text-inline-formatting): the marks a text element's text may carry, bold
// (<strong>), italic (<em>) and links (<a href>), stored in a node's `inline` beside its plain `text`. The one owner of
// what that tree may hold and of its canonical form, of the address a link may have, of what a change of the marks
// over a range of characters does (Ctrl+B, Ctrl+I, a link's address, a paste), and of how pasted markup reads as
// marked text. Plain data, no DOM: the renderer turns the tree into the page's elements and reads it back.
//
// The tree. A run is a plain string, or a mark around runs: { tag: 'strong' | 'em', children } or
// { tag: 'a', href, children }. A line break is "\n" inside a string, as in `text`. The canonical tree is the one
// every change produces and the one stored: adjacent runs with the same marks are one, empty runs are gone, and the
// marks nest in one order, a link outside, then bold, then italic, so the same marked text is always the same JSON.
// A link is never inside a link: a character has one address at most.
import type { ClipboardContent, ClipboardNode } from '../../generated/commands.ts';
import { readAddress } from '../elements/address.ts';
import type { ContentModel } from '../elements/content-model.ts';

type Mark = 'strong' | 'em';
export type InlineRun =
  | string
  | { readonly tag: Mark; readonly children: readonly InlineRun[] }
  | { readonly tag: 'a'; readonly href: string; readonly children: readonly InlineRun[] };

// A range of characters of a text: from `start` to `end` (end excluded); collapsed where they are equal (a caret).
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

// Reference owners use this traversal when file paths or copied HTML anchors change.
export function mapInlineLinks(runs: readonly InlineRun[], rewrite: (href: string) => string): readonly InlineRun[] {
  const next = runs.map(run => {
    if (typeof run === 'string') return run;
    const children = mapInlineLinks(run.children, rewrite);
    const href = run.tag === 'a' ? rewrite(run.href) : null;
    return children === run.children && (run.tag !== 'a' || href === run.href) ? run : { ...run, children, ...(href === null ? {} : { href }) };
  });
  return next.every((run, i) => run === runs[i]) ? runs : next;
}

// One stretch of characters with the same marks: the flat form every change works on.
export interface Segment {
  readonly text: string;
  readonly strong: boolean;
  readonly em: boolean;
  readonly href: string | null;
}

const PLAIN: Omit<Segment, 'text'> = { strong: false, em: false, href: null };

// The addresses a link may have: the one rule of an address decides (core/elements/address.ts, the audit's A3.2) —
// these two ask it for the text prompt and the paste path, which run before a command sees the value.
export function isSafeHref(href: string): boolean {
  return readAddress(href).ok;
}
// the address a link keeps: what the one rule of an address reads (a bare domain becomes https://), the text as it is
// when the rule refuses it (the caller refuses then) — every address field stores the rule's value (the audit's AD2)
export const keptHref = (href: string): string => {
  const read = readAddress(href);
  return read.ok ? read.value : href;
};

// The marked characters of a tree, in order, empty stretches left out; an inner link's address wins over an outer one.
function segmentsOf(runs: readonly InlineRun[], marks: Omit<Segment, 'text'> = PLAIN): Segment[] {
  const out: Segment[] = [];
  for (const run of runs) {
    if (typeof run === 'string') {
      if (run !== '') out.push({ text: run, ...marks });
    } else if (run.tag === 'a') out.push(...segmentsOf(run.children, { ...marks, href: run.href }));
    else out.push(...segmentsOf(run.children, { ...marks, [run.tag]: true }));
  }
  return out;
}

const sameMarks = (a: Omit<Segment, 'text'>, b: Omit<Segment, 'text'>) => a.strong === b.strong && a.em === b.em && a.href === b.href;

// Adjacent stretches with the same marks as one, empty ones left out.
function merged(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.text === '') continue;
    const last = out.at(-1);
    if (last !== undefined && sameMarks(last, s)) out[out.length - 1] = { ...last, text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

// consecutive items with the same key, in order
function groups<T, K>(items: readonly T[], key: (item: T) => K): { key: K; items: T[] }[] {
  const out: { key: K; items: T[] }[] = [];
  for (const item of items) {
    const k = key(item);
    const last = out.at(-1);
    if (last !== undefined && last.key === k) last.items.push(item);
    else out.push({ key: k, items: [item] });
  }
  return out;
}

// The canonical tree of marked characters: a link outside, then bold, then italic.
export function runsOf(segments: readonly Segment[]): InlineRun[] {
  const italic = (s: readonly Segment[]): InlineRun[] =>
    groups(s, (x) => x.em).map((g) => {
      const text = g.items.map((x) => x.text).join('');
      return g.key ? { tag: 'em' as const, children: [text] } : text;
    });
  const bold = (s: readonly Segment[]): InlineRun[] => groups(s, (x) => x.strong).flatMap((g) => (g.key ? [{ tag: 'strong' as const, children: italic(g.items) }] : italic(g.items)));
  return groups(merged(segments), (x) => x.href).flatMap((g) => (g.key !== null ? [{ tag: 'a' as const, href: g.key, children: bold(g.items) }] : bold(g.items)));
}

export const canonical = (runs: readonly InlineRun[]): InlineRun[] => runsOf(segmentsOf(runs));
export const plainText = (runs: readonly InlineRun[]): string => segmentsOf(runs).map((s) => s.text).join('');
export const hasMarks = (runs: readonly InlineRun[]): boolean => segmentsOf(runs).some((s) => s.strong || s.em || s.href !== null);

// A marked text written anew as plain text (a plain text field, such as the inspector's): the characters the new text
// keeps at its start and at its end keep their marks, and what it changes between them takes the marks around it, as
// a paste does; the same text keeps every mark.
export function withText(runs: readonly InlineRun[], text: string): InlineRun[] {
  const old = plainText(runs);
  if (old === text) return canonical(runs);
  let start = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start += 1;
  let end = 0;
  while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end += 1;
  return applyInlineChange(runs, { start, end: old.length - end }, { kind: 'insert', runs: [text.slice(start, text.length - end)] }).runs;
}

// A tree read from data (text.set's content, a stored node's inline): the tree when it is one, "unsafe" when a link's
// address is not allowed, null when it is not a tree of runs at all.
export function parseInline(value: unknown): InlineRun[] | 'unsafe' | null {
  if (!Array.isArray(value)) return null;
  let unsafe = false;
  const run = (item: unknown): InlineRun | null => {
    if (typeof item === 'string') return item;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const { tag, href, children, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || !Array.isArray(children)) return null;
    const inner = children.map(run);
    if (inner.some((r) => r === null)) return null;
    const kids = inner as InlineRun[];
    if ((tag === 'strong' || tag === 'em') && href === undefined) return { tag, children: kids };
    if (tag === 'a' && typeof href === 'string') {
      if (!isSafeHref(href)) unsafe = true;
      return { tag, href, children: kids };
    }
    return null;
  };
  const runs = value.map(run);
  if (runs.some((r) => r === null)) return null;
  return unsafe ? 'unsafe' : (runs as InlineRun[]);
}

// The characters a word is made of: letters, digits and the joiners inside words
const WORD = /[\p{L}\p{N}\p{M}_'’-]/u;
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);

// The word a caret touches: the one it is in or at the end of, else the one it is at the start of; null between two
// spaces or in an empty text.
export function wordAt(text: string, offset: number): TextRange | null {
  if (!isWord(text[offset - 1]) && !isWord(text[offset])) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end < text.length && isWord(text[end])) end += 1;
  return { start, end };
}

// The segments before, inside and after a range.
function split(segments: readonly Segment[], range: TextRange): { before: Segment[]; inside: Segment[]; after: Segment[] } {
  const before: Segment[] = [];
  const inside: Segment[] = [];
  const after: Segment[] = [];
  let at = 0;
  for (const s of segments) {
    const from = at;
    const to = at + s.text.length;
    at = to;
    const cut = (a: number, b: number) => ({ ...s, text: s.text.slice(Math.max(a, from) - from, Math.min(b, to) - from) });
    if (from < range.start) before.push(cut(from, range.start));
    if (to > range.start && from < range.end) inside.push(cut(range.start, range.end));
    if (to > range.end) after.push(cut(range.end, to));
  }
  return { before: merged(before), inside: merged(inside), after: merged(after) };
}

// the marks of the character at an index, or null past the text
function marksAt(segments: readonly Segment[], index: number): Omit<Segment, 'text'> | null {
  let at = 0;
  for (const s of segments) {
    if (index < at + s.text.length) return { strong: s.strong, em: s.em, href: s.href };
    at += s.text.length;
  }
  return null;
}

// The extent of the link a caret touches (the character before it first), or null when it touches none.
function linkAt(segments: readonly Segment[], offset: number): TextRange | null {
  const touched = [offset - 1, offset].map((i) => (i < 0 ? null : marksAt(segments, i))).find((m) => m?.href != null);
  if (touched == null) return null;
  let at = 0;
  let found: TextRange | null = null;
  for (const s of merged(segments.map((x) => ({ ...x, strong: false, em: false })))) {
    const end = at + s.text.length;
    if (s.href === touched.href && at <= offset && offset <= end && (found === null || at < found.start)) found = { start: at, end };
    at = end;
  }
  return found;
}

// The address of the link a range is in (a caret touching it, or a range whose characters all have one address), or
// null: what the link prompt starts from.
export function linkAddressAt(runs: readonly InlineRun[], range: TextRange): string | null {
  const segments = segmentsOf(runs);
  if (range.start === range.end) {
    const link = linkAt(segments, range.start);
    return link === null ? null : (marksAt(segments, link.start)?.href ?? null);
  }
  const addresses = new Set(split(segments, range).inside.map((s) => s.href));
  const [only] = [...addresses];
  return addresses.size === 1 && only !== undefined ? only : null;
}

// A change of the marks of the text being edited, asked for by a key or the text toolbar: a mark toggled, a link's
// address set (null removes the link), or runs inserted in place of the range (a paste).
export type InlineChange =
  | { readonly kind: 'mark'; readonly mark: Mark }
  | { readonly kind: 'link'; readonly href: string | null }
  | { readonly kind: 'insert'; readonly runs: readonly InlineRun[] };

// A change applied to the runs over a range: the canonical runs after it and the range to select then.
// - A mark toggles over the range only, splitting the runs where the range cuts them (Problems in Pager 2): every
//   character of the range loses it when all of them have it, else they all get it. A caret takes the word it
//   touches; with no word there nothing changes.
// - A link's address goes on every character of the range, replacing any other address (links never nest), or, with
//   none, the characters lose their link. A caret takes the whole link it touches, else the word it touches.
// - Inserted runs replace the range, and the caret follows them; they keep their own marks and take the bold and
//   italic of the character before the range (or after it, at the start), and its link when the range lies inside
//   that link, so a paste in a bold word stays bold.
export function applyInlineChange(runs: readonly InlineRun[], range: TextRange, change: InlineChange): { runs: InlineRun[]; range: TextRange } {
  const segments = segmentsOf(runs);
  const text = segments.map((s) => s.text).join('');
  const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
  const given: TextRange = { start: clamp(Math.min(range.start, range.end)), end: clamp(Math.max(range.start, range.end)) };
  const same = { runs: canonical(runs), range: given };
  if (change.kind === 'insert') {
    const before = marksAt(segments, given.start - 1);
    const after = marksAt(segments, given.end);
    const context = before ?? after ?? PLAIN;
    const insideLink = before !== null && after !== null && before.href !== null && before.href === after.href ? before.href : null;
    const pasted = segmentsOf(change.runs).map((s) => ({ ...s, strong: s.strong || context.strong, em: s.em || context.em, href: s.href ?? insideLink }));
    const parts = split(segments, given);
    const length = pasted.reduce((n, s) => n + s.text.length, 0);
    return { runs: runsOf([...parts.before, ...pasted, ...parts.after]), range: { start: given.start + length, end: given.start + length } };
  }
  const target = given.start !== given.end ? given : change.kind === 'link' ? (linkAt(segments, given.start) ?? wordAt(text, given.start)) : wordAt(text, given.start);
  if (target === null || target.start === target.end) return same;
  const parts = split(segments, target);
  let inside: Segment[];
  if (change.kind === 'mark') {
    const all = parts.inside.every((s) => s[change.mark]);
    inside = parts.inside.map((s) => ({ ...s, [change.mark]: !all }));
  } else inside = parts.inside.map((s) => ({ ...s, href: change.href }));
  return { runs: runsOf([...parts.before, ...inside, ...parts.after]), range: target };
}

// Pasted content as marked text (spec text-inline-formatting, Problems in Pager 3): from its HTML when it has some
// text, else from its plain text. The HTML keeps bold (<strong>, <b>), italic (<em>, <i>) and links whose address is
// allowed; every other element gives its text: an element HTML counts as metadata (a script, a style) gives none, one
// that is not phrasing content (a heading, a paragraph, a list item) stands on lines of its own, a <br> is a line
// break, and an element HTML does not define runs on in the line. Spaces run together as a page shows them.
export function pastedRuns(content: ClipboardContent, model: ContentModel): InlineRun[] {
  if (content.status !== 'read') return [];
  const fromHtml = content.html === null ? [] : htmlSegments(content.html, model);
  if (fromHtml.some((s) => s.text.trim() !== '')) return runsOf(fromHtml);
  const text = (content.text ?? '').replace(/\r\n?/g, '\n');
  return text === '' ? [] : [text];
}

const BREAK = '\n';
function htmlSegments(nodes: readonly ClipboardNode[], model: ContentModel): Segment[] {
  // the pieces in order: marked text, and the boundaries of lines (a <br>, or where an element on its own lines starts
  // or ends)
  const pieces: ({ kind: 'text'; segment: Segment } | { kind: 'break'; hard: boolean })[] = [];
  const walk = (list: readonly ClipboardNode[], marks: Omit<Segment, 'text'>) => {
    for (const node of list) {
      if (typeof node === 'string') {
        pieces.push({ kind: 'text', segment: { text: node.replace(/[ \t\n\r\f]+/g, ' '), ...marks } });
        continue;
      }
      const tag = node.tag.toLowerCase();
      if (model.metadata(tag) === true) continue;
      if (tag === 'br') {
        pieces.push({ kind: 'break', hard: true });
        continue;
      }
      const next =
        tag === 'strong' || tag === 'b'
          ? { ...marks, strong: true }
          : tag === 'em' || tag === 'i'
            ? { ...marks, em: true }
            : tag === 'a' && node.href !== null && isSafeHref(node.href.trim())
              ? { ...marks, href: keptHref(node.href.trim()) }
              : marks;
      const block = model.phrasing(tag) === false;
      if (block) pieces.push({ kind: 'break', hard: false });
      walk(node.children, next);
      if (block) pieces.push({ kind: 'break', hard: false });
    }
  };
  walk(nodes, PLAIN);
  // spaces run together: none at the start of a line or after a space, none at the end of a line; a line boundary
  // between two texts is one line break, and none at the start or the end
  const out: Segment[] = [];
  let lineStart = true;
  let pendingBreaks = 0;
  for (const piece of pieces) {
    if (piece.kind === 'break') {
      if (piece.hard) pendingBreaks += 1;
      else pendingBreaks = Math.max(pendingBreaks, 1);
      continue;
    }
    let text = piece.segment.text;
    if (pendingBreaks > 0 || lineStart) text = text.replace(/^ /, '');
    const last = out.at(-1);
    if (last !== undefined && last.text.endsWith(' ') && text.startsWith(' ')) text = text.slice(1);
    if (text === '') continue;
    if (pendingBreaks > 0 && out.length > 0) {
      const previous = out[out.length - 1] as Segment;
      out[out.length - 1] = { ...previous, text: previous.text.replace(/ $/, '') };
      out.push({ ...PLAIN, text: BREAK.repeat(pendingBreaks) });
    }
    pendingBreaks = 0;
    lineStart = false;
    out.push({ ...piece.segment, text });
  }
  const last = out.at(-1);
  if (last !== undefined) out[out.length - 1] = { ...last, text: last.text.replace(/ $/, '') };
  return merged(out);
}
