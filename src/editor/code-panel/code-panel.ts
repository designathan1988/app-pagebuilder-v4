// The code pane (INVENTORY.md, owners; the manifest's code-panel-view and code-panel-copy-download): what
// the pane shows and the two doors that take it away. One owner of the text of an open file — a generated file's text
// is what the export writes for it (core/export/export.ts, never a second serializer), a project file's is its stored
// bytes — so the pane, Copy and Download all read the same text. Which file is open is explorer/file-tabs.ts's.
import { message, registerHandler } from '../../core/commands/registry.ts';
import { siteScripts } from '../forms/script.ts';
import type { DocumentJson } from '../../core/document/model.ts';
import { fileAt, fileBytes } from '../../core/files/files.ts';
import { pageLines, siteFiles, STYLESHEET, type CodeLine } from '../../core/export/export.ts';
import { locate, type DocNode } from '../../core/document/model.ts';
import type { NodeId } from '../../generated/commands.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { EditorUi } from '../state.ts';
import { activeFile } from '../explorer/file-tabs.ts';
import { generatedScripts, isGenerated, kindOf, type FileKind } from '../explorer/explorer.ts';

// The text the pane shows for a path: a generated file rendered from the document, a project file's own bytes as
// text, and null for a file that is neither (an image, a font): the pane shows its name and type instead.
export function paneText(path: string, document: DocumentJson, rules: ModelRules): string | null {
  const page = document.pages.find((one) => one.file === path);
  if (page !== undefined) return siteFiles(document, rules, true, siteScripts).pages.find((one) => one.file === path)?.html ?? null;
  if (path === STYLESHEET) return siteFiles(document, rules, true, siteScripts).css;
  const file = fileAt(document, path);
  // a script the export writes: the text it writes (explorer.ts generatedScripts)
  if (file === null) return generatedScripts(document, rules).find((one) => one.path === path)?.text ?? null;
  return isText(path, file.type) ? new TextDecoder().decode(fileBytes(file)) : null;
}

