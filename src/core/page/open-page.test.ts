// Family PG2 of the code audit (2026-10-04): what belongs to a page is read and written on the page the editor shows
// (openedPage, its one owner), never on the project's first. The guides were created, moved and listed on the first
// page whatever page was open; the grid settings were written on the open page and read from the first; the code
// pane's HTML showed the first page's file.
import { describe, expect, it } from 'vitest';
import type { DocumentJson } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { createGuideCommand, deleteGuideCommand, guidesOf } from './guides.ts';
import { gridSetting, setGridSettings } from './grid.ts';
import { paneFile } from '../../editor/code-panel/code-panel.ts';
import type { EditorUi } from '../../editor/state.ts';

const twoPages = (): DocumentJson =>
  documentOf({
    pages: [
      { id: 'home', name: 'Home', file: 'index.html', tree: node('Home-root', 'page', 'body', { guides: [{ id: 'vertical-1', axis: 'vertical', at: 40 }] }) },
      { id: 'about', name: 'About', file: 'about.html', tree: node('About-root', 'page', 'body') },
    ],
  });
const onAbout = { page: 'about' };

describe("a page's own things are the open page's (PG2)", () => {
  it('a guide drawn with About open is About\'s, and Home keeps its own', () => {
    const ran = runHandler(createGuideCommand, twoPages(), { axis: 'horizontal', at: 120 }, { ui: onAbout });
    expect(ran.problems).toEqual([]);
    expect(guidesOf(ran.document, 1)).toEqual([{ id: 'horizontal-1', axis: 'horizontal', at: 120 }]);
    expect(guidesOf(ran.document, 0)).toEqual([{ id: 'vertical-1', axis: 'vertical', at: 40 }]);
    // Home's guide is no door of About's: a stale name is refused, never Home's guide deleted
    const stale = runHandler(deleteGuideCommand, twoPages(), { guide: 'vertical-1' }, { ui: onAbout });
    expect(stale.outcome.kind).toBe('refused');
  });

  it('a grid setting written with About open is the one About shows', () => {
    const ran = runHandler(setGridSettings, twoPages(), { grid: 'columns', setting: 'count', value: 6 }, { ui: onAbout });
    expect(gridSetting(ran.document, 'columns', 'count', 'desktop', 1)).toBe(6);
    expect(gridSetting(ran.document, 'columns', 'count', 'desktop', 0)).not.toBe(6);
  });

  it("the code pane's HTML is the open page's file", () => {
    expect(paneFile('html', twoPages(), onAbout as unknown as EditorUi)).toBe('about.html');
  });
});
