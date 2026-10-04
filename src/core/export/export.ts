// The export (INVENTORY.md, owners; spec export-zip): project.export hands the person site.zip, written by
// the one ZIP writer (core/project/zip.ts), holding each page at its file's path in the project (index.html for the
// home page) and the stylesheet css/styles.css it links. Nothing of the editor reaches the files: no data attribute of
// the renderer, no node id, no editor class or rule, no style attribute or <style> element.
//  - The page's HTML: <!DOCTYPE html>, <html> with the page's language and direction when its settings hold them, a
//    head of <meta charset="utf-8">, the viewport, the title (its setting, else the page's name) and the stylesheet
//    link, then the page root as the <body>. Each element is written with its tag and the attributes the page writes
//    (render.ts elementAttributes, the canvas's rule); a hidden element carries the hidden attribute, its subtree in
//    it. A text is escaped (& < > as entities, " too in an attribute), its marks as <strong>, <em> and <a href>, a line
//    break as <br>; an embed's markup is written as it is. A void element has no end tag.
//  - Classes (spec export-bem-css): an element with styles of its own gets a BEM class from its layer name (lower
//    case, words joined by "-"): outside every styled element it is a block (Hero → hero); inside one it is an element
//    of the outermost styled ancestor below the page (Title in Hero → hero__title); with an author class it is a
//    modifier of its first class (card named Plano assinatura → card--plano-assinatura). A class already taken gets a
//    numeric suffix (hero-2). The author classes come first; an element with neither has no class attribute.
//  - Two exports of the same document are byte-identical: the archive's entries carry a fixed time.
//  - The stylesheet: the design tokens' :root rule, then, under the heading /* Classes */, one rule per style class
//    that holds styles, in the project's order (spec shared-style-classes: before the elements', so an element's own
//    values override its classes), then, under /* Elements */, one rule per styled element, in document order, one
//    declaration per line indented by two spaces, a breakpoint's values in an @media block and a state's under its
//    pseudo-class (render.ts nodeCss, the canvas's). The headings let the import read the classes back
//    (sheet-headings.ts).
// Exporting changes nothing in the document and records nothing; the status bar names the file.
import { message, registerHandler } from '../commands/registry.ts';
import { slug } from '../text/fold.ts';
import { namingFor, roleWord, variantModifier, type Declarations, type Look, type Naming } from './names.ts';
import { mergeCssLines } from '../render/clean.ts';
import { CLASSES_HEADING, ELEMENTS_HEADING } from './sheet-headings.ts';
import { formNodes } from './authoring.ts';
import { capturedPageStylePath, capturedPageCss, captureAssetPath } from '../import/capture-styles.ts';
import type { NodeId } from '../../generated/commands.ts';
import { walk, type Animation, type DocNode, type DocumentJson } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { zip } from '../project/zip.ts';
import { baseCss, capturedBaseCss } from '../render/base.ts';
import { classesCss, elementAttributes, fileUrlsIn, mediaQuery, nodeCss, writesNode } from '../render/output.ts';
import { svgMarkupOf } from '../elements/svg.ts';
import { dataUrl, fileAt, fileBytes, relativePath } from '../files/files.ts';
import { filesOf } from '../document/model.ts';
import { fontFaceCss, fontFiles } from '../files/fonts.ts';
import { exportPath, exportValue } from '../files/values.ts';
import { rootCss } from '../design/tokens.ts';
import type { InlineRun } from '../text/inline.ts';
import { animationsOf, keyframesCss, playedClassDeclarations, playedClassName, animationListDeclarations } from '../animation/animation.ts';
import { addressedNodes, playedAnimations } from '../events/interactions.ts';
import { interactionsJs, isModalTemplate, isTabsTemplate, pageNeedsScript } from '../events/script.ts';
import type { SiteScripts } from '../ports/site-scripts.ts';
import { addressedMotionNodes, treeUsesMotion } from '../motion/document.ts';
import { motionConfig, siteUsesLottie } from '../motion/export.ts';
import { rulesForDocument } from '../document/breakpoint-rules.ts';
import { FORMS_SCRIPT, INTERACTIONS_SCRIPT, LOTTIE_SCRIPT, MOTION_SCRIPT, STYLESHEET } from './paths.ts';

export const SITE_ARCHIVE = 'site.zip';
// the generated files' paths (paths.ts, the one list the file tree reads too), published here for the editor
export { FORMS_SCRIPT, INTERACTIONS_SCRIPT, LOTTIE_SCRIPT, MOTION_SCRIPT, STYLESHEET } from './paths.ts';
const pageUsesForms = (tree: DocNode): boolean => [...walk(tree)].some(node => node.attributes.formField !== undefined || node.attributes.formSubmit !== undefined);
// the page setting that is the page's title (elements.json), written in the head rather than as an attribute
const TITLE_SETTING = 'pageTitle';

