// The CSS keywords a field shows and takes in the person's language (the plan's stage 3, "entrada inteligente":
// "automático", "nenhum"): each has a catalogue text, keyword.<keyword>, which is the keyword itself in English. A
// field shows a stored keyword as its word; a word typed in any case, with or without its accents, stands for the
// keyword wherever the property offers that keyword. The document and the export keep the CSS keyword.
import type { MessageId } from '../../generated/ids.ts';

// (keyword values, written as one list: some share their name with a property, which they are not)
const KEYWORD_WORDS: readonly string[] = 'auto none normal hidden visible bold italic solid dashed dotted double center left right uppercase lowercase capitalize underline cover contain wrap nowrap'.split(' ');

const WORDS = new Set(KEYWORD_WORDS);

const keywordKey = (keyword: string): MessageId => `keyword.${keyword}` as MessageId;

// a text compared as a person means it: its case and its accents aside
const folded = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase();

// The keyword a word of the person's language stands for among the keywords a property offers; null for any other text.
export function keywordOfWord(typed: string, keywords: readonly string[], words: (key: MessageId) => string): string | null {
  const wanted = folded(typed);
  if (wanted === '') return null;
  return keywords.find((keyword) => WORDS.has(keyword) && folded(words(keywordKey(keyword))) === wanted) ?? null;
}

// How a field shows a stored value: a keyword of the list as its word, any other text as it is.
export function wordOfKeyword(text: string, words: (key: MessageId) => string): string {
  const keyword = text.trim().toLowerCase();
  return WORDS.has(keyword) ? words(keywordKey(keyword)) : text;
}
