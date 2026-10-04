import { expect, it } from 'vitest';
import { textOf } from './text.ts';

it('uses the singular sentence when the count is a nested localized noun', () => {
  const row = { plural: 'data.rows', count: 1 } as const;
  const item = { plural: 'data.items', count: 1 } as const;
  const page = { plural: 'data.pages', count: 1 } as const;
  expect(textOf('en', 'status.data.previewed', { name: 'menu.csv', count: row })).toBe('menu.csv: 1 row ready to import.');
  expect(textOf('pt-BR', 'status.data.previewed', { name: 'menu.csv', count: row })).toBe('menu.csv: 1 linha pronta para importar.');
  expect(textOf('pt-BR', 'status.data.previewed', { name: 'menu.csv', count: { ...row, count: 2 } })).toBe('menu.csv: 2 linhas prontas para importar.');
  expect(textOf('pt-BR', 'status.data.imported', { collection: 'Menu', count: item })).toBe('1 item importado para Menu.');
  expect(textOf('pt-BR', 'status.data.itemsDeleted', { collection: 'Menu', count: item })).toBe('1 item excluído de Menu.');
  expect(textOf('pt-BR', 'status.pages.madeFromNames', { name: 'Menu', count: page })).toBe('1 página criada a partir de Menu.');
});
