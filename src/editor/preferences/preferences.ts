// Preferences (PRODUCT.md §5): the UI language and the theme, chosen with preferences.setLanguage and
// preferences.setTheme, and the inspector's collapsed sections (inspector.toggleSection, whose owner,
// src/editor/inspector/sections.ts, says what they mean), stored and restored after a reload (features ui-language,
// theme-switch and inspector-panel).
import { DEFAULT_LOCALE, LOCALES, SECTION_IDS, type Locale, type SectionId } from '../../generated/ids.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import { registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import { walk, type DocumentJson } from '../../core/document/model.ts';
import { commandOf, manifest } from '../../manifest/runtime.ts';
import type { Store } from '../../core/store/store.ts';
import type { EditorUi } from '../state.ts';
import { PALETTE_DENSITIES } from '../palette/palette.ts';
import { ROW_DETAILS } from '../layers/tree.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../view/camera.ts';
import { readOffsets, type Offset } from '../quick-panel/quick-panel.ts';
import { readSnapSettings, type SnapSettings } from '../view/snap.ts';
import { readBreakpoint } from '../view/breakpoints.ts';
import { chosen } from './said.ts';

// the concept rows of the Style tab (properties.json), which the rows' lists may name
const CONCEPT_ROW_IDS: readonly string[] = manifest.properties.conceptRows.map((r) => r.id);

type Theme = CommandArgs['preferences.setTheme']['theme'];

// a language item or a theme item stands for the language or the theme the editor shows
export const setLanguage: RegisteredHandler<'preferences.setLanguage', EditorUi> = registerHandler(
  'preferences.setLanguage',
  ({ state }, args) => {
    if (state.ui.preferences.locale === args.locale) return { kind: 'change' };
    return { kind: 'change', ui: { ...state.ui, preferences: { ...state.ui.preferences, locale: args.locale } }, message: chosen(setLanguage.command, args) };
  },
  (state, args) => args.locale === state.ui.preferences.locale,
);

export const setTheme: RegisteredHandler<'preferences.setTheme', EditorUi> = registerHandler(
  'preferences.setTheme',
  ({ state }, args) => {
    if (state.ui.preferences.theme === args.theme) return { kind: 'change' };
    return { kind: 'change', ui: { ...state.ui, preferences: { ...state.ui.preferences, theme: args.theme } }, message: chosen(setTheme.command, args) };
  },
  (state, args) => args.theme === state.ui.preferences.theme,
);

// the themes preferences.setTheme offers, read from the manifest
const THEMES: readonly string[] = commandOf(setTheme.command).args.theme?.values ?? [];
const isTheme = (value: unknown): value is Theme => typeof value === 'string' && THEMES.includes(value);