const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (text: string): string => escapeText(text).replaceAll('"', '&quot;');

// The page's own head settings (spec export-zip; the user's real-use audit, 7.2): each attribute elements.json maps to
// the head (`head`: "meta:description", "link:canonical", "script:") is written there, in the manifest's order, as a
// meta name, a meta property (og:, twitter:), a link or a script src; a path list (the linked scripts) writes one
// script per entry. Nothing set writes nothing.
function headLines(document: DocumentJson, page: DocNode, rules: ModelRules, from: string): string[] {
  const lines: string[] = [];
  // a script of the project is written where the page stands (the same rule an element's address asks)
  const written = (value: string) => exportValue(document, 'src', value, from) ?? value;
  for (const [id, facts] of rules.attributeValues) {
    if (facts.head === null) continue;
    const held = (page.attributes as Readonly<Record<string, unknown>>)[id];
    if (typeof held !== 'string' || held === '') continue;
    const [form, name = ''] = facts.head.split(/:(.*)/s) as [string, string?];
    const values = facts.valueType === 'path-list' ? held.split(/\s+/).filter((each) => each !== '') : [held];
    for (const value of values) {
      if (form === 'script') {
        if (!generatedScriptPaths.includes(value)) lines.push(`  <script src="${escapeAttribute(written(value))}"></script>`);
      }
      else if (form === 'link') lines.push(`  <link rel="${escapeAttribute(name)}" href="${escapeAttribute(value)}">`);
      else if (name.startsWith('og:') || name.startsWith('twitter:')) lines.push(`  <meta property="${escapeAttribute(name)}" content="${escapeAttribute(value)}">`);
      else lines.push(`  <meta name="${escapeAttribute(name)}" content="${escapeAttribute(value)}">`);
    }
  }
  return lines;
}

const generatedScriptPaths: readonly string[] = [INTERACTIONS_SCRIPT, FORMS_SCRIPT, LOTTIE_SCRIPT, MOTION_SCRIPT];
const linksScript = (page: DocNode, path: string): boolean =>
  typeof page.attributes.pageScripts === 'string' && page.attributes.pageScripts.split(/\s+/).includes(path);

// a text's runs as HTML: marks as their elements, a line break as <br>
function runsHtml(runs: readonly InlineRun[], resolve: (href: string) => string): string {
  return runs
    .map((run) => {
      if (typeof run === 'string') return run.split('\n').map(escapeText).join('<br>');
      const href = run.tag === 'a' ? ` href="${escapeAttribute(resolve(run.href))}"` : '';
      return `<${run.tag}${href}>${runsHtml(run.children, resolve)}</${run.tag}>`;
    })
    .join('');
}

const hasStyles = (node: DocNode): boolean => Object.values(node.styles).some((byState) => byState !== undefined && Object.values(byState).some((d) => d !== undefined && Object.keys(d).length > 0));

// a layer name as a class: lower case, every run of other characters one "-", none at either end
function classOf(name: string, fallback: string): string {
  // "Seção" -> "secao", "Título" -> "titulo": accents are dropped, never turned into dashes (text/fold.ts slug)
  const words = slug(name);
  return words === '' || /^[0-9]/.test(words) ? fallback : words;
}

// The classes the elements of instances share across the pages of one export (spec reusable-components): per component
// and definition part, the class the first styled element of that part got and the styles it holds; and the elements
// that took such a class, whose rule the stylesheet already holds.
interface SharedClasses {
  readonly parts: Map<string, { readonly name: string; readonly styles: string }>;
  readonly reused: Set<string>;
  // every class name the export has given or the project holds: one stylesheet serves every page, so a generated
  // name is unique across the pages and never one of the project's own classes ("card" of a class and "Card" of an
  // element would otherwise share one rule)
  readonly taken: Set<string>;
  readonly identities: Map<string, string>;
  // how the names are read (core/export/names.ts: roles in the code language), and the base breakpoint and state whose
  // declarations say how an element looks
  readonly naming: Naming;
  readonly baseLayer: { readonly breakpoint: string; readonly state: string };
  // the look of the element that first took each generated name: a second look takes a modifier that says how it
  // differs (none: a class of the person's holds the name)
  readonly looks: Map<string, Look>;
}
const newShared = (document: DocumentJson, rules: ModelRules): SharedClasses => {
  const taken = new Set<string>((document.classes ?? []).map((one) => one.name));
  for (const page of document.pages) for (const node of walk(page.tree)) for (const own of node.classes) taken.add(own);
  const naming = namingFor(document.language, document.codeLanguage ?? 'en', rules);
  return { parts: new Map(), reused: new Set(), taken, identities: new Map(), naming, baseLayer: rules.baseLayer, looks: new Map() };
};
// an element's declarations at the base breakpoint and state
const baseDeclarations = (node: DocNode, layer: SharedClasses['baseLayer']): Declarations =>
  (node.styles as Readonly<Record<string, Readonly<Record<string, Declarations>>>>)[layer.breakpoint]?.[layer.state] ?? {};

