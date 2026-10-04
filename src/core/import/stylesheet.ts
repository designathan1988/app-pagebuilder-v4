// Reading a stylesheet for the import (INVENTORY.md, owners; the manifest's html-import-styles,
// html-import-media-queries and html-import-states): the one owner of a stylesheet's text as rules — each rule's
// selectors, its declarations, the media query it sits in and the line it is on. The importer resolves the rules onto
// the nodes it built (src/core/import/import.ts) and the declarations themselves are read by the one owner of a
// declarations text (style/custom.ts parseDeclarations), so this module parses only the frame of a stylesheet:
// comments, rule blocks, `@media` (nested one level, a rule inside another media carrying both conditions, which the
// caller cannot map and reports), and every other at-rule (`@supports`, `@font-face`, `@keyframes`, `@import`…) as a
// block or a statement the caller reports. It writes nothing and knows nothing of properties.
export interface Declarations {
  // the text of one declaration, without its "!" and importance, with the line it is on
  readonly text: string;
  readonly important: boolean;
  readonly line: number;
}

export interface CssRule {
  // one selector of the rule's selector list, as written
  readonly selector: string;
  readonly declarations: readonly Declarations[];
  // the `@media` conditions the rule sits in, in order (none when it is at the top level)
  readonly media: readonly string[];
  readonly line: number;
}

export interface CssSheet {
  readonly rules: readonly CssRule[];
  // the at-rules the caller cannot map, by the text after "@" and their line
  readonly atRules: readonly { readonly name: string; readonly line: number }[];
}

// The text without its comments, keeping the line breaks so a piece's line is the source's line.
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

const lineAt = (text: string, at: number): number => text.slice(0, at).split('\n').length;

// One declaration's text as its parts: the text without "!important", and whether it carried one.
function declarationOf(piece: string, line: number): Declarations {
  const important = /\s*!\s*important\s*$/i.test(piece);
  return { text: important ? piece.replace(/\s*!\s*important\s*$/i, '').trim() : piece.trim(), important, line };
}

// The pieces of a declaration list, split on the ";" outside parentheses, quotes and url()s, each with its line (the
// line of the piece's first character, counted from the line the list starts on). The one reader of a block's
// declarations: a rule's block and a `style` attribute both read through it.
export function readDeclarations(list: string, startLine: number, text: string, from = 0): Declarations[] {
  const out: Declarations[] = [];
  let piece = '';
  let at0 = 0;
  let depth = 0;
  let quote: string | null = null;
  // the line a piece's text is written on: the line the list started on, plus the breaks before its first character
  const lineOf = (start: number): number => startLine + (text.slice(from, from + start).match(/\n/g)?.length ?? 0);
  const push = (raw: string): void => {
    if (raw.trim() === '') return;
    out.push(declarationOf(raw, lineOf(at0 + (raw.length - raw.trimStart().length))));
  };
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at] as string;
    if (quote !== null) {
      piece += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      piece += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ';' && depth === 0) {
      push(piece);
      piece = '';
      at0 = at + 1;
      continue;
    }
    piece += char;
  }
  push(piece);
  return out;
}

// The selector list of a rule, split on the commas outside brackets and parentheses.
function selectorsIn(prelude: string): string[] {
  const out: string[] = [];
  let piece = '';
  let depth = 0;
  let quote: string | null = null;
  for (const char of prelude) {
    if (quote !== null) {
      piece += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      piece += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      if (piece.trim() !== '') out.push(piece.trim());
      piece = '';
      continue;
    }
    piece += char;
  }
  if (piece.trim() !== '') out.push(piece.trim());
  return out;
}

// The rules of a stylesheet's text, in order, each with the media conditions it sits in and its line. A block at the
// top level is a rule; `@media` recurses with its condition added; every other at-rule is collected as one the caller
// cannot map (a nested `@media` counts as unmappable too: two conditions at once are no breakpoint).
export function readStylesheet(source: string): CssSheet {
  const text = withoutComments(source);
  const rules: CssRule[] = [];
  const atRules: { name: string; line: number }[] = [];
  const walk = (from: number, to: number, media: readonly string[]): void => {
    let at = from;
    while (at < to) {
      // the next brace inside this block (a brace of a later block is none of this walk's business)
      const foundOpen = text.indexOf('{', at);
      const foundClose = text.indexOf('}', at);
      const open = foundOpen >= 0 && foundOpen < to ? foundOpen : -1;
      const close = foundClose >= 0 && foundClose < to ? foundClose : to;
      // a statement at the top level (@import, @charset), or what is left before a block ends: its own line, no block
      if (open < 0 || close < open) {
        const statement = text.slice(at, close).trim();
        if (statement !== '') {
          const name = /^@([\w-]+)/.exec(statement)?.[1] ?? statement.slice(0, 20);
          atRules.push({ name, line: lineAt(text, at + (text.slice(at, close).length - text.slice(at, close).trimStart().length)) });
        }
        at = close + 1;
        continue;
      }
      const before = text.slice(at, open);
      const pieceAt = at + (before.length - before.trimStart().length);
      const prelude = before.trim();
      const end = matchingBrace(text, open, to);
      if (prelude.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        if (name === 'media') {
          const condition = prelude.slice('@media'.length).trim();
          if (media.length > 0) atRules.push({ name, line: lineAt(text, pieceAt) });
          walk(open + 1, end, [...media, condition]);
        } else {
          atRules.push({ name, line: lineAt(text, pieceAt) });
        }
      } else if (prelude !== '') {
        const declarations = readDeclarations(text.slice(open + 1, end), lineAt(text, open + 1), text, open + 1);
        if (declarations.length > 0) {
          for (const selector of selectorsIn(prelude)) rules.push({ selector, declarations, media, line: lineAt(text, pieceAt) });
        }
      }
      at = end + 1;
    }
  };
  walk(0, text.length, []);
  return { rules, atRules };
}

// The index of the "}" closing the block opened by "{", counting nested blocks.
function matchingBrace(text: string, open: number, to: number): number {
  let depth = 0;
  for (let at = open; at < to; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return to;
}