export interface Preferences {
  readonly assistantModel?: string;
  readonly locale: Locale;
  readonly theme: Theme;
  // the inspector's collapsed sections, in the sections' order (properties.json); absent while the user collapsed none
  readonly collapsedSections?: readonly SectionId[] | undefined;
  // the sections the user opened although the selected element holds no value in them (inspector.toggleSection; the
  // opening rule in src/editor/inspector/sections.ts); absent while the user opened none
  readonly expandedSections?: readonly SectionId[] | undefined;
  // the Style tab's concept rows the user closed although a detail holds more than the head shows, and those opened
  // although none does (inspector.toggleRow; src/editor/inspector/concept-rows.ts), in the rows' order; absent while
  // none
  readonly collapsedRows?: readonly string[] | undefined;
  readonly expandedRows?: readonly string[] | undefined;
  // how the Elements panel lays its tiles out (palette.setDensity); absent while it is the default, two columns
  readonly paletteDensity?: PaletteDensity | undefined;
  // the Elements panel's collapsed groups (palette.toggleGroup), in the palette's order; absent while every group is
  // open
  readonly collapsedGroups?: readonly string[] | undefined;
  // what each Layers row shows beside its name (layers.setRowDetails), in the command's order; absent while it is the
  // default, the HTML tag alone
  readonly rowDetails?: readonly RowDetail[] | undefined;
  // the canvas zoom in percent (view.zoomIn, view.zoomTo…; src/editor/view/camera.ts); absent in Fit mode
  readonly zoom?: number | undefined;
  // the canvas's view switches (view.toggleOutlines, view.toggleZones; src/editor/view/overlays.ts); absent while off
  readonly outlines?: true | undefined;
  readonly zones?: true | undefined;
  // the rulers and the manual guides hidden (view.toggleRulers, guides.toggleVisible; src/editor/view/overlays.ts);
  // absent while they show
  readonly rulersHidden?: true | undefined;
  // the other breakpoints shown next to the frame (view.toggleSideBySide; src/editor/shell/side-by-side.tsx); absent
  // while off
  readonly sideBySide?: true | undefined;
  readonly guidesHidden?: true | undefined;
  // snapping on (snap.setEnabled), and the targets and distance Snap settings kept (snap.setSettings;
  // src/editor/view/snap.ts); absent while off, and while the settings are the defaults
  readonly snap?: true | undefined;
  readonly snapSettings?: SnapSettings | undefined;
  // the smart guides (alignment lines, equal-spacing markers) and equal spacing turned off (view.toggleSmartGuides,
  // view.toggleEqualSpacing; src/editor/view/overlays.ts); absent while on
  readonly smartGuidesOff?: true | undefined;
  // the breakpoint the editor shows (view.setBreakpoint; src/editor/view/breakpoints.ts); absent while it is the base
  readonly breakpoint?: string | undefined;
  readonly equalSpacingOff?: true | undefined;
  // the Style tab showing its essentials only (inspector.setMode); absent while it shows every property
  readonly inspectorMode?: 'essentials' | undefined;
  // where the quick panel was dragged for each element (quickPanel.setOffset; src/editor/quick-panel/quick-panel.ts),
  // by node id; absent while it was dragged for none
  readonly quickPanelOffsets?: Readonly<Record<string, Offset>> | undefined;
  // the last colours the colour picker applied, the newest first, at most RECENT_COLOURS (colorPicker.apply;
  // src/editor/inspector/color-picker.ts); absent while none
  readonly recentColors?: readonly string[] | undefined;
  // Developer tools on (workspace.toggleDeveloperTools; src/editor/workspace/panels.ts): the dock has its Document tab;
  // absent while off
  readonly developerTools?: true | undefined;
  // the size the person gave each splitter (workspace.resizeSplitter; src/editor/workspace/layout.ts), by splitter
  // name, in px; absent while each one is as layout.json declares it
  readonly splitterSizes?: Readonly<Record<string, number>> | undefined;
}

export const RECENT_COLOURS = 10;

export type RowDetail = CommandArgs['layers.setRowDetails']['detail'];

export type PaletteDensity = CommandArgs['palette.setDensity']['density'];
const GROUP_IDS: readonly string[] = manifest.elements.palette.map((g) => g.id);

// a fresh profile: the default UI language and the default theme of environment.json, every section open
const DEFAULT_THEME = manifest.environment.theme.default;
if (!isTheme(DEFAULT_THEME)) throw new Error(`environment.json: the default theme "${DEFAULT_THEME}" is not a theme of preferences.setTheme`);
export const INITIAL_PREFERENCES: Preferences = { locale: DEFAULT_LOCALE, theme: DEFAULT_THEME };

// Where preferences are kept between sessions; the browser's localStorage by default, a map in tests.
export interface PreferenceStorage {
  read(): string | null;
  write(text: string): void;
}

const KEY = 'preferences';

export const browserStorage: PreferenceStorage = {
  read: () => {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    try {
      window.localStorage.setItem(KEY, text);
    } catch {
      // storage refused (private window, quota): the preferences last for this session only
    }
  },
};

