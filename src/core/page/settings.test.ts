import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { anyCss } from '../ports/css.ts';
import { isPageSetting, setPageSettingCommand } from './settings.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const withRoot = (attributes: Record<string, string>): DocumentJson => ({
  version: 2,
  pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { attributes: attributes as DocNode['attributes'], children: [node('Intro', 'paragraph', 'p', { text: 'Hi' })] }) }],
});
const contextOf = (document: DocumentJson): HandlerContext<never> => ({
  state: { document, selection: [], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
});
const label = (setting: string) => ({ key: `attribute.${setting}.label` });
// the page root's attributes after the command, and what the status bar says
function run(document: DocumentJson, setting: string, value: unknown) {
  const outcome = setPageSettingCommand.run(contextOf(document), { setting: setting as never, value: value as never });
  if (outcome.kind === 'refused') return { refused: outcome.message };
  if (outcome.kind !== 'change') throw new Error(outcome.kind);
  const after = applyPatches(document, outcome.patches ?? []).document;
  expect(validateDocument(after, [], RULES)).toEqual([]);
  return { attributes: after.pages[0]?.tree.attributes, patches: outcome.patches ?? [], message: outcome.message };
}

describe('the settings of the page', () => {
  it('are the attributes elements.json gives the page root alone', () => {
    expect(RULES.root.type).toBe('page');
    const settings = [...RULES.attributes].filter(([, on]) => isPageSetting(on, RULES.root.type)).map(([id]) => id);
    expect(settings.slice(0, 3)).toEqual(['pageTitle', 'pageLanguage', 'pageDirection']);
    expect(isPageSetting(RULES.attributes.get('id'), RULES.root.type)).toBe(false);
    expect(isPageSetting(RULES.attributes.get('href'), RULES.root.type)).toBe(false);
  });
});

describe('page.setSetting', () => {
  it('sets a setting on the page root, one patch, and says the setting and its value', () => {
    const done = run(withRoot({}), 'pageTitle', 'Landing');
    expect(done.attributes).toEqual({ pageTitle: 'Landing' });
    expect(done.patches).toHaveLength(1);
    expect(done.message).toEqual({ key: 'status.page.settingSet', params: { setting: label('pageTitle'), value: 'Landing' } });
  });

  it('replaces a setting, and records nothing for the value it already has', () => {
    expect(run(withRoot({ pageLanguage: 'en' }), 'pageLanguage', 'pt-BR').attributes).toEqual({ pageLanguage: 'pt-BR' });
    const same = run(withRoot({ pageLanguage: 'pt-BR' }), 'pageLanguage', 'pt-BR');
    expect(same.patches).toEqual([]);
    expect(same.message).toEqual({ key: 'status.page.settingSet', params: { setting: label('pageLanguage'), value: 'pt-BR' } });
  });

  it('takes the text without the spaces around it, and a direction in any case', () => {
    expect(run(withRoot({}), 'pageTitle', '  Landing ').attributes).toEqual({ pageTitle: 'Landing' });
    expect(run(withRoot({}), 'pageDirection', 'RTL').attributes).toEqual({ pageDirection: 'rtl' });
    expect(run(withRoot({}), 'pageDirection', 'auto').attributes).toEqual({ pageDirection: 'auto' });
  });

  it('removes a setting for an empty text, and changes nothing when the page has none', () => {
    const removed = run(withRoot({ pageTitle: 'Landing', pageLanguage: 'en' }), 'pageTitle', ' ');
    expect(removed.attributes).toEqual({ pageLanguage: 'en' });
    expect(removed.message).toEqual({ key: 'status.page.settingRemoved', params: { setting: label('pageTitle') } });
    expect(run(withRoot({}), 'pageDirection', '').patches).toEqual([]);
  });

  it('refuses a language that is not shaped like a language tag, and a direction other than ltr, rtl or auto', () => {
    for (const tag of ['en', 'pt-BR', 'zh-Hant-TW', 'es-419', 'x-private']) expect(run(withRoot({}), 'pageLanguage', tag).attributes).toEqual({ pageLanguage: tag });
    for (const bad of ['english!', 'pt_BR', 'en-', '-en', 'pt BR', 'toolongtag']) {
      expect(run(withRoot({ pageLanguage: 'en' }), 'pageLanguage', bad)).toEqual({ refused: { key: 'status.page.settingInvalid', params: { setting: label('pageLanguage'), value: bad } } });
    }
    expect(run(withRoot({}), 'pageDirection', 'sideways')).toEqual({ refused: { key: 'status.page.settingInvalid', params: { setting: label('pageDirection'), value: 'sideways' } } });
  });

  it('refuses a page address with the address rule’s own reason, as the Link field does (PS1)', () => {
    expect(run(withRoot({}), 'pageCanonical', 'javascript:alert(1)')).toEqual({ refused: { key: 'status.url.unsafe', params: { url: 'javascript:alert(1)' } } });
    expect(run(withRoot({}), 'pageOgImage', 'ftp://aurora.example/card.png')).toEqual({ refused: { key: 'status.url.malformed', params: { url: 'ftp://aurora.example/card.png' } } });
    expect(run(withRoot({}), 'pageFavicon', 'aurora.example/favicon.ico').attributes).toEqual({ pageFavicon: 'https://aurora.example/favicon.ico' });
  });

  it('refuses what no door hands it: an attribute that is no setting of the page, a value that is no string', () => {
    expect(() => run(withRoot({}), 'id', 'x')).toThrow(/no setting of the page/);
    expect(() => run(withRoot({}), 'pageTitle', 3)).toThrow(/not a string/);
  });
});
