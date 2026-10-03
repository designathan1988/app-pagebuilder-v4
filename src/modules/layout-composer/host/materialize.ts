// The compiled structure written into the document (spec "Fluxo normal fora do Layout Mode", "Integração com estilos",
// "Stable Compilation"): the composed container keeps its id and gets the root's declarations, every compiled node
// becomes an ordinary element — the one it already was when the page holds it (found by its marker), else a new `div`
// in the tag the region means — and each element of the page the layout places (a content region) keeps its id, its
// own styles and its children. The compiler's declarations go through the style owner's own reader
// (core/style/set.ts readValue, declarationsOf), so a composite is written as its longhands and a value the browser
// would not take is refused, never stored; what the compiler wrote last time is taken back first, and nothing the
// person declared is touched.
import type { HandlerContext } from '../../../core/commands/registry.ts';
import type { DocNode, Styles } from '../../../core/document/model.ts';
import { declarationsOf, readValue } from '../../../core/style/set.ts';
import { freshName, newElement, type NodeMaker } from '../../../core/structure/node-maker.ts';
import type { CompiledNode, Compilation } from '../compiler/compile.ts';
import { ROOT_NODE } from '../compiler/compile.ts';
import { refuse } from '../intent/problems.ts';
import { markerOf, recordOf, withAuthoring, type ContainerRecord, type Owned } from './record.ts';

export interface MaterializePorts {
  readonly make: NodeMaker;
  // the type new region elements are made of (elements.json: a container whose tags cover the regions' semantics)
  readonly regionType: string;
  // each responsive rule or morph segment of the compilation, by the project breakpoint it applies at
  readonly breakpoints: Readonly<Record<string, string>>;
}

type Layer = Readonly<Record<string, unknown>>;

// The node's styles with what the compiler wrote before taken away and what it writes now set, at the base state of
// each breakpoint; the person's own declarations stay as they were.
function rewriteStyles<Ui>(context: HandlerContext<Ui>, styles: Styles, before: Owned, compiled: CompiledNode, breakpoints: Readonly<Record<string, string>>): { styles: Styles; owns: Owned } {
  const { breakpoint: base, state } = context.rules.baseLayer;
  const written: Record<string, Record<string, string>> = {};
  const owns: Record<string, string[]> = {};
  const write = (breakpoint: string, css: Readonly<Record<string, string>>) => {
    for (const [property, text] of Object.entries(css)) {
      const read = readValue(context, property, text);
      if (read === null) refuse('declaration', { property, value: text });
      for (const [longhand, value] of Object.entries(declarationsOf(property, read, context.rules))) {
        (written[breakpoint] ??= {})[longhand] = value;
        (owns[breakpoint] ??= []).push(longhand);
      }
    }
  };
  write(base, compiled.styles);
  for (const [rule, css] of Object.entries(compiled.responsive)) {
    const breakpoint = breakpoints[rule];
    if (breakpoint === undefined) refuse('responsive-rule', { rule });
    write(breakpoint, css);
  }
  const held = styles as Readonly<Record<string, Readonly<Record<string, Layer>>>>;
  const next: Record<string, Record<string, Layer>> = {};
  for (const breakpoint of new Set([...Object.keys(held), ...Object.keys(written)])) {
    const states: Record<string, Layer> = {};
    for (const name of new Set([...Object.keys(held[breakpoint] ?? {}), ...(written[breakpoint] === undefined ? [] : [state])])) {
      const taken = name === state ? new Set(before[breakpoint] ?? []) : new Set<string>();
      const kept = Object.entries(held[breakpoint]?.[name] ?? {}).filter(([property]) => !taken.has(property));
      const layer = { ...Object.fromEntries(kept), ...(name === state ? (written[breakpoint] ?? {}) : {}) };
      // a state or a breakpoint left with nothing is no layer at all (the document never holds an empty one)
      if (Object.keys(layer).length > 0) states[name] = layer;
    }
    if (Object.keys(states).length > 0) next[breakpoint] = states;
  }
  return { styles: next as unknown as Styles, owns };
}

// Every element of the container that stands for a compiled key, and every element the composer did not write, by the
// element that holds it (the person put it there while the layout was open: it is kept where it is). An element the
// layout places keeps its own children: they are its content, so they are not looked into.
function indexOf(container: DocNode): { readonly keyed: ReadonlyMap<string, DocNode>; readonly loose: ReadonlyMap<string, readonly DocNode[]> } {
  const keyed = new Map<string, DocNode>();
  const loose = new Map<string, DocNode[]>();
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker === null) loose.set(node.id, [...(loose.get(node.id) ?? []), child]);
      else {
        if (!keyed.has(marker.key)) keyed.set(marker.key, child);
        if (marker.kind === 'structural') visit(child);
      }
    }
  };
  visit(container);
  return { keyed, loose };
}

// The container with its compiled structure: the new subtree, and the record it keeps.
export function materialize<Ui>(context: HandlerContext<Ui>, container: DocNode, compilation: Compilation, ports: MaterializePorts): DocNode {
  const record = recordOf(container);
  if (record === null) refuse('container');
  const { keyed, loose } = indexOf(container);
  const used = new Set<string>();

  const build = (compiled: CompiledNode): DocNode => {
    const held = keyed.get(compiled.key);
    used.add(compiled.key);
    if (compiled.content) {
      // an element of the page the layout places: it must still be there, never re-created or emptied
      if (held === undefined) refuse('content-missing', { region: compiled.name ?? compiled.key });
      const marker = markerOf(held);
      const { styles, owns } = rewriteStyles(context, held.styles, marker?.owns ?? {}, compiled, ports.breakpoints);
      return withAuthoring({ ...held, styles }, { role: 'node', key: compiled.key, owns });
    }
    const element = held ?? newElement(ports.make, ports.regionType);
    // the element a region stands for carries the region's name (a wrapper keeps its own); a new one a free name
    const named = held === undefined ? { ...element, name: freshName(ports.make, compiled.name ?? element.name) } : compiled.name !== null && compiled.region !== null ? { ...element, name: compiled.name } : element;
    const tag = compiled.tag ?? named.tag;
    const marker = held === undefined ? null : markerOf(held);
    const { styles, owns } = rewriteStyles(context, held === undefined ? {} : held.styles, marker?.owns ?? {}, compiled, ports.breakpoints);
    const children = [...compiled.children.map(build), ...(held === undefined ? [] : (loose.get(held.id) ?? []))];
    const node: DocNode = { ...named, tag, styles, children };
    return withAuthoring(node, { role: 'node', key: compiled.key, owns, kind: 'structural' });
  };

  if (compilation.root.key !== ROOT_NODE) throw new Error('materialize: the compilation has no root');
  const { styles, owns } = rewriteStyles(context, container.styles, record.owns, compilation.root, ports.breakpoints);
  const children = [...compilation.root.children.map(build), ...(loose.get(container.id) ?? [])];
  // an element the composer wrote that the new structure drops may not take with it anything the person put inside
  for (const [key, node] of keyed) {
    if (used.has(key)) continue;
    if ((loose.get(node.id) ?? []).length > 0) refuse('content-missing', { region: node.name });
  }
  const next: ContainerRecord = { role: 'container', version: 1, intent: compilation.intent, owns };
  return withAuthoring({ ...container, styles, children }, next);
}