// The language the editor opens in before the person chose one (jornada03 J26): the first of the browser's languages
// the editor speaks, exactly or by its main tag (pt-PT, pt → pt-BR), else the default.
export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const exact = LOCALES.find((one) => one.toLowerCase() === language.toLowerCase());
    if (exact !== undefined) return exact;
    const main = language.split('-')[0]?.toLowerCase() ?? '';
    const near = LOCALES.find((one) => one.split('-')[0]?.toLowerCase() === main);
    if (near !== undefined) return near;
  }
  return DEFAULT_LOCALE;
}
const browserLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages);

// The stored preferences, each one only when it is a value the manifest allows; the defaults otherwise (the language:
// the browser's, when the editor speaks it).
export function loadPreferences(storage: PreferenceStorage, languages: readonly string[] = browserLanguages()): Preferences {
  const text = storage.read();
  if (text === null) return { ...INITIAL_PREFERENCES, locale: browserLocale(languages) };
  try {
    const stored = JSON.parse(text) as Record<string, unknown>;
    const locale = (LOCALES as readonly unknown[]).includes(stored.locale) ? (stored.locale as Locale) : browserLocale(languages);
    const theme = isTheme(stored.theme) ? stored.theme : INITIAL_PREFERENCES.theme;
    // the sections of properties.json the list names, in their order; anything else is left out
    const listed: readonly unknown[] = Array.isArray(stored.collapsedSections) ? (stored.collapsedSections as unknown[]) : [];
    const collapsedSections = SECTION_IDS.filter((s) => listed.includes(s));
    const opened: readonly unknown[] = Array.isArray(stored.expandedSections) ? (stored.expandedSections as unknown[]) : [];
    const expandedSections = SECTION_IDS.filter((s) => opened.includes(s));
    // the concept rows of properties.json each list names, in their order
    const rowsClosed: readonly unknown[] = Array.isArray(stored.collapsedRows) ? (stored.collapsedRows as unknown[]) : [];
    const rowsOpened: readonly unknown[] = Array.isArray(stored.expandedRows) ? (stored.expandedRows as unknown[]) : [];
    const collapsedRows = CONCEPT_ROW_IDS.filter((r) => rowsClosed.includes(r));
    const expandedRows = CONCEPT_ROW_IDS.filter((r) => rowsOpened.includes(r));
    const density = PALETTE_DENSITIES.includes(stored.paletteDensity as string) ? (stored.paletteDensity as PaletteDensity) : undefined;
    const groups: readonly unknown[] = Array.isArray(stored.collapsedGroups) ? (stored.collapsedGroups as unknown[]) : [];
    const collapsedGroups = GROUP_IDS.filter((g) => groups.includes(g));
    const details: readonly unknown[] | null = Array.isArray(stored.rowDetails) ? (stored.rowDetails as unknown[]) : null;
    const rowDetails = details === null ? null : ROW_DETAILS.filter((d) => details.includes(d));
    // a zoom within the camera's range, a whole percent; anything else is Fit mode
    const offsets = readOffsets(stored.quickPanelOffsets);
    const recent = Array.isArray(stored.recentColors) ? (stored.recentColors as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim() !== '').slice(0, RECENT_COLOURS) : [];
    const snapSettings = readSnapSettings(stored.snapSettings);
    const zoom = typeof stored.zoom === 'number' && Number.isInteger(stored.zoom) && stored.zoom >= ZOOM_MIN && stored.zoom <= ZOOM_MAX ? stored.zoom : undefined;
    const splitterSizes = readSplitterSizes(stored.splitterSizes);
    return {
      locale,
      theme,
      ...(typeof stored.assistantModel === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(stored.assistantModel) ? { assistantModel: stored.assistantModel } : {}),
      ...(collapsedSections.length > 0 ? { collapsedSections } : {}),
      ...(expandedSections.length > 0 ? { expandedSections } : {}),
      ...(collapsedRows.length > 0 ? { collapsedRows } : {}),
      ...(expandedRows.length > 0 ? { expandedRows } : {}),
      ...(density !== undefined ? { paletteDensity: density } : {}),
      ...(collapsedGroups.length > 0 ? { collapsedGroups } : {}),
      ...(rowDetails !== null ? { rowDetails } : {}),
      ...(zoom !== undefined ? { zoom } : {}),
      ...(stored.outlines === true ? { outlines: true as const } : {}),
      ...(stored.zones === true ? { zones: true as const } : {}),
      ...(stored.rulersHidden === true ? { rulersHidden: true as const } : {}),
      ...(stored.sideBySide === true ? { sideBySide: true as const } : {}),
      ...(stored.guidesHidden === true ? { guidesHidden: true as const } : {}),
      ...(stored.snap === true ? { snap: true as const } : {}),
      ...(snapSettings !== undefined ? { snapSettings } : {}),
      ...(stored.smartGuidesOff === true ? { smartGuidesOff: true as const } : {}),
      ...(readBreakpoint(stored.breakpoint) !== undefined ? { breakpoint: readBreakpoint(stored.breakpoint) } : {}),
      ...(stored.equalSpacingOff === true ? { equalSpacingOff: true as const } : {}),
      ...(stored.inspectorMode === 'essentials' ? { inspectorMode: 'essentials' as const } : {}),
      ...(offsets !== undefined ? { quickPanelOffsets: offsets } : {}),
      ...(recent.length > 0 ? { recentColors: recent } : {}),
      ...(stored.developerTools === true ? { developerTools: true as const } : {}),
      ...(splitterSizes !== undefined ? { splitterSizes } : {}),
    };
  } catch {
    return INITIAL_PREFERENCES;
  }
}

