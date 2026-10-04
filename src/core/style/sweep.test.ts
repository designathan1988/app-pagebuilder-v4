// The silent-failure sweep (jornada03 J1): a style write the model refuses after the handler produced patches is a
// failure the person never sees. Every property and composite of properties.json, with every keyword it offers, bare
// and unit lengths, percentages and design tokens, on an element and on a class, at the base and at another
// breakpoint, either changes the document into one the validator takes, changes nothing, or is refused by the handler
// before any patch.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { StyleTargetId } from '../../generated/ids.ts';
import { GENERATED_VALUES } from '../../generated/value-lists.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument, type ModelRules } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { setStyleCommand } from './set.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const doc = (): DocumentJson =>
  ({
    version: 4,
    tokens: [
      { name: 'line', kind: 'color', value: '#e6d8c6' },
      { name: 'space', kind: 'size', value: '24px' },
    ],
    classes: [{ name: 'card', styles: {} }],
    pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div', { classes: ['card'], styles: { desktop: { base: { display: 'grid' } } } }), node('Text', 'paragraph', 'p', { text: 'Hi', classes: ['card'] })] }) }],
  }) as DocumentJson;

const layered = (breakpoint: string): ModelRules => (breakpoint === RULES.base.breakpoint ? RULES : { ...RULES, base: { ...RULES.base, breakpoint } });
const context = (document: DocumentJson, selection: string, styleClass: string | null, breakpoint: string): HandlerContext<never> =>
  ({
    state: { document, selection: [selection as NodeId], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('x'),
    rules: layered(breakpoint),
    words: (key: string) => key,
    layout: noLayout,
    css: anyCss,
    styleClass,
  }) as HandlerContext<never>;

const valuesFor = (property: string): readonly string[] => {
  const offered = GENERATED_VALUES[property as StyleTargetId];
  return [...(offered?.keywords ?? []), '12', '12px', '1.5rem', '50%', '0', '-4px', 'var(--line)', 'var(--space)', 'red', '2px solid red', 'none', 'calc(100% - 8px)'];
};

const PROPERTIES = [...RULES.propertyFacts.keys(), ...RULES.compositeFacts.keys()];
const BREAKPOINTS = [RULES.base.breakpoint, manifest.properties.breakpoints.at(-1)?.id ?? RULES.base.breakpoint];

describe('the silent-failure sweep of style.set', () => {
  for (const selection of ['Box', 'Text']) {
    for (const styleClass of [null, 'card']) {
      for (const breakpoint of BREAKPOINTS) {
        it(`never produces a state the model refuses (${selection}, ${styleClass === null ? 'element' : '.card'}, ${breakpoint})`, () => {
          const broken: string[] = [];
          for (const property of PROPERTIES) {
            for (const value of valuesFor(property)) {
              const document = doc();
              const outcome = setStyleCommand.run(context(document, selection, styleClass, breakpoint), { property: property as never, value });
              if (outcome.kind !== 'change' || outcome.patches === undefined || outcome.patches.length === 0) continue;
              const applied = applyPatches(document, outcome.patches).document;
              const problems = validateDocument(applied, [selection as NodeId], RULES);
              if (problems.length > 0) broken.push(`${property} = ${value}: ${problems.map((p) => p.message).join('; ')}`);
            }
          }
          expect(broken).toEqual([]);
        });
      }
    }
  }
});
