import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, MESSAGE_IDS, type MessageId } from '../generated/ids.ts';
import { describeText, formatMessage, hasText, isLocale, pluralForm, translate, translator, type Locale, type MessageParams } from './index.ts';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

const catalogues: Record<Locale, Readonly<Record<string, string>>> = { en, 'pt-BR': ptBR };

// A value for every placeholder of a key, so that every text can be formatted.
function paramsFor(key: MessageId): MessageParams {
  const names = [...en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');
  return Object.fromEntries(names.map((name) => [name, `<${name}>`]));
}

function expected(locale: Locale, key: MessageId): string {
  const text = catalogues[locale][key];
  if (text === undefined) throw new Error(`${locale} has no "${key}"`);
  return formatMessage(text, paramsFor(key));
}

describe('formatMessage', () => {
  it('fills every placeholder with its parameter', () => {
    expect(formatMessage('{count} of {total} selected', { count: 2, total: 5 })).toBe('2 of 5 selected');
  });

  it('throws when a placeholder has no parameter', () => {
    expect(() => formatMessage('Hello {name}', {})).toThrow('Missing parameter "name"');
  });
});

describe('the i18n runtime', () => {
  it('chooses the plural form of a count by the rules of the locale, zero in the plural', () => {
    expect([0, 1, 2].map((n) => translate('en', `status.elementCount.${pluralForm('en', n)}`, { count: n }))).toEqual(['0 elements', '1 element', '2 elements']);
    expect([0, 1, 2].map((n) => translate('pt-BR', `status.elementCount.${pluralForm('pt-BR', n)}`, { count: n }))).toEqual(['0 elementos', '1 elemento', '2 elementos']);
    expect(translate('pt-BR', `inspector.grid.trackCount.${pluralForm('pt-BR', 0)}`, { count: 0 })).toBe('0 trilhas');
  });

  it('has English as the default UI language', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(translate(DEFAULT_LOCALE, 'editor.label')).toBe('Page editor');
    expect(translate(DEFAULT_LOCALE, 'activity.insert')).toBe('Insert');
  });

  it('has a text for every key in every locale', () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_IDS) {
        expect(translate(locale, key, paramsFor(key))).toBe(expected(locale, key));
      }
    }
  });

  it('returns the Brazilian Portuguese texts', () => {
    expect(translate('pt-BR', 'activity.insert')).toBe('Inserir');
    expect(translate('pt-BR', 'attribute.alt.label')).toBe('Texto alternativo');
    expect(translator('pt-BR')('assets.picker.choose')).toBe('Escolher um arquivo');
  });

  it('fills placeholders in both locales', () => {
    expect(translate('en', 'canvas.editingText', { name: 'Hero' })).toBe('Editing text · Hero');
    expect(translate('pt-BR', 'canvas.editingText', { name: 'Hero' })).toBe('Editando texto · Hero');
    expect(translate('en', 'canvas.pickTarget', { name: 'Card' })).toBe('Target: Card · click to choose');
    expect(translate('pt-BR', 'canvas.pickTarget', { name: 'Card' })).toBe('Alvo: Card · clique para escolher');
  });

  it('uses plain wrap copy, neutral property messages and count labels in both languages', () => {
    expect(translate('en', 'dialog.wrap.message')).toBe('Putting these elements together may change their position on the page. Continue?');
    expect(translate('pt-BR', 'dialog.wrap.message')).toBe('Colocar estes elementos juntos pode mudar a posição deles na página. Continuar?');
    expect(translate('en', 'status.style.reset', { property: 'Width', name: 'Section' })).toBe('Reset Width on Section to its default.');
    expect(translate('pt-BR', 'status.style.reset', { property: 'Largura', name: 'Seção' })).toBe('Valor de Largura em Seção voltou ao padrão.');
    expect(translate('pt-BR', 'status.style.resetMany', { property: 'Largura', count: 2 })).toBe('Valor de Largura voltou ao padrão em 2 elementos.');
    expect(translate('pt-BR', 'status.regions.stopped', { name: 'Menu' })).toBe('Compartilhamento de Menu encerrado; cada página mantém sua cópia.');
    expect(translate('en', 'palette.search.matchCount', { count: 1, total: 1 })).toBe('Element matches: 1 / 1');
    expect(translate('pt-BR', 'palette.search.matchCount', { count: 1, total: 1 })).toBe('Elementos encontrados: 1 / 1');
    expect(translate('en', 'data.previewRows', { count: 1, columns: 1 })).toBe("Rows: 1; columns: 1. Check each column's type before importing.");
    expect(translate('pt-BR', 'data.previewRows', { count: 1, columns: 1 })).toBe('Linhas: 1; colunas: 1. Confira o tipo de cada coluna antes de importar.');
    expect(translate('en', 'dialog.deleteCollection.message', { name: 'Menu', count: 1 })).toBe('Delete the Menu collection? Connected pages and lists: 1. Their current content stays as it is.');
    expect(translate('pt-BR', 'dialog.deleteCollection.message', { name: 'Menu', count: 1 })).toBe('Excluir a coleção Menu? Páginas e listas ligadas a ela: 1. O conteúdo delas fica como está.');
    expect(translate('en', 'command.exportPage')).toBe('Export ZIP');
    expect(translate('pt-BR', 'command.exportPage')).toBe('Exportar ZIP');
    expect(translate('en', 'status.selection.skipped', { count: 1, skipped: 1 })).toBe('Selected: 1. Excluded because locked or hidden: 1.');
    expect(translate('pt-BR', 'status.selection.skipped', { count: 1, skipped: 1 })).toBe('Selecionados: 1. Fora da seleção por bloqueio ou ocultação: 1.');
    expect(translate('en', 'status.interactions.added', { element: 'Card', count: 1 })).toBe('Interaction added to Card. Total: 1.');
    expect(translate('pt-BR', 'status.interactions.added', { element: 'Card', count: 1 })).toBe('Interação adicionada em Card. Total: 1.');
    expect(translate('en', 'inspector.valuesSet', { count: 1 })).toBe('Values set: 1');
    expect(translate('pt-BR', 'inspector.valuesSet', { count: 1 })).toBe('Valores definidos: 1');
  });

  it('chooses complete singular messages for one in both languages, with zero and two plural', () => {
    expect(translate('en', 'status.classes.deleted', { name: 'accent', count: 1 })).toBe('Deleted .accent from 1 element.');
    expect(translate('pt-BR', 'status.classes.deleted', { name: 'accent', count: 1 })).toBe('Classe .accent apagada de 1 elemento.');
    expect(translate('en', 'status.classes.deleted', { name: 'accent', count: 0 })).toBe('Deleted .accent from 0 elements.');
    expect(translate('pt-BR', 'status.classes.deleted', { name: 'accent', count: 2 })).toBe('Classe .accent apagada de 2 elementos.');
    expect(translate('pt-BR', 'status.layers.searchMatches', { count: 1, query: 'Hero' })).toBe('1 camada corresponde a "Hero".');
    expect(translate('pt-BR', 'status.style.declarationsSet', { count: 1, name: 'Card' })).toBe('Card tem 1 declaração.');
    expect(translate('pt-BR', 'layout.predict.columns', { count: 1, gap: 12 })).toBe('1 coluna');
    expect(translate('pt-BR', 'status.motion.timelineInUse', { name: 'Entrada', count: 1 })).toBe('Entrada é reproduzida ou controlada 1 vez: remova esse uso primeiro.');
    expect(translate('en', 'styles.deleteClassUsedBy', { count: 1 })).toBe('Delete class used by 1 element');
    expect(translate('pt-BR', 'styles.deleteClassUsedBy', { count: 1 })).toBe('Apagar classe usada por 1 elemento');
    const keys = [
      'status.classes.deleted', 'status.layers.searchMatches', 'status.style.declarationsSet', 'status.tokens.inUse',
      'status.selection.count', 'status.pasted.html', 'status.table.columnCreated', 'status.table.columnRemoved',
      'layout.predict.columns', 'layout.predict.rows', 'layout.predict.regions', 'layout.status.traced',
      'status.data.previewed', 'status.data.imported', 'status.data.importedInto', 'status.data.filled',
      'status.data.itemsDeleted', 'status.data.fieldInUse', 'status.data.fileWide', 'data.itemPagesCount',
      'status.pages.madeFromNames', 'status.pages.madeFromCollection', 'status.classes.appliedToSimilar',
      'status.suggest.applied', 'status.components.updated', 'status.import.released', 'status.motion.timelineInUse',
      'status.motion.copied', 'status.siteColours.replaced', 'status.siteColours.madeVariable', 'styles.deleteClassUsedBy',
    ];
    for (const locale of LOCALES) for (const key of keys) expect(hasText(locale, `${key}.one`), `${locale}: ${key}.one`).toBe(true);
  });

  it('has the same keys in both catalogues, and for every key the same placeholders (spec ui-language, Problem 3)', () => {
    const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
    const differ = Object.entries(en)
      .filter(([key, text]) => JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders((ptBR as Record<string, string>)[key] ?? '')))
      .map(([key]) => key);
    expect(differ, 'keys whose placeholders differ between en and pt-BR').toEqual([]);
  });

  it('throws when a placeholder has no value, in both locales', () => {
    expect(() => translate('en', 'canvas.editingText')).toThrow('Missing parameter "name"');
    expect(() => translate('pt-BR', 'canvas.editingText')).toThrow('Missing parameter "name"');
  });

  it('has no fallback: a key missing from a catalogue throws, naming the key and the locale', () => {
    const unknown = 'no.such.key' as MessageId;
    expect(() => translate('pt-BR', unknown)).toThrow('The pt-BR catalogue has no text for "no.such.key".');
    expect(() => translate('en', unknown)).toThrow('The en catalogue has no text for "no.such.key".');
  });

  it('switching the locale gives every text its Portuguese, which differs from the English for most keys, and switching back restores English', () => {
    const changed = MESSAGE_IDS.filter((key) => en[key] !== ptBR[key]);
    expect(changed.length).toBeGreaterThan(MESSAGE_IDS.length / 2);
    const portuguese = translator('pt-BR');
    for (const key of MESSAGE_IDS) expect(portuguese(key, paramsFor(key))).toBe(expected('pt-BR', key));
    for (const key of changed) expect(portuguese(key, paramsFor(key))).not.toBe(expected('en', key));
    const english = translator('en');
    for (const key of MESSAGE_IDS) expect(english(key, paramsFor(key))).toBe(expected('en', key));
  });

  it('a translator stays bound to its locale', () => {
    const english = translator('en');
    const portuguese = translator('pt-BR');
    expect(english('activity.insert')).toBe('Insert');
    expect(portuguese('activity.insert')).toBe('Inserir');
    expect(english('activity.insert')).toBe('Insert');
  });

  it('accepts only the UI languages', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('describeText', () => {
  it('names each placeholder instead of refusing a text that takes values', () => {
    expect(describeText('en', 'command.components.insertInstance')).toBe('Place <component>');
  });
  it('describes every text of every locale', () => {
    for (const locale of LOCALES) for (const key of MESSAGE_IDS) expect(() => describeText(locale, key)).not.toThrow();
  });
});
