// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// Export then import back keeps the project (the audit's AUD-05: the design tokens and every class no element used were
// dropped, on brand-title, classes-title, catalog-variants and site-colours). Every fixture is exported through
// project.export, the archive imported into an empty project through project.importHtml (replacing it), and exported
// again: the same pages with the same elements, the same declarations, the same variables (name, kind and value) and
// the same classes.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentJson } from '../document/model.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { unzip } from '../project/zip.ts';
import type { CommandId } from '../../generated/ids.ts';
import { createEditorStore, MODEL_RULES } from '../../editor/store.ts';
import { emptyProject } from '../../manifest/scenario.ts';
import { lexer as cssLexer } from 'css-tree';
import type { CssSupport } from '../ports/css.ts';

const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};
type Answer = { readonly status: string };
// the browser's CSS.supports, which the import asks what a value is (a variable's kind among them): happy-dom answers
// yes to every value, so a length variable read as a colour here and as a length in Chrome; css-tree's grammar answers
// as the browser does
const grammarCss: CssSupport = { supports: (property, value) => cssLexer.matchProperty(property, value).error === null };

async function exportedArchive(document: DocumentJson): Promise<Uint8Array> {
  let bytes: Uint8Array | null = null;
  const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1), ids: sequentialIds('x'), restored: { document, selection: [] }, ports: { readOnly: () => false, css: grammarCss, downloads: { deliver: (file) => void (bytes = file.bytes) } }, freeze: true });
  const answer = (store.dispatch as unknown as (id: CommandId, args: unknown) => Answer)('project.export' as CommandId, {});
  if (answer.status !== 'done' || bytes === null) throw new Error(`export: ${answer.status}`);
  return bytes;
}

async function exported(document: DocumentJson): Promise<Map<string, Uint8Array>> {
  return unzip(await exportedArchive(document));
}

function imported(files: Map<string, Uint8Array>): DocumentJson {
  const picked = [...files].map(([name, bytes]) => ({ name, type: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', bytes: Buffer.from(bytes).toString('base64') }));
  const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1), ids: sequentialIds('y'), restored: { document: emptyProject({ page: 'Home', root: 'Page' }, MODEL_RULES.root), selection: [] }, ports: { readOnly: () => false, css: grammarCss }, freeze: true });
  const dispatch = store.dispatch as unknown as (id: CommandId, args: unknown) => Answer;
  let answer = dispatch('project.importHtml' as CommandId, { files: picked, destination: 'replace' });
  if (answer.status === 'confirm') answer = store.answer(true) as Answer;
  if (answer.status !== 'done') throw new Error(`import: ${answer.status} ${JSON.stringify(store.getState().message)}`);
  return store.getState().document;
}

