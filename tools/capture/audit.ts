// Read-only import audit. It compares each boundary, never edits a reference, test or fidelity score.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Window, type Document as HappyDocument, type Node as HappyNode, type Element as HappyElement } from 'happy-dom';
import { parse as parseCss, walk as walkCss } from 'css-tree';
import type { CapturedNode, CapturedSnapshotPackage } from '../../src/core/document/captured.ts';
import { capturedAt } from '../../src/core/render/captured.ts';
import { rewriteSrcsetUrls } from '../../src/core/files/srcset.ts';
import type { DocumentJson } from '../../src/core/document/model.ts';
import type { AuditNode } from './audit-observation.ts';
import type { CapturedBox } from './reference.ts';
import { readReferenceManifest, readReferenceSnapshot, type RecordedObservation, type ReferenceManifest } from './reference.ts';
import { pagePath } from '../companion/capture.ts';

interface AuditIssue {
  readonly boundary: 'live-to-package' | 'package-to-project' | 'project-to-export' | 'resources' | 'layout' | 'reference';
  readonly kind: string;
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly confidence: 'exact' | 'structural' | 'ambiguous';
}

export interface WidthAudit {
  readonly site: string;
  readonly width: number;
  readonly stability: number | null;
  readonly score: number | null;
  readonly sourceNodes: number;
  readonly packageNodes: number | null;
  readonly projectNodes: number | null;
  readonly exportNodes: number | null;
  readonly issues: readonly AuditIssue[];
}

interface NodeView { readonly kind: 'element' | 'text' | 'comment'; readonly tag?: string; readonly namespace?: string; readonly text?: string; readonly attributes?: readonly { readonly name: string; readonly value: string }[]; readonly children?: readonly NodeView[] }
const internal = new Set(['data-capture-runtime', 'data-capture-class', 'data-capture-node', 'data-node', 'data-builder-capture']);
const urlAttributes = new Set(['src', 'srcset', 'poster', 'href', 'xlink:href', 'action', 'formaction']);
const trim = (value: string, size = 110): string => value.replace(/\s+/g, ' ').slice(0, size);

// A window per document, closed once the document is read: happy-dom keeps what a window's DOMParser made until the
// window is closed (https://github.com/capricorn86/happy-dom/issues/2148), and its close is asynchronous. One window
// for the whole corpus kept about 34 MB per parsed page and the audit of 20 sites ran out of memory.
async function htmlTree(html: string): Promise<NodeView> {
  const window = new Window();
  try {
    return copiedTree(new window.DOMParser().parseFromString(html, 'text/html'));
  } finally {
    await window.happyDOM.close();
  }
}

function copiedTree(document: HappyDocument): NodeView {
  const visit = (node: HappyNode): NodeView | null => {
    if (node.nodeType === 3) return { kind: 'text', text: node.nodeValue ?? '' };
    if (node.nodeType === 8) return { kind: 'comment', text: node.nodeValue ?? '' };
    if (node.nodeType !== 1) return null;
    const element = node as HappyElement;
    return { kind: 'element', tag: element.localName, namespace: element.namespaceURI ?? '', attributes: [...element.attributes].map((one) => ({ name: one.name, value: one.value ?? '' })), children: [...element.childNodes].map(visit).filter((one): one is NodeView => one !== null) };
  };
  const root = visit(document.documentElement);
  if (root === null) throw new Error('parsed HTML has no root element');
  return root;
}

function storedTree(node: CapturedNode): NodeView {
  return node.kind === 'element' ? { kind: 'element', tag: node.tag, namespace: node.namespace, attributes: node.attributes.map((one) => ({ name: one.name, value: one.value })), children: node.children.map(storedTree) }
    : { kind: node.kind, text: node.value };
}

function observedTree(node: AuditNode): NodeView {
  return node.kind === 'element' ? { kind: 'element', tag: node.tag, namespace: node.namespace, attributes: node.attributes, children: node.children.map(observedTree) }
    : { kind: node.kind, text: node.value };
}

