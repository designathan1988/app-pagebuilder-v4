// Syntax colouring of the code pane's lines (the manifest's code-panel-view, "with line numbers and syntax
// colouring"): one line of HTML, CSS or JavaScript split into the tokens the pane paints. One owner of the tokens; the
// pane draws a token as a span of the kind's colour (the tokens' --color-syntax-* design tokens). It never changes
// what a line says: the tokens' texts joined are the line.
import type { PaneKind } from './code-panel.ts';

type TokenKind = 'plain' | 'comment' | 'tag' | 'attr' | 'string' | 'selector' | 'property' | 'value' | 'keyword';
export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
}

const push = (out: Token[], text: string, kind: TokenKind): void => {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === kind) out[out.length - 1] = { text: last.text + text, kind };
  else out.push({ text, kind });
};

// HTML: comments, tags, attribute names and their quoted values; everything else is the text of the page.
function html(line: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  while (at < line.length) {
    const open = line.indexOf('<!--', at);
    const tag = line.indexOf('<', at);
    const next = open >= 0 && open === tag ? open : tag;
    if (next < 0) {
      push(out, line.slice(at), 'plain');
      break;
    }
    push(out, line.slice(at, next), 'plain');
    if (line.startsWith('<!--', next)) {
      const end = line.indexOf('-->', next + 4);
      const text = end < 0 ? line.slice(next) : line.slice(next, end + 3);
      push(out, text, 'comment');
      at = next + text.length;
      continue;
    }
    const end = line.indexOf('>', next);
    const inside = end < 0 ? line.slice(next) : line.slice(next, end + 1);
    // the tag's name, then each attribute with its value
    const name = /^<\/?[A-Za-z0-9-]+/.exec(inside)?.[0] ?? '';
    push(out, name, 'tag');
    const rest = inside.slice(name.length);
    for (const part of rest.split(/(="[^"]*"|='[^']*')/)) {
      if (part === '') continue;
      if (part.startsWith('="') || part.startsWith("='")) push(out, part, 'string');
      else if (part === '>' || part === '/>') push(out, part, 'tag');
      else if (/^[A-Za-z-]+=/.test(part)) push(out, part.slice(0, -1), 'attr');
      else push(out, part, part.trim().startsWith('=') ? 'string' : 'attr');
    }
    at = next + inside.length;
  }
  return out;
}

// CSS: comments, an at-rule, a selector before its brace, a property and its value inside one.
function css(line: string): Token[] {
  const comment = line.indexOf('/*');
  if (comment === 0) return [{ text: line, kind: 'comment' }];
  const brace = line.indexOf('{');
  const close = line.indexOf('}');
  if (brace >= 0 && (close < 0 || brace < close)) {
    const selector = line.slice(0, brace);
    return [...(selector.trimStart().startsWith('@') ? [{ text: selector, kind: 'keyword' as const }] : [{ text: selector, kind: 'selector' as const }]), { text: line.slice(brace), kind: 'plain' }];
  }
  if (close >= 0) return [{ text: line, kind: 'plain' }];
  const colon = line.indexOf(':');
  if (colon < 0) return [{ text: line, kind: 'plain' }];
  const property = line.slice(0, colon);
  const rest = line.slice(colon + 1);
  const semi = rest.endsWith(';') ? ';' : '';
  return [{ text: property, kind: 'property' }, { text: ':', kind: 'plain' }, { text: rest.slice(0, rest.length - semi.length), kind: 'value' }, ...(semi === '' ? [] : [{ text: semi, kind: 'plain' as const }])];
}

// JavaScript: comments and quoted strings; the rest is plain (the pane never guesses beyond what it can colour safely)
function javascript(line: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  const lineComment = line.indexOf('//');
  while (at < line.length) {
    const quote = line.indexOf('"', at) >= 0 || line.indexOf("'", at) >= 0 ? (line.indexOf("'", at) >= 0 && (line.indexOf('"', at) < 0 || line.indexOf("'", at) < line.indexOf('"', at)) ? line.indexOf("'", at) : line.indexOf('"', at)) : -1;
    const stop = lineComment >= 0 && lineComment >= at && (quote < 0 || lineComment < quote) ? lineComment : quote;
    if (stop < 0) {
      push(out, line.slice(at), 'plain');
      break;
    }
    push(out, line.slice(at, stop), 'plain');
    if (stop === lineComment) {
      push(out, line.slice(stop), 'comment');
      break;
    }
    const end = line.indexOf(line[stop] ?? '"', stop + 1);
    const text = end < 0 ? line.slice(stop) : line.slice(stop, end + 1);
    push(out, text, 'string');
    at = stop + text.length;
    if (end < 0) break;
  }
  return out;
}

export function highlight(line: string, kind: PaneKind): readonly Token[] {
  if (kind === 'css') return css(line);
  if (kind === 'js') return javascript(line);
  return html(line);
}
