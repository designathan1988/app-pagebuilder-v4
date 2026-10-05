// The project's design tokens as CSS variables (INVENTORY.md, owners; spec css-variables-tokens): each a
// name, a kind (a colour, a length, a font size: tokens.create's kinds) and a value, kept with the project (the
// document's `tokens`, in the order they were made) and named in a style value as var(--name). The one owner of:
//  - tokens.create, tokens.update, tokens.rename, tokens.delete, one undo step each. A name is a CSS custom property's
//    without its dashes (a letter, then letters, digits and "-"), unique in the project; a value is one the browser
//    takes for the kind (read as the property the kind names reads it: color for a colour, font-size for a font size, a
//    length-percentage property for a length). A rename renames every var(--name) that uses it, wherever a value lives
//    (Problems in Pager 2); a variable in use is not deleted, the refusal counting the elements that use it and, when
//    only a shared holder does, saying so (Problems in Pager 3).
//  - usesOf / usesToken / tokenReferenceOf: which values name a variable, and who holds them;
//  - rootCss: the variables as the :root rule the page and the export write (Problems in Pager 1);
//  - tokenKindOf: the kind of variable a property's field offers (Problems in Pager 4): the kind the property is (a
//    font size), else the kind whose value is read as the property's is (a colour field: a colour; a length field: a
//    length); none for any other.
import { IDENTIFIER_SOURCE } from '../text/identifier.ts';
import type { Message } from '../commands/registry.ts';
import { message, registerHandler, type HandlerContext, type Outcome } from '../commands/registry.ts';
import { walk, type DocNode, type DocumentJson, type StoredValue } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { readValue } from '../style/set.ts';
import { commandOf } from '../../manifest/runtime.ts';
import { registerReferenceKind } from '../store/references.ts';

export interface Token {
  readonly name: string;
  readonly kind: string;
  readonly value: string;
}

const NONE: readonly Token[] = [];
export const tokensOf = (document: DocumentJson): readonly Token[] => document.tokens ?? NONE;
const NAME = new RegExp(`^${IDENTIFIER_SOURCE}$`, 'u');
const escaped = (name: string) => name.replace(/[-]/g, '\\-');
// a style value's reference to a variable: var(--name), with or without a fallback
const referenceTo = (name: string) => new RegExp(`var\\(\\s*--${escaped(name)}\\s*([,)])`, 'g');

type Path = readonly (string | number)[];

// One place a value names a variable: the document path the rename writes to, the value itself (a structured value
// carried whole, so its layers are rewritten in place), and who holds it — an element's own style, a class's, a
// component's tree, an element's animation, or another variable's value (an alias).
interface Use {
  readonly path: Path;
  readonly value: StoredValue;
  readonly holder: 'element' | 'class' | 'component' | 'animation' | 'token' | 'timeline';
  readonly element: string | null;
  readonly className: string | null;
  readonly component: string | null;
}

// The texts a stored value names a variable in: the value itself, or every text of a structured value's layers (a
// shadow's colour or length is CSS text a variable may be named in).
const texts = (value: StoredValue): readonly string[] =>
  typeof value === 'string'
    ? [value]
    : value.flatMap((layer) => Object.values(layer).filter((field): field is string => typeof field === 'string'));

// The stored value with every reference to the variable renamed.
function renamedIn(value: StoredValue, name: string, next: string): StoredValue {
  const rewrite = (text: string) => text.replace(referenceTo(name), `var(--${next}$1`);
  if (typeof value === 'string') return rewrite(value);
  return value.map((layer) => Object.fromEntries(Object.entries(layer).map(([field, held]) => [field, typeof held === 'string' ? rewrite(held) : held])));
}

// every value of one declarations object that names the variable
function usesInDeclarations(name: string, declarations: Readonly<Record<string, StoredValue | undefined>> | undefined, base: Path, make: (path: Path, value: StoredValue) => Use, into: Use[]): void {
  for (const [property, value] of Object.entries(declarations ?? {})) {
    if (value === undefined) continue;
    if (texts(value).some((text) => referenceTo(name).test(text))) into.push(make([...base, property], value));
  }
}

// every value of one styles object (breakpoint → state → declarations) that names the variable
function usesInStyles(name: string, styles: DocNode['styles'] | undefined, base: Path, make: (path: Path, value: StoredValue) => Use, into: Use[]): void {
  for (const [breakpoint, states] of Object.entries(styles ?? {})) {
    for (const [state, declarations] of Object.entries(states ?? {})) usesInDeclarations(name, declarations as Record<string, StoredValue>, [...base, breakpoint, state], make, into);
  }
}