// The generated class of every styled node of a tree, in document order, unique within it: a block, an element of
// its block (the outermost styled ancestor below the page), or a modifier of its first author class. An element of an
// instance holding the same styles as an element of the same part met before takes that element's class. An element an
// interaction addresses (the one that holds one, or one an interaction acts on) takes a class too, so the script can
// select it (spec export-events-js): it carries the class in the HTML, and writes a rule only when it holds styles.
function generatedClasses(tree: DocNode, shared: SharedClasses, addressed: ReadonlySet<NodeId> = new Set()): Map<string, string> {
  const taken = shared.taken;
  const classes = new Map<string, string>();
  // the base name for the first look, a modifier of it for every other look (core/export/names.ts variantModifier)
  const unique = (base: string, look: Look) => {
    let name = base;
    if (taken.has(base)) {
      const joiner = base.includes('--') ? '-' : '--';
      name = `${base}${joiner}${variantModifier(look, shared.looks.get(base) ?? null, shared.naming.code, (word) => !taken.has(`${base}${joiner}${word}`))}`;
    } else shared.looks.set(base, look);
    taken.add(name);
    return name;
  };
  const visit = (node: DocNode, block: string | null, root: boolean, instanceOf: string | null) => {
    for (const own of node.classes) taken.add(own);
    let inner = block;
    const within = node.component ?? instanceOf;
    if (hasStyles(node) || addressed.has(node.id as NodeId)) {
      const key = within !== null && node.componentPart !== undefined ? `${within}|${node.componentPart.join('.')}` : null;
      const styles = JSON.stringify(node.styles);
      const met = key === null ? undefined : shared.parts.get(key);
      const author = node.classes[0];
      let name: string;
      if (met !== undefined && met.styles === styles) {
        name = met.name;
        taken.add(name);
        shared.reused.add(node.id);
      } else {
        const look: Look = { tag: node.tag, declarations: baseDeclarations(node, shared.baseLayer) };
        const word = classOf(roleWord({ name: node.name, type: node.type, tag: node.tag, declarations: look.declarations }, shared.naming), node.type.toLowerCase());
        const base = author !== undefined ? `${author}--${word}` : block !== null ? `${block}__${word}` : word;
        const identity = JSON.stringify([base, node.type, node.styles, node.animations ?? [], addressed.has(node.id as NodeId) ? node.id : null]);
        const reused = shared.identities.get(identity);
        name = reused ?? unique(base, look);
        if (reused !== undefined) shared.reused.add(node.id);
        else shared.identities.set(identity, name);
        if (key !== null && met === undefined) shared.parts.set(key, { name, styles });
      }
      classes.set(node.id, name);
      // the outermost styled element below the page is the block of every styled element inside it: its role, never
      // its modifier (BEM: an element of a block, not of a modifier)
      if (block === null && !root && author === undefined) inner = name.split('--')[0] ?? name;
    }
    node.children.forEach((child) => visit(child, inner, false, within));
  };
  visit(tree, null, true, null);
  return classes;
}