// What the pane can show as text: the source files of the site and any text a project file holds
const TEXT_TYPES = ['text/', 'application/javascript', 'application/json', 'application/xml', 'image/svg'];
const TEXT_EXTENSIONS = ['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'xml'];
function isText(path: string, type: string): boolean {
  if (TEXT_TYPES.some((one) => type.startsWith(one))) return true;
  return TEXT_EXTENSIONS.includes(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
}

// The rule the pane edits: the declarations the selected element holds at the active breakpoint and style state, one
// "property: value;" a line — what the CSS pane shows while one element is selected, and what style.applyCssRule
// writes back (the manifest's code-panel-edit-css: "edit its rule, then apply"). Null when the selection is not one
// element: the pane shows the whole stylesheet then.
export function ruleText(state: { readonly document: DocumentJson; readonly selection: readonly string[] }, rules: ModelRules): string | null {
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  if (id === undefined) return null;
  const at = locate(state.document, id as NodeId);
  if (at === null) return null;
  const { breakpoint, state: base } = rules.base;
  const styles = at.node.styles as Record<string, Record<string, Record<string, string>> | undefined>;
  const held = styles[breakpoint]?.[base] ?? {};
  return Object.entries(held)
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n');
}


// The lines of one element's own markup (and of everything inside it): the export's lines for the subtree, with the
// page's indentation taken off and the class the export invents for its stylesheet left out of the element's own line
// (it is not the element's data). What the HTML pane shows while one element is selected, and what element.applyHtml
// writes back (the manifest's code-panel-edit-html: "edit its markup, then apply").
export function elementLines(state: { readonly document: DocumentJson; readonly selection: readonly string[] }, rules: ModelRules): readonly CodeLine[] | null {
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  if (id === undefined) return null;
  const page = state.document.pages.findIndex((one) => locate({ ...state.document, pages: [one] }, id as NodeId) !== null);
  if (page < 0) return null;
  const found = locate(state.document, id as NodeId);
  if (found === null) return null;
  const inside = new Set<string>([id]);
  const collect = (node: DocNode): void => {
    for (const child of node.children) {
      inside.add(child.id);
      collect(child);
    }
  };
  collect(found.node);
  const lines = pageLines(state.document, page, rules).html;
  const first = lines.findIndex((line) => line.node !== null && inside.has(line.node));
  const last = lines.reduce((at, line, i) => (line.node !== null && inside.has(line.node) ? i : at), -1);
  if (first < 0 || last < first) return null;
  const block = lines.slice(first, last + 1);
  // the element's own line carries the page's indentation: what is common to every line goes, so the markup the pane
  // shows and writes back is the element's own
  const indent = block.reduce((common, line) => {
    const lead = /^\s*/.exec(line.text)?.[0] ?? '';
    return line.text.trim() === '' ? common : common === null ? lead : lead.startsWith(common) ? common : common.slice(0, [...common].findIndex((c, i) => c !== lead[i]));
  }, null as string | null);
  const cut = indent === null ? 0 : indent.length;
  const held = new Set(found.node.classes);
  return block.map((line, at) => {
    const text = line.text.trim() === '' ? '' : line.text.slice(cut);
    if (at > 0) return { text, node: line.node };
    const written = /^(\s*<[^>]*\sclass=")([^"]*)(")/.exec(text);
    const kept = written === null ? [] : (written[2] ?? '').split(/\s+/).filter((one) => one !== '' && held.has(one));
    const opened = written === null ? text : kept.length === 0 ? text.replace(/^(\s*<[^>]*)\sclass="[^"]*"/, '$1') : text.replace(/^(\s*<[^>]*\sclass=")([^"]*)(")/, `$1${kept.join(' ')}$3`);
    return { text: opened, node: line.node };
  });
}

// The pane's lines, each with the node it was written for (the export's own writer): what the pane paints line by
// line, and how it follows the selection (spec code-panel-selection-sync).
export function paneLines(ui: EditorUi, document: DocumentJson, rules: ModelRules): readonly CodeLine[] {
  const shown = shownPane(ui, document, rules);
  if (shown === null || shown.text === null) return [];
  if (shown.kind === 'html') {
    const at = document.pages.findIndex((page) => page.file === shown.path);
    if (at >= 0) return pageLines(document, at, rules).html;
  }
  if (shown.kind === 'css' && shown.path === STYLESHEET) return siteFiles(document, rules, true, siteScripts).cssLines;
  return shown.text.split('\n').map((text) => ({ text, node: null }));
}

// The file the pane shows now, its kind, and its text: the file the person opened (explorer/file-tabs.ts), else the
// page's own file for the kind the pane's tabs chose. Null when there is nothing to show (the JS pane before the
// interactions group exists).
export function shownPane(ui: EditorUi, document: DocumentJson, rules: ModelRules): { readonly path: string; readonly kind: FileKind; readonly generated: boolean; readonly text: string | null } | null {
  const path = activeFile(ui) ?? paneFile(paneKind(ui), document);
  if (path === null) return null;
  return { path, kind: kindOf(path), generated: isGenerated(path, document), text: paneText(path, document, rules) };
}

// Which part of the code the pane shows (codePanel.setPane, the pane's own tabs): the page's markup, the stylesheet,
// or the interactions script. One owner: `paneKind`, and the tab door that sets it (its door stands for the kind it
// shows, so the tab in force is marked).
export type PaneKind = 'html' | 'css' | 'js';
export const paneKind = (ui: EditorUi): PaneKind => ui.codePane ?? 'html';

// what the status bar says for each part of the code the pane shows
const SAID_PANE = { html: 'status.codePanel.html', css: 'status.codePanel.css', js: 'status.codePanel.js' } as const;

export const setPane = registerHandler<'codePanel.setPane', EditorUi>(
  'codePanel.setPane',
  ({ state }, { pane }) => ({ kind: 'change', ui: { ...state.ui, codePane: pane === 'html' ? undefined : pane }, message: message(SAID_PANE[pane]) }),
  (state, { pane }) => paneKind(state.ui) === pane,
);

// The file the pane shows for a kind: the page's own file, the stylesheet, the interactions script. The JS pane needs
// the interactions group (export-events-js writes the file), so it shows nothing until then.
export function paneFile(kind: PaneKind, document: DocumentJson): string | null {
  if (kind === 'html') return document.pages[0]?.file ?? null;
  if (kind === 'css') return STYLESHEET;
  return null;
}

// files.saveContent is what writes a project file (the file system's own command); the pane's doors only hand the
// text away.
export const copyPane = registerHandler<'codePanel.copyPane', EditorUi>('codePanel.copyPane', ({ state, rules }) => {
  const shown = shownPane(state.ui, state.document, rules);
  if (shown === null || shown.text === null) return { kind: 'refused', message: message('status.codePanel.noText', { path: shown?.path ?? '' }) };
  return { kind: 'change', clipboard: { text: shown.text }, message: message('status.codePanel.copied', { path: shown.path }) };
});

export const downloadPane = registerHandler<'codePanel.downloadPane', EditorUi>('codePanel.downloadPane', ({ state, rules }) => {
  const shown = shownPane(state.ui, state.document, rules);
  if (shown === null || shown.text === null) return { kind: 'refused', message: message('status.codePanel.noText', { path: shown?.path ?? '' }) };
  return { kind: 'change', download: { name: shown.path.slice(shown.path.lastIndexOf('/') + 1), type: shown.path.endsWith('.css') ? 'text/css' : 'text/html', bytes: new TextEncoder().encode(shown.text) }, message: message('status.codePanel.downloaded', { path: shown.path }) };
});
