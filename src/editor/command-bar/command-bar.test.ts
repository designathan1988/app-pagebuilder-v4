// The command bar's query (spec command-bar, Problems in Pager 3): the words of a query match in any order, from the
// start of a word, anywhere or as initials; a scope prefix keeps one kind of entry; with no words the recently run
// entries come first; at most commandBar.maxResults are shown.
import { describe, expect, it } from 'vitest';
import { BAR_DOORS, MAX_RESULTS, entryKey, groupedEntries, kindOf, matchScore, matchedRanges, shownEntries, type BarEntry, scopeOf } from './command-bar.ts';

const command = BAR_DOORS.find((d) => kindOf(d) === 'command');
const insert = BAR_DOORS.find((d) => kindOf(d) === 'insert');
if (command === undefined || insert === undefined) throw new Error('the manifest has no command or insert entry');
const entry = (label: string, door = command, args: Readonly<Record<string, unknown>> = { label }): BarEntry => ({ entry: door, args, label, key: entryKey(door, args) });

describe('matchScore', () => {
  it('matches the words of the query in any order, from the start of a word', () => {
    expect(matchScore('insert hero', 'Insert Hero')).not.toBeNull();
    expect(matchScore('hero insert', 'Insert Hero')).not.toBeNull();
    expect(matchScore('ins hero', 'Insert Hero')).not.toBeNull();
  });
  it('matches a word anywhere in the label, or the initials of its words', () => {
    expect(matchScore('wrap', 'Remove wrapper')).not.toBeNull();
    expect(matchScore('wiar', 'Wrap in a row')).not.toBeNull();
  });
  it('refuses a label that one word of the query does not match', () => {
    expect(matchScore('insert footer', 'Insert Hero')).toBeNull();
    expect(matchScore('zz', 'Wrap in a row')).toBeNull();
  });
  it('ignores case and accents', () => {
    expect(matchScore('ÉLÉMENT', 'element')).not.toBeNull();
  });
  it('ranks a word start above a match inside a word, and a label starting as the query first', () => {
    const start = matchScore('wrap', 'Wrap in a row') ?? 0;
    const inside = matchScore('wrap', 'Remove wrapper') ?? 0;
    expect(start).toBeGreaterThan(inside);
  });
});

describe('matchedRanges', () => {
  it('marks each word of the query where it starts a word of the label, else where it stands', () => {
    expect(matchedRanges('exp', 'Export project (ZIP)')).toEqual([[0, 3]]);
    expect(matchedRanges('exp', 'Open Explorer')).toEqual([[5, 8]]);
    expect(matchedRanges('row wrap', 'Wrap in a row')).toEqual([[0, 4], [10, 13]]);
    expect(matchedRanges('ort', 'Export')).toEqual([[3, 6]]);
  });
  it('ignores case, accents and the scope prefix, and marks nothing for initials', () => {
    expect(matchedRanges('> seç', 'Seção nova')).toEqual([[0, 3]]);
    expect(matchedRanges('wiar', 'Wrap in a row')).toEqual([]);
    expect(matchedRanges('', 'Export')).toEqual([]);
  });
});

describe('groupedEntries', () => {
  it('lists the entries under the title of their scope, each group where its best entry stands, the best entry first', () => {
    const of = (kind: string) => BAR_DOORS.find((d) => kindOf(d) === kind);
    const command = of('command');
    const insert = of('insert');
    if (command === undefined || insert === undefined) throw new Error('the bar has a command entry and an insert entry');
    const shown = [{ entry: command }, { entry: insert }, { entry: command }];
    const groups = groupedEntries(shown);
    expect(groups.map((g) => g.title)).toEqual(['commandBar.group.commands', 'commandBar.group.insert']);
    expect(groups[0]?.entries).toEqual([shown[0], shown[2]]);
    expect(groups[1]?.entries).toEqual([shown[1]]);
  });
});

describe('shownEntries', () => {
  const offered = [entry('Wrap in a row'), entry('Wrap in a column'), entry('Remove wrapper'), entry('Insert Hero', insert, { entry: 'template-hero' }), entry('Duplicate')];
  it('lists the best matches first, ties in the bar order', () => {
    expect(shownEntries('wrap', offered, []).map((e) => e.label)).toEqual(['Wrap in a row', 'Wrap in a column', 'Remove wrapper']);
  });
  it('keeps one kind of entry after a scope prefix', () => {
    expect(shownEntries('+hero', offered, []).map((e) => e.label)).toEqual(['Insert Hero']);
    expect(shownEntries('>hero', offered, [])).toEqual([]);
  });
  it('lists the recently run entries first while the query is empty', () => {
    const duplicate = offered[4] as BarEntry;
    expect(shownEntries('', offered, [duplicate.key]).map((e) => e.label)).toEqual(['Duplicate', 'Wrap in a row', 'Wrap in a column', 'Remove wrapper', 'Insert Hero']);
  });
  it('shows at most commandBar.maxResults entries', () => {
    const many = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => entry(`Wrap ${i}`));
    expect(shownEntries('wrap', many, [])).toHaveLength(MAX_RESULTS);
    expect(shownEntries('', many, [])).toHaveLength(MAX_RESULTS);
  });
  it('reads the scope a query is in, All when it has no prefix', () => {
    expect(scopeOf('>wrap')).toEqual({ prefix: '>', words: 'wrap' });
    expect(scopeOf('  #color red')).toEqual({ prefix: '#', words: 'color red' });
    expect(scopeOf('wrap')).toEqual({ prefix: '', words: 'wrap' });
  });
});

// An insert entry answers to the words the Insert panel's search answers to (spec palette-click-insert: its English
// name, its synonyms, its tag): in Portuguese "+header" found nothing where the Insert panel found Cabeçalho (the
// audit of 2026-10-05, AU6-12). Its own label still comes first.
describe('an insert entry\'s other names', () => {
  if (insert === undefined) throw new Error('no insert door');
  const header: BarEntry = { ...entry('Inserir Cabeçalho', insert, { entry: 'header' }), also: ['Header', 'header'] };
  const heading: BarEntry = { ...entry('Inserir Título', insert, { entry: 'heading' }), also: ['Heading', 'h2'] };
  const named: BarEntry = { ...entry('Inserir Header falso', insert, { entry: 'x' }), also: [] };
  it('finds it by its English name and by its tag', () => {
    expect(shownEntries('+header', [header, heading], []).map((e) => e.label)).toEqual(['Inserir Cabeçalho']);
    expect(shownEntries('+h2', [header, heading], []).map((e) => e.label)).toEqual(['Inserir Título']);
  });
  it('ranks a match of the label before a match of another name', () => {
    expect(shownEntries('+header', [header, named], []).map((e) => e.label)).toEqual(['Inserir Header falso', 'Inserir Cabeçalho']);
  });
});