const attributesHtml = (attributes: ReadonlyMap<string, string | true>): string => [...attributes].map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`)).join('');

// One line of a generated file, and the node it was written for; null on a line the document did not write (the
// head, the shell). The code pane reads these to follow the selection and to select from a click (spec
// code-panel-selection-sync): the export writes no node id into the file, so the writer is the only one who knows
// which node a line belongs to — this is why the lines are written here and nowhere else.
export interface CodeLine {
  readonly text: string;
  readonly node: NodeId | null;
}
export interface PageCode {
  readonly html: readonly CodeLine[];
  readonly css: readonly CodeLine[];
  // the class the export gave each node of the page that has one (the stylesheet's selectors; the interactions script
  // addresses elements by them)
  readonly classes: ReadonlyMap<string, string>;
}

// One page of the document as its HTML file and its CSS.
export function exportPage(document: DocumentJson, pageIndex: number, rules: ModelRules, shared: SharedClasses = newShared(document, rules)): { readonly html: string; readonly css: string } {
  const code = pageLines(document, pageIndex, rules, shared);
  return { html: code.html.map((line) => line.text).join('\n'), css: pageCss(code.css) };
}

// A page's CSS as text: one blank line between rules, a line's end at the end, as the export writes it.
export const pageCss = (css: readonly CodeLine[]): string => (css.length === 0 ? '' : `${css.map((line) => line.text).join('\n')}\n`);

// An address a declaration names, as the file it sits in resolves it: an address naming a file or a page of the project
// is written relative to the stylesheet that holds it (css/styles.css), which is what the browser that loads it does —
// the same rule exportValue asks for an attribute, so `background-image: url("img/hero.png")` is written
// `url("../img/hero.png")` and the exported page draws it. Everything else (an https:, data: or fragment address, an
// already relative one) stands. The preview writes the stored paths (relative = false) and draws them from the bytes
// itself (previewPage), as the canvas does.
const writtenCss = (document: DocumentJson, text: string, from: string): string => fileUrlsIn(text, (address) => exportValue(document, 'src', address, from) ?? address);

// One page's HTML and CSS as lines, each with the node it was written for.
// Whether line breaks between an element's children would show (the journey "site": in the export a form's label text
// stood 5 px further from its field than on the canvas, which draws no space there): two neighbours that run on in the
// line (HTML's phrasing content: a span and an input, two links, two images) are parted by a space where a line break
// stands between them, unless the element lays its children out as a flex or a grid in every layer of its own styles
// (its own display overrides its classes': its rule comes after theirs).
const LAYOUTS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);
function runsOn(node: DocNode, inner: readonly DocNode[], rules: ModelRules): boolean {
  const inline = (child: DocNode): boolean => child.tag !== null && rules.contentModel.phrasing(child.tag) === true;
  if (!inner.some((child, i) => i > 0 && inline(child) && inline(inner[i - 1] as DocNode))) return false;
  const displays = Object.values(node.styles).flatMap((byState) => Object.values(byState ?? {}).map((held) => (held as Readonly<Record<string, string>>).display)).filter((d) => d !== undefined);
  const base = (node.styles[rules.baseLayer.breakpoint as keyof DocNode['styles']] as Readonly<Record<string, Readonly<Record<string, string>>>> | undefined)?.[rules.baseLayer.state]?.display;
  return !(base !== undefined && LAYOUTS.has(base) && displays.every((d) => LAYOUTS.has(d as string)));
}

export function pageLines(document: DocumentJson, pageIndex: number, manifestRules: ModelRules, shared: SharedClasses = newShared(document, manifestRules), relative = true): PageCode {
  // the project's breakpoints: its media queries (core/document/breakpoints.ts)
  const rules = rulesForDocument(manifestRules, document);
  const page = document.pages[pageIndex];
  if (page === undefined) throw new Error(`export: the document has no page ${pageIndex}`);
  // the elements an interaction addresses, and every element that holds an animation: both take a class, so the script
  // (and the animation's own rule) can name them
  // the elements an interaction or a motion addresses take a class of their own (spec export-events-js,
  // export-motion-js)
  const addressed = new Set<NodeId>([...addressedNodes(document), ...addressedMotionNodes(document)]);
  for (const page of document.pages) for (const node of walk(page.tree)) if (animationsOf(node).length > 0 || isModalTemplate(node) || isTabsTemplate(node)) addressed.add(node.id as NodeId);
  const classes = generatedClasses(page.tree, shared, addressed);
  const inForm = formNodes(document);
  // the file the page is written at: the base of every address it holds (the preview writes absolute paths, which it
  // then turns into object URLs of its own)
  const from = relative ? page.file : '';
  const { output, contentModel } = rules;
  // the animations an event of this project plays: their animation properties go to a class rule beside their
  // @keyframes rather than the element's own rule, so nothing plays until the event fires (spec export-events-js)
  const played = playedAnimations(document);
  // the page's animations: by name, and the elements each is written for (the reduced-motion rule's selectors)
  const ownAnimations = new Map<string, { readonly animation: Animation; readonly selector: string }>();
  const eventAnimations = new Map<string, { readonly animation: Animation; readonly selector: string }>();
  const body: CodeLine[] = [];
  const css: CodeLine[] = [];
  let pageAttributes = new Map<string, string>();
  // The writer: each element on its own line, indented, into `lines`; an element whose children run on in the line
  // (runsOn) is written whole on its own line, its subtree in one string (`lines` null below it).
  const write = (node: DocNode, depth: number, root: boolean, lines: CodeLine[] | null = body): string => {
    const tag = node.tag ?? 'div';
    const own = elementAttributes(node, tag, root, output, (name, value) => exportValue(document, name, value, from), { language: document.language ?? 'en', inForm: inForm.has(node.id) });
    if (root) pageAttributes = own.page;
    const generated = classes.get(node.id);
    const attributes = new Map(own.element);
    if (generated !== undefined) {
      attributes.set('class', [...node.classes, generated].join(' '));
      const held = animationsOf(node);
      const byEvent = played.get(node.id as NodeId) ?? new Set<string>();
      for (const animation of held) (byEvent.has(animation.name) ? eventAnimations : ownAnimations).set(animation.name, { animation, selector: `.${generated}` });
      // a class the elements of instances share is written once, by the first of them
      if (!shared.reused.has(node.id)) {
        const plain = held.filter((animation) => !byEvent.has(animation.name));
        const block = nodeCss(node, `.${generated}`, output, 'block', null, animationListDeclarations(plain));
        if (block !== '') for (const text of block.split('\n')) css.push({ text, node: node.id });
      }
    }
    if (node.hidden === true) attributes.set('hidden', true);
    const indent = lines === null ? '' : '  '.repeat(depth);
    const open = `${indent}<${tag}${attributesHtml(attributes)}>`;
    const put = (text: string): string => {
      lines?.push({ text, node: node.id });
      return text;
    };
    if (contentModel.isVoid(tag)) return put(open);
    const content = output.elements.get(node.type)?.content;
    if (content === 'text' || content === 'markup') {
      return put(`${open}${content === 'text' ? runsHtml(node.inline ?? [node.text ?? ''], href => exportPath(document, href, from)) : (node.text ?? '')}</${tag}>`);
    }
    // an SVG's markup after its shapes (core/elements/svg.ts)
    const markup = svgMarkupOf(node);
    const inner = node.children.filter((child) => writesNode(child, output));
    if (inner.length === 0 && markup === '') return put(`${open}</${tag}>`);
    if (lines === null || runsOn(node, inner, rules)) return put(`${open}${inner.map((child) => write(child, 0, false, null)).join('')}${markup}</${tag}>`);
    put(open);
    for (const child of inner) write(child, depth + 1, false, lines);
    if (markup !== '') lines.push({ text: `${indent}  ${markup}`, node: node.id });
    return put(`${indent}</${tag}>`);
  };
  // the body first: writing it is what reads the page's own attributes, which the <html> line carries
  if (writesNode(page.tree, output)) write(page.tree, 0, true);
  // The page's animations, after its rules: the @keyframes of every animation it holds, the class rule of every
  // animation an event plays (spec export-events-js: the script adds that class when the event fires), and the rule
  // that turns the animations off for a reduced-motion reader. Nothing of it is written when the page has none, so a
  // page without animations exports exactly as before (spec export-keyframes).
  const hasAnimations = ownAnimations.size > 0 || eventAnimations.size > 0;
  if (hasAnimations) {
    const selectors = [...ownAnimations.values()].map((entry) => entry.selector).concat([...eventAnimations.keys()].map((name) => `.${playedClassName(name)}`));
    const reduced = `@media (prefers-reduced-motion: reduce) {\n  ${selectors.join(',\n  ')} {\n    animation: none;\n  }\n}`;
    for (const text of [...new Set([...ownAnimations.keys(), ...eventAnimations.keys()])]
      .map((name) => (ownAnimations.get(name) ?? eventAnimations.get(name))?.animation)
      .filter((animation): animation is Animation => animation !== undefined)
      .flatMap((animation) => keyframesCss(animation, output, 'block').split('\n'))
      .concat(
        [...eventAnimations.values()].flatMap((entry) => [
          `.${playedClassName(entry.animation.name)} {`,
          ...playedClassDeclarations(entry.animation).map((line) => `  ${line}`),
          '}',
        ]),
        reduced.split('\n'),
      ))
      css.push({ text, node: null });
  }
  const stored = page.tree.attributes[TITLE_SETTING as keyof DocNode['attributes']];
  const title = typeof stored === 'string' && stored !== '' ? stored : page.name;
  // a page that uses interactions links the script (spec export-events-js); one that does not, does not
  const usesInteractions = pageNeedsScript(page.tree);
  const capturedStyle = fileAt(document, capturedPageStylePath(page));
  if (capturedStyle !== null) {
    pageAttributes.set('data-builder-capture', '');
    const rootClasses = pageAttributes.get('class');
    if (rootClasses !== undefined && rootClasses !== '') pageAttributes.set('data-capture-class', rootClasses);
  }
  const head: CodeLine[] = [
    '<!DOCTYPE html>',
    `<html${attributesHtml(pageAttributes)}>`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeText(title)}</title>`,
    ...headLines(document, page.tree, rules, from),
    ...(capturedStyle === null ? [] : [`  <link rel="stylesheet" href="${escapeAttribute(relativePath(from, capturedPageStylePath(page)))}">`]),
    `  <link rel="stylesheet" href="${escapeAttribute(relativePath(from, STYLESHEET))}">`,
    ...(usesInteractions || linksScript(page.tree, INTERACTIONS_SCRIPT) ? [`  <script defer src="${escapeAttribute(relativePath(from, INTERACTIONS_SCRIPT))}"></script>`] : []),
    ...(pageUsesForms(page.tree) || linksScript(page.tree, FORMS_SCRIPT) ? [`  <script defer src="${escapeAttribute(relativePath(from, FORMS_SCRIPT))}"></script>`] : []),
    // a page holding motion links the Lottie player when the site uses one, then the motion script
    ...(treeUsesMotion(page.tree) && siteUsesLottie(document) || linksScript(page.tree, LOTTIE_SCRIPT) ? [`  <script defer src="${escapeAttribute(relativePath(from, LOTTIE_SCRIPT))}"></script>`] : []),
    ...(treeUsesMotion(page.tree) || linksScript(page.tree, MOTION_SCRIPT) ? [`  <script defer src="${escapeAttribute(relativePath(from, MOTION_SCRIPT))}"></script>`] : []),
    '</head>',
  ].map((text) => ({ text, node: null }));
  const html: CodeLine[] = [...head, ...body, { text: '</html>', node: null }, { text: '', node: null }];
  // the stylesheet's own addresses, written as the stylesheet resolves them (the archive holds it at css/styles.css)
  const sheet = relative ? css.map((line) => ({ text: writtenCss(document, line.text, STYLESHEET), node: line.node })) : css;
  return { html, css: sheet, classes };
}