// every value inside one node — its styles, its animations' keyframes and settings — that names the variable; an
// animation's use keeps the holder it belongs to (the element, or the class it stands for) and says it is a keyframe's
function usesInNode(name: string, node: DocNode, base: Path, make: (path: Path, value: StoredValue) => Use, into: Use[]): void {
  usesInStyles(name, node.styles, [...base, 'styles'], make, into);
  const fromAnimation = (path: Path, value: StoredValue): Use => ({ ...make(path, value), holder: 'animation' });
  (node.animations ?? []).forEach((animation, a) => {
    animation.keyframes.forEach((frame, k) => usesInDeclarations(name, frame.declarations as Record<string, StoredValue>, [...base, 'animations', a, 'keyframes', k, 'declarations'], fromAnimation, into));
    for (const [setting, value] of Object.entries(animation.settings ?? {})) {
      if (referenceTo(name).test(value)) into.push(fromAnimation([...base, 'animations', a, 'settings', setting], value));
    }
  });
}

// every node of a tree with its own document path
function walkPaths(node: DocNode, base: Path, visit: (node: DocNode, path: Path) => void): void {
  visit(node, base);
  node.children.forEach((child, i) => walkPaths(child, [...base, 'children', i], visit));
}

// Every CSS text the project's motion timelines hold, with its path: the keyframes of every track (an animate or a
// split-text action's), and the value a style or a variable action writes.
export function timelineTexts(document: DocumentJson): readonly { readonly path: Path; readonly value: string }[] {
  const found: { path: Path; value: string }[] = [];
  (document.motionTimelines ?? []).forEach((timeline, t) => {
    timeline.actions.forEach((action, a) => {
      const base: Path = ['motionTimelines', t, 'actions', a, 'effect'];
      const effect = action.effect;
      if (effect.kind === 'animate' || effect.kind === 'split-text') {
        effect.tracks.forEach((track, k) => track.keyframes.forEach((frame, f) => found.push({ path: [...base, 'tracks', k, 'keyframes', f, 'value'], value: frame.value })));
      }
      if ((effect.kind === 'style' || effect.kind === 'variable') && typeof effect.value === 'string') found.push({ path: [...base, 'value'], value: effect.value });
    });
  });
  return found;
}

// every place a value names the variable: every element of every page (and its animations), every class definition,
// every component's tree, and the variables' own values (an alias). The one traversal rename and delete read.
export function usesOf(document: DocumentJson, name: string): readonly Use[] {
  const found: Use[] = [];
  document.pages.forEach((page, index) => {
    walkPaths(page.tree, ['pages', index, 'tree'], (node, path) => {
      const make = (at: Path, value: StoredValue): Use => ({ path: at, value, holder: 'element', element: node.id, className: null, component: null });
      usesInNode(name, node, path, make, found);
    });
  });
  (document.classes ?? []).forEach((styleClass, index) => {
    const make = (at: Path, value: StoredValue): Use => ({ path: at, value, holder: 'class', element: null, className: styleClass.name, component: null });
    usesInStyles(name, styleClass.styles, ['classes', index, 'styles'], make, found);
  });
  (document.components ?? []).forEach((definition, index) => {
    walkPaths(definition.tree, ['components', index, 'tree'], (node, path) => {
      const make = (at: Path, value: StoredValue): Use => ({ path: at, value, holder: 'component', element: null, className: null, component: definition.name });
      usesInNode(name, node, path, make, found);
    });
  });
  // the motion timelines (the audit's SV1): a keyframe recorded from a style write keeps the CSS text, var(--x) too,
  // and a style or variable action writes CSS text
  timelineTexts(document).forEach(({ path, value }) => {
    if (referenceTo(name).test(value)) found.push({ path, value, holder: 'timeline', element: null, className: null, component: null });
  });
  tokensOf(document).forEach((token, index) => {
    if (referenceTo(name).test(token.value)) found.push({ path: ['tokens', index, 'value'], value: token.value, holder: 'token', element: null, className: null, component: null });
  });
  return found;
}

// The elements that use the variable: an element whose own styles, keyframes or settings name it, every element
// listing a class that names it, and every instance of a component whose tree names it (the count the refusal says).
export function usesToken(document: DocumentJson, name: string): number {
  const uses = usesOf(document, name);
  const elements = new Set<string>();
  for (const use of uses) if (use.element !== null) elements.add(use.element);
  const classNames = new Set(uses.filter((u) => u.className !== null).map((u) => u.className as string));
  const componentNames = new Set(uses.filter((u) => u.component !== null).map((u) => u.component as string));
  if (classNames.size === 0 && componentNames.size === 0) return elements.size;
  for (const page of document.pages) {
    for (const node of walk(page.tree)) {
      if (node.classes.some((one) => classNames.has(one))) elements.add(node.id);
      if (node.component !== undefined && componentNames.has(node.component)) elements.add(node.id);
    }
  }
  return elements.size;
}

// the property whose values a kind's value is read as: the property the kind names, else one whose codec reads the kind
export function probeOf<Ui>(context: HandlerContext<Ui>, kind: string): string | null {
  const { rules } = context;
  if (rules.propertyFacts.has(kind)) return kind;
  return [...rules.propertyFacts.entries()].find(([, facts]) => facts.codec.startsWith(`${kind}-`))?.[0] ?? null;
}

