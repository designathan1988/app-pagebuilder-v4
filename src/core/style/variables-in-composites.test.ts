// A design token typed into a composite field (jornada03 J1, D1: `var(--line)` as a class's border colour wrote the
// shorthand border-color, which the model refuses, so the commit failed silently). Every composite of properties.json,
// on an element and on a class, either writes the token into each longhand or refuses before any patch: never a
// state the validator refuses.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext, Outcome } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { setBorderCommand, setRadiusCommand } from './border.ts';
import { setStyleCommand } from './set.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const TOKENS = [
  { name: 'line', kind: 'color', value: '#e6d8c6' },
  { name: 'space-32', kind: 'size', value: '32px' },
  { name: 'pair', kind: 'size', value: '10px 20px' },
];
const doc = (): DocumentJson => ({
  version: 4,
  tokens: TOKENS,
  classes: [{ name: 'card', styles: {} }],
  pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Card', 'div', 'div', { classes: ['card'] })] }) }],
} as DocumentJson);
const context = (document: DocumentJson, styleClass: string | null): HandlerContext<never> => ({
  state: { document, selection: ['Card' as NodeId], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
  styleClass,
} as HandlerContext<never>);

// what an outcome leaves: refused (fine), no change (fine), or a change whose document the model takes
function problemsOf(document: DocumentJson, outcome: Outcome<never>): string[] {
  if (outcome.kind !== 'change' || outcome.patches === undefined) return [];
  const applied = applyPatches(document, outcome.patches);
  return validateDocument(applied.document, ['Card' as NodeId], RULES).map((p) => `${p.path}: ${p.message}`);
}

const TARGETS: readonly (string | null)[] = [null, 'card'];

describe('a design token in a composite field', () => {
  for (const target of TARGETS) {
    const where = target === null ? 'an element' : 'a class';
    it(`never leaves an invalid state, on ${where}, for any composite`, () => {
      for (const composite of RULES.compositeFacts.keys()) {
        for (const token of TOKENS) {
          const document = doc();
          const outcome = setStyleCommand.run(context(document, target), { property: composite as never, value: `var(--${token.name})` });
          expect(problemsOf(document, outcome), `${composite} = var(--${token.name}) on ${where}`).toEqual([]);
        }
      }
    });

    it(`writes a one-value token into every side of a border colour on ${where} (the D1 case)`, () => {
      const document = doc();
      const outcome = setBorderCommand.run(context(document, target), { sides: 'all', color: 'var(--line)' } as never);
      expect(outcome.kind).toBe('change');
      expect(problemsOf(document, outcome)).toEqual([]);
      const applied = applyPatches(document, outcome.kind === 'change' ? (outcome.patches ?? []) : []).document;
      const styles = target === null ? applied.pages[0]?.tree.children[0]?.styles : applied.classes?.[0]?.styles;
      const base = (styles as Record<string, Record<string, Record<string, unknown>>> | undefined)?.desktop?.base ?? {};
      for (const side of ['top', 'right', 'bottom', 'left']) expect(base[`border-${side}-color`]).toBe('var(--line)');
    });

    it(`writes a token into every corner of a radius and every side of a padding on ${where}`, () => {
      const document = doc();
      const radius = setRadiusCommand.run(context(document, target), { corners: 'all', value: 'var(--space-32)' } as never);
      expect(radius.kind).toBe('change');
      expect(problemsOf(document, radius)).toEqual([]);
      const padding = setStyleCommand.run(context(document, target), { property: 'padding' as never, value: 'var(--space-32)' });
      expect(padding.kind).toBe('change');
      expect(problemsOf(document, padding)).toEqual([]);
    });

    it(`refuses, before any patch, a token of two values in a one-value-per-side composite on ${where}`, () => {
      const outcome = setStyleCommand.run(context(doc(), target), { property: 'padding' as never, value: 'var(--pair)' });
      expect(outcome.kind).toBe('refused');
    });
  }
});

describe('a variable typed without var()', () => {
  it('is the variable: --line in a colour field writes var(--line); a name the project lacks is refused', () => {
    const document = doc();
    const outcome = setStyleCommand.run(context(document, null), { property: 'color' as never, value: '--line' });
    expect(outcome.kind).toBe('change');
    const applied = applyPatches(document, outcome.kind === 'change' ? (outcome.patches ?? []) : []).document;
    const base = (applied.pages[0]?.tree.children[0]?.styles as Record<string, Record<string, Record<string, unknown>>> | undefined)?.desktop?.base ?? {};
    expect(base.color).toBe('var(--line)');
    expect(setStyleCommand.run(context(doc(), null), { property: 'color' as never, value: '--missing' }).kind).toBe('refused');
  });
});
