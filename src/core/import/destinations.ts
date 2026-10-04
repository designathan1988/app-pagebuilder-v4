// Compose parsed pages into the requested destination; parsing and style writing remain in import.ts.
import { allNodes, locate, type DocumentJson, type NodeId } from '../document/model.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import { renameClassPatches } from '../design/classes.ts';
import { renameTokenPatches } from '../design/tokens.ts';
import { uniqueFilePath } from '../files/files.ts';
import { addressAttributes, followPaths } from '../files/references.ts';
import { applyPatches, type Patch } from '../history/transaction.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { message, type HandlerContext } from '../commands/registry.ts';

export function importDestination(context: HandlerContext<never>, parsed: DocumentJson, destination: 'page' | 'inside' | 'replace', target?: NodeId): { patches: Patch[]; selection: NodeId[] } | { refused: ReturnType<typeof message> } {
  const current = context.state.document;
  const first = parsed.pages[0];
  if (first === undefined) return { refused: message('status.import.noPage') };
  if (destination === 'replace') return {
    patches: [
      ...Object.keys(current).filter(key => !(key in parsed)).map((key): Patch => ({ op: 'remove', path: [key] })),
      ...Object.entries(parsed).map(([key, value]): Patch => ({ op: key in current ? 'replace' : 'add', path: [key], value })),
    ],
    selection: [first.tree.id],
  };
  let imported = parsed;
  const occupied = new Set([...allNodes(current)].flatMap(node => node.classes));
  for (const item of current.classes ?? []) occupied.add(item.name);
  const classes = new Set([...allNodes(imported)].flatMap(node => node.classes));
  for (const item of imported.classes ?? []) classes.add(item.name);
  for (const name of classes) {
    let next = name;
    for (let n = 2; occupied.has(next) || (next !== name && classes.has(next)); n += 1) next = `${name}-${n}`;
    occupied.add(next);
    if (next !== name) imported = applyPatches(imported, renameClassPatches(imported, name, next)).document;
  }
  // the imported variables beside the project's (AUD-05): one the project holds as it is, by name, kind and value, is
  // the same and goes once; one whose name the project uses for another value takes a free name, and its uses follow it
  const held = current.tokens ?? [];
  const arriving: string[] = [];
  for (const token of imported.tokens ?? []) {
    const same = held.find((one) => one.name === token.name);
    if (same !== undefined && same.kind === token.kind && same.value === token.value) continue;
    let next = token.name;
    for (let n = 2; held.some((one) => one.name === next) || (next !== token.name && (imported.tokens ?? []).some((one) => one.name === next)); n += 1) next = `${token.name}-${n}`;
    if (next !== token.name) imported = applyPatches(imported, renameTokenPatches(imported, token.name, next)).document;
    arriving.push(next);
  }
  const paths = new Map<string, string>();
  const reserved = new Set<string>();
  for (const path of [...imported.pages.map(page => page.file), ...(imported.files ?? []).map(file => file.path)]) {
    const next = uniqueFilePath(current, path, reserved);
    reserved.add(next);
    paths.set(path, next);
  }
  imported = applyPatches(imported, followPaths(imported, path => paths.get(path) ?? path, undefined, addressAttributes(context.rules))).document;
  const names = new Set(current.pages.map(page => page.name));
  const pages = imported.pages.map(page => {
    let name = page.name;
    for (let n = 2; names.has(name); n += 1) name = `${page.name} ${n}`;
    names.add(name);
    return { ...page, name, file: paths.get(page.file) ?? page.file };
  });
  const files = (imported.files ?? []).map(file => ({ ...file, path: paths.get(file.path) ?? file.path }));
  const patches: Patch[] = [];
  let selection: NodeId[];
  if (destination === 'inside') {
    const parent = target === undefined ? null : locate(current, target);
    if (!parent || parent.node.tag === null) return { refused: message('status.import.insideRefused') };
    const locked = lockRefusal(current, parent.node.id, 'status.locked.edit');
    if (locked) return { refused: locked };
    const bodies = pages.map(page => ({ ...page.tree, type: 'div' as const, tag: 'div', attributes: Object.fromEntries(Object.entries(page.tree.attributes).filter(([name]) => {
      const applies = context.rules.attributes.get(name);
      return applies === 'all' || applies?.includes('div');
    })) }));
    if (placementRefusal(current, context.rules, parent.node.id, bodies) !== null) return { refused: message('status.import.insideRefused') };
    const repaired = refreshCopiedIdentities(current, bodies.map(node => ({ source: node, copy: node })), 'collisions');
    for (const [i, node] of repaired.entries()) patches.push({ op: 'add', path: [...parent.path, 'children', parent.node.children.length + i], value: node });
    selection = repaired.map(node => node.id);
    const scripts = pages.flatMap(page => String(page.tree.attributes.pageScripts ?? '').split(/\s+/).filter(Boolean));
    if (scripts.length > 0) {
      const host = current.pages.find(page => [...allNodes({ version: current.version, pages: [page] })].some(node => node.id === parent.node.id));
      if (host) {
        const at = current.pages.indexOf(host);
        const before = host.tree.attributes.pageScripts;
        patches.push({ op: before === undefined ? 'add' : 'replace', path: ['pages', at, 'tree', 'attributes', 'pageScripts'], value: [before ?? '', ...scripts].filter(Boolean).join(' ') });
      }
    }
  } else {
    for (const [i, page] of pages.entries()) patches.push({ op: 'add', path: ['pages', current.pages.length + i], value: page });
    selection = [first.tree.id];
  }
  const tokens = (imported.tokens ?? []).filter((token) => arriving.includes(token.name));
  if (tokens.length) patches.push({ op: current.tokens === undefined ? 'add' : 'replace', path: ['tokens'], value: [...held, ...tokens] });
  if (imported.classes?.length) patches.push({ op: current.classes === undefined ? 'add' : 'replace', path: ['classes'], value: [...(current.classes ?? []), ...imported.classes] });
  if (files.length) patches.push({ op: current.files === undefined ? 'add' : 'replace', path: ['files'], value: [...(current.files ?? []), ...files] });
  return { patches, selection };
}