// the time every entry of the archive carries: the ZIP format's first day, so the same document gives the same bytes
const FIXED_TIME = Date.UTC(1980, 0, 1);

// The site's files: each page's HTML, by its file, and the one stylesheet they link (the export writes them; the
// preview shows them). `cssLines` is the same stylesheet line by line, each line of a page's rule carrying its node —
// what the code pane follows the selection with; the base style, the tokens and the classes are lines no node was
// written for.
export function siteFiles(
  document: DocumentJson,
  manifestRules: ModelRules,
  relative = true,
  scripts?: SiteScripts,
): {
  readonly pages: readonly { readonly file: string; readonly html: string }[];
  readonly css: string;
  readonly cssLines: readonly CodeLine[];
  readonly interactions: string | null;
  readonly forms: string | null;
  readonly motion: string | null;
  readonly lottie: string | null
} {
  const rules = rulesForDocument(manifestRules, document);
  const usesForms = document.pages.some(page => pageUsesForms(page.tree));
  if (usesForms && scripts === undefined) throw new Error('Configured forms require the site script writer');
  const forms = usesForms && scripts !== undefined ? scripts.forms() : null;
  const classes = newShared(document, manifestRules);
  const pages = document.pages.map((page, i) => ({ page, code: pageLines(document, i, rules, classes, relative) }));
  // the project's base style first (core/render/base.ts: the same text the canvas writes), then the design tokens'
  // :root rule (core/design/tokens.ts), then the project's fonts (core/files/fonts.ts: a custom font draws in the
  // export at the path its file holds, relative to the stylesheet that names it)
  // each block ends with its line's end, as a page's rules do, so a blank line parts every rule from the next
  const fonts = fontFaceCss(filesOf(document), (file) => relativePath(STYLESHEET, file.path));
  // the person's classes and the elements' own rules each under its heading (core/export/sheet-headings.ts), so the
  // import tells a class of the person's one element alone lists from the class the export made for its own styles
  const classRules = classesCss(document.classes ?? [], rules.output, 'block');
  const base = document.pages.some(page => fileAt(document, capturedPageStylePath(page)) !== null) ? capturedBaseCss() : baseCss();
  const shared = [base, rootCss(document.tokens ?? []), fonts === '' ? '' : `${fonts}\n`, classRules === '' ? '' : `${CLASSES_HEADING}\n${classRules}`].filter((c) => c !== '').map((c) => `${relative ? writtenCss(document, c, STYLESHEET) : c}\n`);
  // the elements' rules in cascade order (every base rule, then each breakpoint's block, widest first), their identical
  // bodies merged inside a block (core/render/clean.ts; the audit's AUD-02)
  const media = rules.output.breakpoints.filter((breakpoint) => !breakpoint.base).map(mediaQuery);
  const merged = mergeCssLines(pages.flatMap((p) => p.code.css), new Set(pages.flatMap((p) => [...p.code.classes.values()])), media);
  const generated: readonly CodeLine[] = merged.length === 0 ? merged : [{ text: ELEMENTS_HEADING, node: null }, ...merged];
  const files = [pageCss(generated)];
  const css = [...shared, ...files].filter((c) => c !== '').join('\n');
  // the same text, line by line: every part's own lines, and the blank line the join writes between two parts
  const parts = [...shared.map((text) => text.split('\n').slice(0, -1).map((line) => ({ text: line, node: null as NodeId | null }))), generated.map((line) => ({ text: line.text, node: line.node as NodeId | null }))];
  const lines: CodeLine[] = parts.flatMap((one, i) => (i < parts.length - 1 ? [...one, { text: '', node: null }] : one));
  // the stylesheet ends with a line's end, so its last line is the empty one a text ends with
  const cssLines: CodeLine[] = css.endsWith('\n') ? [...lines, { text: '', node: null }] : lines;
  // The selectors the script addresses elements by (spec export-events-js): the class the export gave the element, else
  // the person's own id attribute. Every element an interaction names has one or the other (an addressed element takes
  // a generated class).
  const selectorById = new Map<string, string>();
  for (const { page, code } of pages) {
    for (const node of walk(page.tree)) {
      const generated = code.classes.get(node.id);
      const own = node.attributes.id;
      const selector = generated !== undefined ? `.${generated}` : typeof own === 'string' && own !== '' ? `#${own}` : null;
      if (selector !== null && !selectorById.has(node.id)) selectorById.set(node.id, selector);
    }
  }
  const interactions = interactionsJs(document, (id) => selectorById.get(id) ?? '.');
  // the motion script (spec export-motion-js): the site's motion data, every element by the selector above
  const config = motionConfig(document, { selectorOf: (id) => selectorById.get(id) ?? null, breakpoints: rules.output.breakpoints.map(({ id, width, base }) => ({ id, width, base })), playedClassName });
  if (config !== null && scripts?.motion === undefined) throw new Error('Motion requires the site script writer');
  const motion = config === null || scripts?.motion === undefined ? null : scripts.motion(config);
  const lottie = config !== null && siteUsesLottie(document) && scripts?.lottie !== undefined ? scripts.lottie() : null;
  return { pages: pages.map(({ page, code }) => ({ file: page.file, html: code.html.map((line) => line.text).join('\n') })), css, cssLines, interactions, forms, motion, lottie };
}

