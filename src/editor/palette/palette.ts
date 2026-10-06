// The Elements panel's own state (INVENTORY.md, owners; features palette-search-groups and palette-density):
// palette.toggleGroup collapses or opens a group of the palette, palette.setDensity lays its tiles out (a list, two or
// three columns, an icon grid). Both are editor preferences (src/editor/preferences/preferences.ts), kept after a
// reload; neither changes the document nor records anything. What the search field filters is the panel's own view
// (paletteMatches).
import { registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import type { PaletteDensity } from '../preferences/preferences.ts';
import { commandOf, manifest } from '../../manifest/runtime.ts';
import type { MessageId } from '../../generated/ids.ts';
import { hasText, translate, type Locale } from '../../i18n/index.ts';
import type { EditorUi } from '../state.ts';
import { chosen } from '../preferences/said.ts';

// the density while none is chosen (PRODUCT.md §5.3: two columns is the default in this sidebar width)
const DEFAULT_DENSITY: PaletteDensity = 'two-columns';

export const paletteDensity = (ui: EditorUi): PaletteDensity => ui.preferences.paletteDensity ?? DEFAULT_DENSITY;
const isGroupCollapsed = (ui: EditorUi, group: string): boolean => (ui.preferences.collapsedGroups ?? []).includes(group);

export const toggleGroup = registerHandler<'palette.toggleGroup', EditorUi>(
  'palette.toggleGroup',
  ({ state }, { group }) => {
    const collapsed = state.ui.preferences.collapsedGroups ?? [];
    const next = collapsed.includes(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group];
    // the list is absent while every group is open (preferences.ts)
    const kept = Object.fromEntries(Object.entries(state.ui.preferences).filter(([key]) => key !== 'collapsedGroups')) as typeof state.ui.preferences;
    return { kind: 'change', ui: { ...state.ui, preferences: next.length > 0 ? { ...kept, collapsedGroups: next } : kept } };
  },
  // a group header stands for its group being open
  (state, args) => !isGroupCollapsed(state.ui, String(args.group)),
);

export const setDensity: RegisteredHandler<'palette.setDensity', EditorUi> = registerHandler(
  'palette.setDensity',
  ({ state }, { density }) => {
    if (paletteDensity(state.ui) === density) return { kind: 'change' };
    return { kind: 'change', ui: { ...state.ui, preferences: { ...state.ui.preferences, paletteDensity: density } }, message: chosen(setDensity.command, { density }) };
  },
  (state, args) => paletteDensity(state.ui) === args.density,
);

// the densities the panel offers: the values of the density argument of palette.setDensity (the manifest's)
export const PALETTE_DENSITIES: readonly string[] = commandOf(setDensity.command).args.density?.values ?? [];

// How well a palette entry answers what the search field holds (spec palette-search-groups; jornada03 J11, J12): null
// when it does not, else a rank, lower first — the name itself, a name that starts with the text, a word of the name
// that does, a name that holds it, then the words that also name it (its English name, the synonyms of the person's
// language: "texto" finds Paragraph, "botao" Button), then its tag. Case, accents and the spaces around the text aside;
// everything answers an empty search, in its own order.
const folded = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase();
export function paletteRank(query: string, label: string, tag: string | null, also: readonly string[] = []): number | null {
  const q = folded(query);
  if (q === '') return 0;
  const name = folded(label);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (also.some((words) => folded(words).split(/\s+/).some((word) => word.startsWith(q)))) return 4;
  return (tag ?? '').toLowerCase().includes(q) ? 5 : null;
}

// Whether a palette entry answers the search at all.
export const paletteMatches = (query: string, label: string, tag: string | null, also: readonly string[] = []): boolean => paletteRank(query, label, tag, also) !== null;

// The other words a palette entry answers to: its English name, and the synonyms the catalogues give it in the person's
// language and in English (palette.keywords.<entry>), where they have them — the Insert panel's search and the
// command bar's insert entries alike (the audit of 2026-10-05, AU6-12)
export function alsoNamed(locale: Locale, entry: string, labelKey: string): readonly string[] {
  const key = `palette.keywords.${entry}`;
  const words = [translate('en', labelKey as MessageId)];
  if (hasText(locale, key)) words.push(translate(locale, key as MessageId));
  if (locale !== 'en' && hasText('en', key)) words.push(translate('en', key as MessageId));
  return words;
}
// the HTML tag an element of the palette is made with, a word its entry answers to too
export const tagOfElement = (element: string): string | null => manifest.elements.elements.find((e) => e.id === element)?.tag ?? null;