// every declaration of a stylesheet with the media block it stands in, sorted
const declarations = (css: string): string[] => {
  const out: string[] = [];
  let media = '';
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('@media')) media = line;
    else if (line === '}' && media !== '' && raw.startsWith('}')) media = '';
    const match = /^([a-z-]+)\s*:\s*(.+?);?$/.exec(line);
    if (match && !line.startsWith('@') && !line.endsWith('{')) out.push(`${media}|${match[1]}:${match[2]}`);
  }
  return out.sort();
};
// a page's elements without their classes and data attributes
const skeleton = (html: string): string => html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/\sclass="[^"]*"/g, '').replace(/\sdata-[a-z-]+="[^"]*"/g, '').replace(/\s+/g, ' ').trim();
const text = (files: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(files.get(name) ?? new Uint8Array());

const FIXTURES = fs.readdirSync('manifest/features/fixtures').filter((name) => name.endsWith('.json'));

describe('export then import back (AUD-05)', () => {
  it('writes the canonical fixture byte for byte again after importing its export', async () => {
    const document = JSON.parse(fs.readFileSync('manifest/features/fixtures/canonical.json', 'utf8')) as DocumentJson;
    const firstArchive = await exportedArchive(document);
    const first = await unzip(firstArchive);
    const againArchive = await exportedArchive(imported(first));
    const again = await unzip(againArchive);
    expect([...again.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [name, bytes] of first) expect(again.get(name), name).toEqual(bytes);
    expect(againArchive).toEqual(firstArchive);
  });

  it('keeps the pages, the declarations, the variables and the classes of every fixture', { timeout: 300_000 }, async () => {
    const losses: string[] = [];
    for (const name of FIXTURES) {
      const document = JSON.parse(fs.readFileSync(`manifest/features/fixtures/${name}`, 'utf8')) as DocumentJson;
      const first = await exported(document);
      const back = imported(first);
      const again = await exported(back);
      const pages = [...first.keys()].filter((file) => file.endsWith('.html')).sort();
      if (JSON.stringify(pages) !== JSON.stringify([...again.keys()].filter((file) => file.endsWith('.html')).sort())) losses.push(`${name}: pages`);
      for (const page of pages) if (skeleton(text(first, page)) !== skeleton(text(again, page))) losses.push(`${name}: the elements of ${page}`);
      const before = declarations(text(first, 'css/styles.css'));
      const after = declarations(text(again, 'css/styles.css'));
      const lost = before.filter((d) => !after.includes(d));
      const gained = after.filter((d) => !before.includes(d));
      if (lost.length > 0 || gained.length > 0) losses.push(`${name}: declarations lost ${JSON.stringify(lost.slice(0, 4))} gained ${JSON.stringify(gained.slice(0, 4))}`);
      const tokens = (d: DocumentJson) => JSON.stringify((d.tokens ?? []).map((t) => [t.name, t.kind, t.value]));
      if (tokens(document) !== tokens(back)) losses.push(`${name}: variables ${tokens(document)} → ${tokens(back)}`);
      const classes = (d: DocumentJson) => JSON.stringify((d.classes ?? []).map((c) => [c.name, c.styles]).sort());
      if (classes(document) !== classes(back)) losses.push(`${name}: classes ${classes(document).slice(0, 200)} → ${classes(back).slice(0, 200)}`);
    }
    expect(losses).toEqual([]);
  });
});

describe('imported variables beside the project\'s', () => {
  const importAsPage = (files: Map<string, Uint8Array>, into: DocumentJson): DocumentJson => {
    const picked = [...files].map(([name, bytes]) => ({ name, type: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream', bytes: Buffer.from(bytes).toString('base64') }));
    const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1), ids: sequentialIds('z'), restored: { document: into, selection: [] }, ports: { readOnly: () => false, css: grammarCss }, freeze: true });
    const answer = (store.dispatch as unknown as (id: CommandId, args: unknown) => Answer)('project.importHtml' as CommandId, { files: picked, destination: 'page' });
    if (answer.status !== 'done') throw new Error(`import: ${answer.status}`);
    return store.getState().document;
  };

  it('keeps one variable the project already holds as it is, and renames one whose name holds another value', async () => {
    const fixture = JSON.parse(fs.readFileSync('manifest/features/fixtures/brand-title.json', 'utf8')) as DocumentJson;
    // its title painted with the variable, so the variable's uses can be followed
    const title = fixture.pages[0]?.tree.children[0];
    if (title === undefined) throw new Error('brand-title has no title');
    const painted = { ...title, styles: { ...title.styles, desktop: { base: { ...(title.styles.desktop?.base ?? {}), color: 'var(--brand)' } } } };
    const brand: DocumentJson = { ...fixture, pages: [{ ...(fixture.pages[0] as DocumentJson['pages'][number]), tree: { ...(fixture.pages[0] as DocumentJson['pages'][number]).tree, children: [painted] } }] };
    const files = await exported(brand);
    // the same variable: it goes once
    const same = importAsPage(files, brand);
    expect((same.tokens ?? []).map((t) => [t.name, t.value])).toEqual([['brand', '#0b7f72']]);
    // another value under the name: the imported one takes a free name, and its page's values name it
    const other = { ...brand, tokens: [{ name: 'brand', kind: 'color', value: '#111111' }] };
    const merged = importAsPage(files, other);
    expect((merged.tokens ?? []).map((t) => [t.name, t.value])).toEqual([['brand', '#111111'], ['brand-2', '#0b7f72']]);
    const added = merged.pages.at(-1);
    expect(JSON.stringify(added?.tree)).toContain('var(--brand-2)');
    expect(JSON.stringify(added?.tree)).not.toContain('var(--brand)');
  });
});