// The scripts the site writes beside its pages: the same answers siteFiles reaches, read without writing the pages or
// their stylesheet — the selectors a script names change its text, never whether it is written (every element an
// interaction or a motion addresses takes a generated class). The Explorer lists the generated files at every change of
// the document (the audit's AUD-36: listing them through siteFiles wrote the whole site at every undo).
export type SiteScriptPart = 'interactions' | 'forms' | 'motion' | 'lottie';
export function siteScriptsWritten(document: DocumentJson, manifestRules: ModelRules): ReadonlySet<SiteScriptPart> {
  const written = new Set<SiteScriptPart>();
  const anywhere = () => '.';
  if (interactionsJs(document, anywhere) !== null) written.add('interactions');
  if (document.pages.some((page) => pageUsesForms(page.tree))) written.add('forms');
  const breakpoints = rulesForDocument(manifestRules, document).output.breakpoints.map(({ id, width, base }) => ({ id, width, base }));
  if (motionConfig(document, { selectorOf: anywhere, breakpoints, playedClassName }) !== null) {
    written.add('motion');
    if (siteUsesLottie(document)) written.add('lottie');
  }
  return written;
}

// A page as the preview shows it (spec preview-mode): the exported page itself, its stylesheet written in its head in
// place of the link (the preview has no files to load), and links and forms opening in a new tab, never in the editor.
export function previewPage(document: DocumentJson, rules: ModelRules, pageIndex = 0, scripts?: SiteScripts): string {
  // the preview writes the paths as the document holds them, then draws each through its data URL: its frame has an
  // opaque origin, where a blob: URL of the editor's origin does not load (files.ts dataUrl)
  const site = siteFiles(document, rules, false, scripts);
  let html = site.pages[pageIndex]?.html ?? '';
  for (const file of filesOf(document)) html = html.replaceAll(`"${file.path}"`, `"${dataUrl(file)}"`);
  // A linked script of the project runs from its own text: the preview's frame has an opaque origin, and a blob: URL
  // of the editor's origin does not load there (spec code-panel-edit-js: "Preview runs the linked scripts"). A script
  // whose address is no project file keeps its address, as the export writes it.
  const page = document.pages[pageIndex];
  if (page !== undefined) {
    const residual = fileAt(document, capturedPageStylePath(page));
    if (residual !== null) {
      const capture = fileUrlsIn(capturedPageCss(document, page), address => {
        const file = fileAt(document, captureAssetPath(page, address));
        return file === null ? address : dataUrl(file);
      });
      html = html.replace(`  <link rel="stylesheet" href="${dataUrl(residual)}">`, () => `  <style>\n${capture.replace(/<\/style/gi, '<\\/style')}\n  </style>`);
    }
  }
  const linked = typeof page?.tree.attributes.pageScripts === 'string' ? page.tree.attributes.pageScripts.split(/\s+/).filter((one) => one !== '') : [];
  for (const path of linked) {
    const file = fileAt(document, path);
    if (file === null) continue;
    const text = new TextDecoder().decode(fileBytes(file));
    html = html.replace(`  <script src="${dataUrl(file)}"></script>`, `  <script>\n${text}\n  </script>`);
  }
  // a font of the project draws in the preview from its own bytes too, as the page's own sources do (the preview has
  // no folder to serve css/styles.css's relative paths from)
  let css = site.css;
  for (const file of fontFiles(document)) css = css.replaceAll(`"${relativePath(STYLESHEET, file.path)}"`, `"${dataUrl(file)}"`);
  // A declaration's address that names a project file draws from the stored bytes, the way the canvas draws it: the
  // preview has no folder to serve the paths the stylesheet keeps, so a background image of the project reaches it —
  // the same rule the page's own sources take above.
  css = fileUrlsIn(css, (address) => {
    const file = fileAt(document, address);
    return file === null ? address : dataUrl(file);
  });
  // The interactions script runs in the preview exactly as the exported page runs it (spec export-events-js): the file
  // has no address the preview could load, so its text is written in, and it waits for the page as its `defer` does —
  // an inline script is never deferred.
  if (site.interactions !== null) {
    const inline = `  <script>document.addEventListener('DOMContentLoaded', function () {\n${site.interactions}  });</script>`;
    html = html.replace(`  <script defer src="${relativePath(page?.file ?? '', INTERACTIONS_SCRIPT)}"></script>`, inline);
  }
  const link = `  <link rel="stylesheet" href="${STYLESHEET}">`;
  if (site.forms !== null) html = html.replace(`  <script defer src="${FORMS_SCRIPT}"></script>`, () => `  <script>document.addEventListener('DOMContentLoaded', function () {\n${site.forms}\n});</script>`);
  // the Lottie player and the motion script run in the preview from their own text, in their order (the page links
  // them by paths the preview cannot load)
  const pageFile = page?.file ?? '';
  if (site.lottie !== null) html = html.replace(`  <script defer src="${relativePath(pageFile, LOTTIE_SCRIPT)}"></script>`, () => `  <script>\n${site.lottie?.replace(/<\/script/gi, '<\\/script') ?? ''}\n  </script>`);
  if (site.motion !== null) html = html.replace(`  <script defer src="${relativePath(pageFile, MOTION_SCRIPT)}"></script>`, () => `  <script>document.addEventListener('DOMContentLoaded', function () {\n${site.motion?.replace(/<\/script/gi, '<\\/script') ?? ''}\n});</script>`);
  return html.replace(link, `  <base target="_blank">\n  <style>\n${css}  </style>`);
}

