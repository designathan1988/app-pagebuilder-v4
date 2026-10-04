// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// Family FO1 of the code audit (2026-10-04, second reading): File › Open folder read every page with the code pane's
// strict reader and every sheet with a reader of its own, so a style attribute, a <style> block, a media query, a
// :hover rule and the specificity of the cascade were lost, unlike File › Import HTML of the same page (spec
// explorer-open-folder: "The HTML pages go through the HTML importer").
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import type { DocumentJson } from '../document/model.ts';
import { openFolderCommand } from './folder.ts';

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const file = (path: string, type: string, text: string) => ({ path, name: path.split('/').pop() ?? path, type, bytes: base64(text) });
const empty = documentOf({ pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body') }] });

describe('an opened folder reads its pages as the HTML importer does (FO1)', () => {
  it('keeps style attributes, style blocks, media queries, states and the cascade', () => {
    const html = '<!doctype html><html lang="en"><head><title>Site</title><link rel="stylesheet" href="css/site.css"><style>.lead { color: #00aa00; }</style></head><body><h1 id="top">Hi</h1><p style="color: #ff0000">Red</p><p class="lead">Green</p></body></html>';
    const css = '#top { color: #111111; } h1 { color: #222222; } h1:hover { color: #333333; } @media (max-width: 767px) { h1 { font-size: 20px; } }';
    const ran = runHandler(openFolderCommand, empty, { folder: { name: 'site', files: [file('index.html', 'text/html', html), file('css/site.css', 'text/css', css)] } as never }, { confirmed: true });
    expect(ran.outcome.kind).toBe('load');
    const loaded = (ran.outcome as { document: DocumentJson }).document;
    const [heading, red, green] = loaded.pages[0]?.tree.children ?? [];
    expect(red?.styles).toEqual({ desktop: { base: { color: '#ff0000' } } });
    expect(heading?.styles.desktop?.base?.color).toBe('#111111');
    expect(heading?.styles.desktop?.hover?.color).toBe('#333333');
    expect(Object.keys(heading?.styles ?? {}).length).toBeGreaterThan(1);
    expect(JSON.stringify(green)).toContain('#00aa00');
    expect(loaded.pages[0]?.name).toBe('pages.defaultHome');
    expect(loaded.files?.map((one) => one.path)).toEqual(['css/site.css']);
  });
});
