// Safe serialization helpers owned by render/output.ts. The property vocabulary and codecs come from its manifest.
import resetRules from './reset-rules.json' with { type: 'json' };
import fontParts from './font-parts.json' with { type: 'json' };
import { valueWords } from '../style/codecs.ts';

export interface Composite {
  readonly codec?: string;
  readonly shorthand: string;
  readonly longhands: readonly string[];
  readonly compose: ((values: readonly string[]) => string | null) | undefined;
}

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

const read = (line: string): Declaration | null => {
  const match = /^([a-z-]+):\s*(.*?)\s*;$/i.exec(line);
  if (!match) return null;
  return { property: match[1] ?? '', value: (match[2] ?? '').replace(/\s*!important$/i, ''), important: /!important$/i.test(match[2] ?? '') };
};

const globalValue = /^(inherit|initial|unset|revert|revert-layer)$/i;
// Substitution can expand to multiple tokens at computed-value time; shortening it can invalidate otherwise valid
// longhands.
const substitution = /\b(?:var|env|attr)\(/i;

function fontComposite(): Composite {
  return {
    ...fontParts,
    compose: (values) => {
      const [style, variant, weight, stretch, size, height, family] = values;
      if (values.length !== 7 || !style || !variant || !weight || stretch !== 'normal' || !size || !height || !family || !['normal', 'small-caps'].includes(variant)) return null;
      return [...[style, variant, weight].filter((value) => value !== 'normal'), `${size}/${height}`, family].join(' ');
    },
  };
}

export function compactDeclarations(lines: readonly string[], composites: readonly Composite[]): string[] {
  let result = [...lines];
  for (const composite of [fontComposite(), ...composites]) {
    const compose = composite.compose ?? (composite.codec === 'axis-pair' ? (v: readonly string[]) => (v.length === 2 ? (v[0] === v[1] ? (v[0] ?? null) : v.join(' ')) : null) : undefined);
    if (compose === undefined || composite.longhands.length < 2) continue;
    // Border resets the border-image family; font resets additional font longhands. A complete reset-aware plan must
    // name all of them.
    const parsed = result.map(read);
    const resets = (resetRules as Readonly<Record<string, Readonly<Record<string, string>>>>)[composite.shorthand];
    const resetIndices = resets === undefined ? [] : Object.entries(resets).map(([property, value]) => parsed.findIndex((d) => d?.property === property && d.value === value));
    if (resetIndices.some((index) => index < 0)) continue;
    if (resets !== undefined && Object.keys(resets).some((property) => parsed.filter((d) => d?.property === property).length !== 1)) continue;
    const indices = composite.longhands.map((p) => parsed.findIndex((d) => d?.property === p));
    if (indices.some((i) => i < 0) || new Set(indices).size !== indices.length) continue;
    if (composite.longhands.some((p) => parsed.filter((d) => d?.property === p).length !== 1)) continue;
    const selected = indices.map((i) => parsed[i]).filter((d): d is Declaration => d !== null && d !== undefined);
    if (selected.length !== indices.length || selected.some((d) => substitution.test(d.value)) || selected.some((d) => d.important !== selected[0]?.important)) continue;
    if (resetIndices.some((index) => parsed[index]?.important !== selected[0]?.important)) continue;
    const globals = selected.filter((d) => globalValue.test(d.value));
    if (globals.length > 0 && !selected.every((d) => d.value === selected[0]?.value)) continue;
    const family = composite.shorthand.split('-')[0] ?? '';
    // A shorthand or logical property interleaved with physical sides can change cascade order. Keep every such family
    // untouched.
    const interleaved = parsed.some(
      (d) =>
        d !== null &&
        !composite.longhands.includes(d.property) &&
        (d.property === composite.shorthand ||
          d.property === 'all' ||
          d.property.startsWith(`${family}-inline`) ||
          d.property.startsWith(`${family}-block`) ||
          d.property.startsWith(`${family}-start`) ||
          d.property.startsWith(`${family}-end`)),
    );
    if (interleaved) continue;
    const values = selected.map((d) => d.value);
    const corners = values.map(valueWords);
    const ellipse = composite.codec === 'box-corners' && corners.some((words) => words.length === 2);
    if (ellipse && corners.some((words) => words.length < 1 || words.length > 2)) continue;
    const horizontal = ellipse ? compose(corners.map((words) => words[0] ?? '')) : null;
    const vertical = ellipse ? compose(corners.map((words) => words[1] ?? words[0] ?? '')) : null;
    const text = globals.length === selected.length ? selected[0]?.value : ellipse ? (horizontal === vertical ? horizontal : `${horizontal} / ${vertical}`) : compose(values);
    if (text === null || text === undefined) continue;
    const first = Math.min(...indices);
    const important = selected[0]?.important === true ? ' !important' : '';
    result = result.flatMap((line, i) => (i === first ? [`${composite.shorthand}: ${text}${important};`] : indices.includes(i) || resetIndices.includes(i) ? [] : [line]));
  }
  return result;
}

export interface ExclusiveRule {
  readonly selector: string;
  readonly context: string;
  readonly body: string;
  readonly node: string;
}

export interface MergedRule {
  readonly selector: string;
  readonly context: string;
  readonly body: string;
  readonly nodes: readonly string[];
}

// The caller proves each class is a generated, mutually exclusive node identity. Arbitrary selectors never enter this
// optimization. Rules merge only within one context (the same media block and the same pseudo-class): two exclusive
// selectors never match the same element, so their order inside one block changes nothing.
export function mergeExclusiveRules(rules: readonly ExclusiveRule[], exclusive: ReadonlySet<string>): MergedRule[] {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = `${rule.context}\0${rule.selector}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const output: MergedRule[] = [];
  const groups = new Map<string, number>();
  for (const rule of rules) {
    const selector = /^\.([a-zA-Z_][a-zA-Z0-9_-]*)(:[a-zA-Z-]+)?$/.exec(rule.selector);
    const safe = selector !== null && exclusive.has(selector[1] ?? '') && counts.get(`${rule.context}\0${rule.selector}`) === 1;
    const key = `${rule.context}\0${selector?.[2] ?? ''}\0${rule.body}`;
    const at = safe ? groups.get(key) : undefined;
    const held = at === undefined ? undefined : output[at];
    if (held !== undefined && at !== undefined) {
      output[at] = { ...held, selector: `${held.selector}, ${rule.selector}`, nodes: [...held.nodes, rule.node] };
    } else {
      if (safe) groups.set(key, output.length);
      output.push({ selector: rule.selector, context: rule.context, body: rule.body, nodes: [rule.node] });
    }
  }
  return output;
}

// The generated stylesheet in cascade order (the audit's AUD-02): every element's base rules first, then one block per
// breakpoint, widest first (`media`, the order the cascade needs: desktop-first max-width queries, so a narrower one
// written later wins where both match), each holding every element's rules for that breakpoint. The element rules
// arrive one element at a time (its base rules, then its own media blocks); left that way, a merge that moved one
// element's media rule up to another's would put it before its own base rule, which then won at that width (tablet and
// phone styles lost in the export). Lines no element was written for (keyframes, the classes events play, the
// reduced-motion rule) keep their order after the element rules. This is the layout Webflow's export has: base styles,
// then its breakpoints' media queries in cascade order.
export function cascadeOrder<T extends { readonly text: string; readonly node: string | null }>(lines: readonly T[], media: readonly string[]): T[] {
  const base: T[] = [];
  const byMedia = new Map<string, T[]>();
  const tail: T[] = [];
  const blockEnd = (from: number): number => {
    let depth = 0;
    for (let i = from; i < lines.length; i++) {
      const text = lines[i]?.text ?? '';
      depth += (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
      if (depth === 0) return i;
    }
    return lines.length - 1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.node === null) {
      tail.push(line);
      continue;
    }
    const end = blockEnd(i);
    const query = /^(@media [^{]+) \{$/.exec(line.text)?.[1];
    if (query !== undefined) {
      const held = byMedia.get(query) ?? [];
      held.push(...lines.slice(i + 1, end));
      byMedia.set(query, held);
    } else {
      base.push(...lines.slice(i, end + 1));
    }
    i = end;
  }
  const unknown = [...byMedia.keys()].filter((query) => !media.includes(query));
  if (unknown.length > 0) throw new Error(`cascadeOrder: a media query the breakpoints do not name: ${unknown.join(', ')}`);
  const blocks = media.flatMap((query) => {
    const held = byMedia.get(query);
    return held === undefined || held.length === 0 ? [] : [{ text: `${query} {`, node: null } as T, ...held, { text: '}', node: null } as T];
  });
  return [...base, ...blocks, ...tail];
}

// Merges the identical bodies of generated rules, after putting the lines in cascade order: a rule only ever merges
// into one of its own block, so nothing crosses a breakpoint.
export function mergeCssLines<T extends { readonly text: string; readonly node: string | null }>(input: readonly T[], exclusive: ReadonlySet<string>, media: readonly string[]): T[] {
  const lines = cascadeOrder(input, media);
  const blocks: { start: number; end: number; rule: ExclusiveRule; indent: string }[] = [];
  let context = '';
  let opaqueDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const query = /^(@media [^{]+) \{$/.exec(line.text);
    if (query !== null && opaqueDepth === 0) {
      context = query[1] ?? '';
      continue;
    }
    if (line.text === '}' && context !== '') {
      context = '';
      continue;
    }
    const match = /^(\s*)(\.[a-zA-Z_][a-zA-Z0-9_-]*(?::[a-zA-Z-]+)?) \{$/.exec(line.text);
    if (match === null || opaqueDepth !== 0) {
      opaqueDepth += Math.max(0, (line.text.match(/\{/g) ?? []).length - (line.text.match(/\}/g) ?? []).length);
      if (line.text === '}') opaqueDepth = Math.max(0, opaqueDepth - 1);
      continue;
    }
    const indent = match[1] ?? '';
    const start = i;
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]?.text !== `${indent}}`) {
      i++;
      body.push(lines[i]?.text.trim() ?? '');
    }
    if (i + 1 >= lines.length) return [...lines];
    i++;
    blocks.push({ start, end: i, indent, rule: { selector: match[2] ?? '', context, body: body.join('\n'), node: line.node ?? '' } });
  }
  const merged = mergeExclusiveRules(
    blocks.map((b) => b.rule),
    exclusive,
  );
  const output = [...lines];
  const removed = new Set<number>();
  let blockIndex = 0;
  for (const group of merged) {
    while (blockIndex < blocks.length && removed.has(blocks[blockIndex]?.start ?? -1)) blockIndex++;
    const first = blocks[blockIndex++];
    if (first === undefined) break;
    const original = output[first.start];
    if (original !== undefined) output[first.start] = { ...original, text: `${first.indent}${group.selector} {` };
    const selectors = group.selector.split(', ');
    for (const other of blocks.slice(blockIndex)) {
      if (other.rule.context === group.context && other.rule.body === group.body && selectors.includes(other.rule.selector)) {
        for (let i = other.start; i <= other.end; i++) removed.add(i);
      }
    }
  }
  return output
    .filter((_, index) => !removed.has(index))
    .filter((line, index, all) => !(line.text.startsWith('@media ') && all[index + 1]?.text === '}') && !(line.text === '}' && all[index - 1]?.text.startsWith('@media ')));
}