export const exportProject = registerHandler('project.export', ({ state, rules, siteScripts }) => {
  const encoder = new TextEncoder();
  const site = siteFiles(state.document, rules, true, siteScripts);
  // every file of the project at its path (spec export-assets): an image an element uses is in the archive, so the
  // exported page shows it
  const assets = filesOf(state.document).map((file) => ({ path: file.path, bytes: fileBytes(file) }));
  // the interactions' script, at the path the pages link it by, while the project holds interactions (spec
  // export-events-js)
  const script = site.interactions === null ? [] : [{ path: INTERACTIONS_SCRIPT, bytes: encoder.encode(site.interactions) }];
  if (site.forms !== null) script.push({ path: FORMS_SCRIPT, bytes: encoder.encode(site.forms) });
  if (site.motion !== null) script.push({ path: MOTION_SCRIPT, bytes: encoder.encode(site.motion) });
  if (site.lottie !== null) script.push({ path: LOTTIE_SCRIPT, bytes: encoder.encode(site.lottie) });
  const entries = [...site.pages.map(({ file, html }) => ({ path: file, bytes: encoder.encode(html) })), { path: STYLESHEET, bytes: encoder.encode(site.css) }, ...script, ...assets];
  const bytes = zip(entries, FIXED_TIME);
  return { kind: 'change' as const, message: message('status.export.done', { file: SITE_ARCHIVE }), download: { name: SITE_ARCHIVE, type: 'application/zip', bytes } };
});