function bodyOf(root: NodeView): NodeView {
  return root.children?.find((one) => one.kind === 'element' && one.tag === 'body') ?? root;
}

function childrenOf(node: NodeView): readonly NodeView[] {
  return (node.children ?? []).filter((one) => one.kind !== 'element' || one.tag !== 'script');
}

function attributesOf(node: NodeView): Map<string, string> {
  return new Map((node.attributes ?? []).filter((one) => !internal.has(one.name)).map((one) => [one.name, one.value]));
}

function signature(node: NodeView): string {
  if (node.kind !== 'element') return `${node.kind}:${trim(node.text ?? '', 45)}`;
  const id = attributesOf(node).get('id');
  if (id) return `${node.tag}#${id}`;
  const direct = childrenOf(node).filter((one) => one.kind === 'text').map((one) => one.text ?? '').join('');
  return `${node.tag}.${attributesOf(node).get('class') ?? ''}:${trim(direct, 40)}`;
}

function count(root: NodeView): number {
  return 1 + childrenOf(root).reduce((sum, child) => sum + count(child), 0);
}

function compare(expected: NodeView, actual: NodeView, boundary: AuditIssue['boundary'], issues: AuditIssue[]): void {
  const add = (kind: string, place: string, source: string, made: string, confidence: AuditIssue['confidence']) => issues.push({ boundary, kind, path: place, expected: trim(source), actual: trim(made), confidence });
  const visit = (a: NodeView, b: NodeView, at: string, confidence: AuditIssue['confidence']): void => {
    if (a.kind !== b.kind || a.tag !== b.tag || a.namespace !== b.namespace) {
      add('node-kind-or-tag', at, `${a.kind}:${a.tag ?? ''}`, `${b.kind}:${b.tag ?? ''}`, confidence);
      return;
    }
    if (a.kind !== 'element') {
      if (a.text !== b.text) add('text', at, a.text ?? '', b.text ?? '', confidence);
      return;
    }
    const aa = attributesOf(a), bb = attributesOf(b);
    for (const [name, value] of aa) {
      if (!bb.has(name)) add('missing-attribute', `${at}@${name}`, value, '', confidence);
      else if (!urlAttributes.has(name) && value !== bb.get(name)) add('changed-attribute', `${at}@${name}`, value, bb.get(name) ?? '', confidence);
    }
    for (const [name, value] of bb) if (!aa.has(name)) add('added-attribute', `${at}@${name}`, '', value, confidence);
    const ac = childrenOf(a), bc = childrenOf(b);
    const used = new Set<number>();
    const positions = new Map<string, number[]>();
    for (const [index, child] of bc.entries()) positions.set(signature(child), [...(positions.get(signature(child)) ?? []), index]);
    for (const [index, child] of ac.entries()) {
      const key = signature(child);
      const atIndex = bc[index];
      let match = atIndex !== undefined && !used.has(index) && signature(atIndex) === key ? index : -1;
      let certain: AuditIssue['confidence'] = confidence;
      if (match < 0) {
        const candidates = positions.get(key) ?? [];
        const unique = candidates.length === 1 ? candidates[0] : undefined;
        if (unique !== undefined && !used.has(unique)) {
          match = unique;
          certain = key.includes('#') ? 'exact' : 'structural';
        }
        else {
          const nearby = candidates.find((at) => !used.has(at) && Math.abs(at - index) <= 8);
          if (nearby !== undefined) {
            match = nearby;
            certain = 'ambiguous';
          }
        }
        if (match < 0 && index < bc.length && !used.has(index) && child.kind === bc[index]?.kind && child.tag === bc[index]?.tag) {
          match = index;
          certain = 'ambiguous';
        }
      }
      if (match < 0) {
        add('missing-node', `${at}/${index}`, key, '', certain);
        continue;
      }
      used.add(match);
      if (match !== index && certain !== 'ambiguous') add('moved-node', `${at}/${index}`, `${index}:${key}`, `${match}:${key}`, certain);
      const matched = bc[match];
      if (matched === undefined) throw new Error(`audit matched absent child at ${at}/${match}`);
      visit(child, matched, `${at}/${index}:${child.tag ?? child.kind}`, certain);
    }
    for (const [index, child] of bc.entries()) if (!used.has(index)) add('added-node', `${at}/${index}`, '', signature(child), 'structural');
  };
  visit(bodyOf(expected), bodyOf(actual), '/body', 'structural');
}