// the splitter sizes a stored record names, whole px numbers only; anything else is left out (the splitter's own
// bounds are enforced where the size is read: src/editor/workspace/layout.ts)
function readSplitterSizes(value: unknown): Readonly<Record<string, number>> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [splitter, size] of Object.entries(value as Record<string, unknown>)) if (typeof size === 'number' && Number.isInteger(size) && size > 0) out[splitter] = size;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Writes the preferences every time a command changes them, once its gesture is over (a quick panel's grip drag
// changes them at every move; its release keeps the last, Escape none).
export function persistPreferences(store: Store<EditorUi>, storage: PreferenceStorage): () => void {
  let last = store.getState().ui.preferences;
  let lastDocument = store.getState().document;
  return store.subscribe(() => {
    const state = store.getState();
    const now = state.ui.preferences;
    if (store.gestureOpen() || store.sequenceOpen() || store.commandGroupOpen()) return;
    const changed = now !== last;
    const documentChanged = state.document !== lastDocument;
    last = now;
    lastDocument = state.document;
    if (!changed && !documentChanged) return;
    // the offsets of elements the document no longer holds are dropped as they are written (A3.42): the list never
    // grows with the ids of deleted elements or of projects opened before
    const kept = prunedOffsets(state.document, now.quickPanelOffsets);
    const pruned = (kept === undefined ? 0 : Object.keys(kept).length) !== Object.keys(now.quickPanelOffsets ?? {}).length;
    if (!changed && !pruned) return;
    const rest: Record<string, unknown> = { ...now };
    delete rest.quickPanelOffsets;
    storage.write(JSON.stringify(kept === undefined ? rest : { ...rest, quickPanelOffsets: kept }));
  });
}

// The panel offsets of the elements the document still holds, or undefined for none of them.
function prunedOffsets(document: DocumentJson, offsets: Readonly<Record<string, Offset>> | undefined): Readonly<Record<string, Offset>> | undefined {
  if (offsets === undefined) return undefined;
  const ids = new Set<string>();
  for (const page of document.pages) for (const node of walk(page.tree)) ids.add(node.id);
  const kept = Object.entries(offsets).filter(([id]) => ids.has(id));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}