function valueRefusal<Ui>(context: HandlerContext<Ui>, kind: string, value: string): Message | null {
  const probe = probeOf(context, kind);
  const read = probe === null ? null : readValue(context, probe, value);
  return read === null ? message('status.tokens.invalidValue', { value, kind: { key: `styles.kind.${kind}` as Message['key'] } }) : null;
}
const nameRefusal = (document: DocumentJson, name: string, except: string | null): Message | null => {
  if (!NAME.test(name)) return message('status.tokens.badName', { name });
  if (tokensOf(document).some((t) => t.name === name && t.name !== except)) return message('status.tokens.nameTaken', { name });
  return null;
};

export const createToken = registerHandler('tokens.create', (context, { kind, name, value }): Outcome<never> => {
  const { state } = context;
  const typed = name.trim();
  const refused = nameRefusal(state.document, typed, null) ?? valueRefusal(context, kind, value.trim());
  if (refused !== null) return { kind: 'refused', message: refused };
  const token: Token = { name: typed, kind, value: value.trim() };
  const held = tokensOf(state.document);
  const patch: Patch = state.document.tokens === undefined ? { op: 'add', path: ['tokens'], value: [token] } : { op: 'add', path: ['tokens', held.length], value: token };
  return { kind: 'change', patches: [patch], message: message('status.tokens.created', { name: typed }) };
});

// tokens.create's kinds, in their manifest order (a colour, a length, a font size): the kinds a variable may have
export const TOKEN_KINDS: readonly string[] = commandOf(createToken.command).args.kind?.values ?? [];

function indexOf(document: DocumentJson, name: string): number {
  const at = tokensOf(document).findIndex((t) => t.name === name);
  if (at < 0) throw new Error(`tokens: the project has no variable ${name}`);
  return at;
}

export const updateToken = registerHandler('tokens.update', (context, { token, value }): Outcome<never> => {
  const { state } = context;
  const at = indexOf(state.document, token);
  const held = tokensOf(state.document)[at] as Token;
  const typed = value.trim();
  const refused = valueRefusal(context, held.kind, typed);
  if (refused !== null) return { kind: 'refused', message: refused };
  const said = message('status.tokens.updated', { name: held.name, value: typed });
  if (held.value === typed) return { kind: 'change', message: said };
  return { kind: 'change', patches: [{ op: 'replace', path: ['tokens', at, 'value'], value: typed }], message: said };
});

export const renameToken = registerHandler('tokens.rename', (context, { token, name }): Outcome<never> => {
  const { state } = context;
  // the variable must be the project's (indexOf says which is not)
  indexOf(state.document, token);
  const typed = name.trim();
  const said = message('status.tokens.renamed', { from: token, to: typed });
  if (typed === token) return { kind: 'change', message: said };
  const refused = nameRefusal(state.document, typed, token);
  if (refused !== null) return { kind: 'refused', message: refused };
  return { kind: 'change', patches: renameTokenPatches(state.document, token, typed), message: said };
});

// The patches that rename a variable and every value that names it, wherever it lives: an element's style or animation,
// a class, a component's tree, or another variable (tokens.rename; an import whose variable takes another name because
// the project holds one of its name with another value: import/destinations.ts)
export function renameTokenPatches(document: DocumentJson, from: string, to: string): Patch[] {
  const at = indexOf(document, from);
  const uses: Patch[] = usesOf(document, from).map((use) => ({ op: 'replace', path: use.path, value: renamedIn(use.value, from, to) }));
  return [{ op: 'replace', path: ['tokens', at, 'name'], value: to }, ...uses];
}

export const deleteToken = registerHandler('tokens.delete', ({ state }, { token }): Outcome<never> => {
  const at = indexOf(state.document, token);
  const document = state.document;
  const count = usesToken(document, token);
  if (count > 0) return { kind: 'refused', message: message('status.tokens.inUse', { name: token, count }) };
  // no element uses it, but a shared holder does: a class no element lists, a component's tree, or another variable
  if (usesOf(document, token).length > 0) return { kind: 'refused', message: message('status.tokens.inUseShared', { name: token }) };
  const patch: Patch = tokensOf(document).length === 1 ? { op: 'remove', path: ['tokens'] } : { op: 'remove', path: ['tokens', at] };
  return { kind: 'change', patches: [patch], message: message('status.tokens.deleted', { name: token }) };
});

export function tokenKindOf(property: string, kinds: readonly string[], rules: HandlerContext<unknown>['rules']): string | null {
  if (kinds.includes(property)) return property;
  const codec = rules.propertyFacts.get(property)?.codec;
  return kinds.find((kind) => {
    const probe = rules.propertyFacts.has(kind) ? kind : [...rules.propertyFacts.entries()].find(([, facts]) => facts.codec.startsWith(`${kind}-`))?.[0];
    return probe !== undefined && rules.propertyFacts.get(probe)?.codec === codec;
  }) ?? null;
}

// The variables as the rule of the page's root: ":root { --name: value; }", empty for none.
export function rootCss(tokens: readonly Token[]): string {
  if (tokens.length === 0) return '';
  return `:root {\n${tokens.map((t) => `  --${t.name}: ${t.value};`).join('\n')}\n}`;
}

// a variable an argument names (manifest refers: token), by its name
registerReferenceKind('token', (document, name) => tokensOf(document).some((token) => token.name === name));