/**
 * Whether the export's whole-page picture is wider than the window while the original's is not: a page a person must
 * scroll sideways (the reviewer's R7, bellroy's export 1770 px wide in a 1180 px window). A source that is itself wider
 * than the window is the site's own overflow, not the export's; a pixel of rounding is allowed.
 */
export function overflowsWindow(width: number, sourceWidth: number | null, madeWidth: number | null): boolean {
  return sourceWidth !== null && madeWidth !== null && madeWidth > width + 1 && sourceWidth <= width + 1;
}

function pngWidth(file: string): number | null {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? bytes.readUInt32BE(16) : null;
}

function resourceIssues(folder: string, pageFile: string, root: NodeView, issues: AuditIssue[]): void {
  const report = (kind: string, place: string, expected: string, actual: string): void => {
    issues.push({ boundary: 'resources', kind, path: place, expected, actual, confidence: 'exact' });
  };
  const check = (address: string, from: string, place: string): void => {
    if (address === '' || /^(?:data:|blob:|#)/i.test(address)) return;
    let resolved: URL;
    try {
      resolved = new URL(address, new URL(from, 'https://capture.invalid/'));
    }
    catch {
      report('invalid-resource-url', place, 'resolvable URL', address);
      return;
    }
    if (resolved.origin !== 'https://capture.invalid') {
      report('external-resource', place, 'localized project file', resolved.href);
      return;
    }
    const file = path.join(folder, decodeURIComponent(resolved.pathname.slice(1)));
    if (!fs.existsSync(file)) report('missing-resource-file', place, file, 'absent');
  };
  const visit = (node: NodeView, at: string): void => {
    if (node.kind !== 'element') return;
    const attrs = attributesOf(node);
    for (const name of ['src', 'poster', 'data']) {
      const address = attrs.get(name);
      if (address !== undefined) check(address, pageFile, `${at}@${name}`);
    }
    const href = attrs.get('href');
    if (node.tag === 'link' && (attrs.get('rel') ?? '').split(/\s+/).includes('stylesheet') && href !== undefined) check(href, pageFile, `${at}@href`);
    const srcset = attrs.get('srcset');
    if (srcset !== undefined)
      rewriteSrcsetUrls(srcset, (url) => {
        check(url, pageFile, `${at}@srcset`);
        return url;
      });
    for (const [index, child] of childrenOf(node).entries()) visit(child, `${at}/${index}:${child.tag ?? child.kind}`);
  };
  visit(root, '/html');
  const cssFiles = fs.existsSync(folder) ? fs.readdirSync(folder, { recursive: true }).map(String).filter((name) => name.endsWith('.css')) : [];
  for (const name of cssFiles) {
    const file = path.join(folder, name);
    if (!fs.statSync(file).isFile()) continue;
    const source = fs.readFileSync(file, 'utf8');
    try {
      const stylesheet = parseCss(source);
      walkCss(stylesheet, (node) => {
        if (node.type === 'Url') check(node.value, name.replaceAll('\\', '/'), `${name}:url()`);
      });
    } catch { report('unparsed-css-resource-list', name, 'CSS resource list', 'parser could not inspect it'); }
  }
}

function geometry(source: readonly CapturedBox[], exported: readonly CapturedBox[], issues: AuditIssue[]): void {
  const fromId = new Map(source.filter((one) => one.id !== null).map((one) => [one.id, one]));
  for (const made of exported) {
    if (made.id === null) continue;
    const original = fromId.get(made.id);
    if (original === undefined) continue;
    const differences = (['x', 'y', 'width', 'height'] as const).filter((name) => Math.abs(original.bounds[name] - made.bounds[name]) > 2);
    if (differences.length > 0) issues.push({ boundary: 'layout', kind: 'geometry', path: `#${made.id}`, expected: JSON.stringify(original.bounds), actual: JSON.stringify(made.bounds), confidence: 'exact' });
    if (original.computed !== undefined && made.computed !== undefined) for (const [name, value] of Object.entries(original.computed)) if (value !== made.computed[name]) issues.push({ boundary: 'layout', kind: `computed-${name}`, path: `#${made.id}`, expected: value, actual: made.computed[name] ?? '', confidence: 'exact' });
  }
}

export async function auditWidth(site: { readonly id: string; readonly url: string }, width: number): Promise<WidthAudit> {
  const base = path.join('.cache', 'corpus');
  const out = path.join(base, site.id);
  const har = path.join(base, 'har', `${site.id}.har`);
  const reference = path.join(base, 'references', site.id);
  const issues: AuditIssue[] = [];
  const problem = (boundary: AuditIssue['boundary'], kind: string, at: string, expected: string, actual: string) => issues.push({ boundary, kind, path: at, expected, actual, confidence: 'exact' });
  const rawManifest = JSON.parse(fs.readFileSync(path.join(reference, 'manifest.json'), 'utf8')) as ReferenceManifest | (Omit<ReferenceManifest, 'format'> & { format: 4 });
  const legacy = rawManifest.format === 4;
  const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  if (rawManifest.url !== site.url || rawManifest.harSha256 !== digest(fs.readFileSync(har))) throw new Error(`${site.id}: reference manifest/HAR digest mismatch`);
  const manifest = legacy ? rawManifest : readReferenceManifest(site.url, har, reference);
  const entry = manifest.widths.find((one) => one.width === width);
  if (entry === undefined) throw new Error(`${site.id} ${width}: reference width absent`);
  const snapshotBytes = fs.readFileSync(path.join(reference, entry.snapshot));
  if (digest(snapshotBytes) !== entry.snapshotSha256) throw new Error(`${site.id} ${width}: source DOM digest mismatch`);
  const observation = legacy ? JSON.parse(snapshotBytes.toString('utf8')) as RecordedObservation : readReferenceSnapshot(site.url, har, reference, width);
  if (legacy) problem('reference', 'legacy-readiness-unknown', `${site.id}:${width}`, 'format 5 settle evidence', 'format 4 reference');
  // the live page as observed: a tree (DEC-61), or the HTML text of a reference recorded before it
  const legacyHtml = (observation.read as { html?: string }).html;
  const source = legacyHtml !== undefined ? await htmlTree(legacyHtml) : storedTree(observation.read.root as CapturedNode);
  const pageFile = pagePath(site.url);
  const packageFile = path.join(out, 'capture', `${pageFile}.capture.json`);
  const documentFile = path.join(out, 'document.json');
  const exportFile = path.join(out, `export-dom-${width}.json`);
  let packageNodes: number | null = null, projectNodes: number | null = null, exportNodes: number | null = null;
  if (!fs.existsSync(packageFile)) problem('live-to-package', 'missing-snapshot-package', packageFile, 'localized viewport HTML', 'absent');
  else {
    const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as CapturedSnapshotPackage;
    const legacyVariant = packageData.format === 1 ? packageData.viewports.find((one) => one.width === width) : undefined;
    const observed = packageData.format === 2 && packageData.widths.includes(width);
    if (legacyVariant === undefined && !observed) problem('live-to-package', 'missing-width', `${packageFile}:${width}`, 'localized viewport tree', 'absent');
    else {
      const tree = legacyVariant !== undefined ? await htmlTree(legacyVariant.html) : storedTree(capturedAt(packageData as Extract<CapturedSnapshotPackage, { format: 2 }>, width));
      packageNodes = count(bodyOf(tree));
      compare(source, tree, 'live-to-package', issues);
      resourceIssues(path.join(out, 'capture'), pageFile, tree, issues);
    }
    for (const missing of packageData.resourceProblems ?? []) problem('resources', missing.reason, missing.url, 'localized bytes', 'missing');
  }
  if (!fs.existsSync(documentFile)) problem('package-to-project', 'missing-project-observation', documentFile, 'saved imported JSON', 'absent');
  else {
    const document = JSON.parse(fs.readFileSync(documentFile, 'utf8')) as DocumentJson;
    const capture = document.pages.find((one) => one.file === pageFile)?.capture;
    const variant = capture === undefined || !capture.widths.includes(width) ? undefined : { root: capturedAt(capture, width) };
    if (variant === undefined) problem('package-to-project', 'missing-project-width', `${pageFile}:${width}`, 'captured JSON tree', 'absent');
    else {
      const tree = storedTree(variant.root);
      projectNodes = count(bodyOf(tree));
      if (fs.existsSync(packageFile)) {
        const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as CapturedSnapshotPackage;
        if (packageData.format === 2 && packageData.widths.includes(width)) compare(storedTree(capturedAt(packageData, width)), tree, 'package-to-project', issues);
        const packageVariant = packageData.format === 1 ? packageData.viewports.find((one) => one.width === width) : undefined;
        if (packageVariant !== undefined) compare(await htmlTree(packageVariant.html), tree, 'package-to-project', issues);
      }
      if (fs.existsSync(exportFile)) {
        const exported = observedTree(JSON.parse(fs.readFileSync(exportFile, 'utf8')) as AuditNode);
        exportNodes = count(bodyOf(exported));
        compare(tree, exported, 'project-to-export', issues);
      } else problem('project-to-export', 'missing-export-observation', exportFile, 'browser DOM after export', 'absent');
    }
  }
  const targetPng = path.join(reference, entry.file);
  const exportPng = path.join(out, `export-${width}.png`);
  const sourceWidth = pngWidth(targetPng), madeWidth = pngWidth(exportPng);
  if (overflowsWindow(width, sourceWidth, madeWidth)) problem('layout', 'horizontal-overflow', exportPng, `at most ${width}px`, `${madeWidth}px`);
  const exportLayout = path.join(out, `export-layout-${width}.json`);
  if (fs.existsSync(exportLayout)) geometry(observation.layout, JSON.parse(fs.readFileSync(exportLayout, 'utf8')) as CapturedBox[], issues);
  if (entry.stabilityMatch < 99) problem('reference', 'unstable-live-source', `${site.id}:${width}`, 'at least 99% live/live', `${entry.stabilityMatch}%`);
  if ('settle' in entry && entry.settle !== undefined && (!entry.settle.quiescent || entry.settle.pendingImages > 0 || entry.settle.scrollTruncated)) problem('reference', 'unsettled-live-source', `${site.id}:${width}`, 'quiescent DOM with complete image requests and finished scroll', JSON.stringify(entry.settle));
  const record = path.join(base, 'records', `${site.id}.json`);
  const measured = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) as { referenceManifestSha256?: string; widths?: { width: number; pixelMatchAdjusted: number }[] } : null;
  const currentDigest = digest(fs.readFileSync(path.join(reference, 'manifest.json')));
  const bound = measured?.referenceManifestSha256 === currentDigest;
  if (measured !== null && !bound) problem('reference', 'stale-export-score', record, currentDigest, measured.referenceManifestSha256 ?? 'unbound');
  return {
    site: site.id, width, stability: entry.stabilityMatch, score: bound ? measured?.widths?.find((one) => one.width === width)?.pixelMatchAdjusted ?? null : null,
    sourceNodes: count(bodyOf(source)), packageNodes, projectNodes, exportNodes, issues
  };
}
