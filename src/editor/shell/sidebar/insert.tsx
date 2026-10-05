// The Insert view (spec palette-click-insert): the element grid of elements.json's palette, its search and density,
// where a new element goes, and the project's components after the element groups.
import { useState } from 'react';
import { isFeatureBuilt } from '../../../core/commands/registry.ts';
import type { DocNode, Location } from '../../../core/document/model.ts';
import { placement } from '../../../core/structure/insert.ts';
import type { FeatureId, MessageId } from '../../../generated/ids.ts';
import { elementIcon, manifest } from '../../../manifest/runtime.ts';
import { DoorControl, Icon } from '../../doors/door.tsx';
import { GLYPHS } from '../../doors/placement.ts';
import { paletteDensity, paletteMatches, paletteRank } from '../../palette/palette.ts';
import { MODEL_RULES, useEditorState, type EditorState } from '../../store.ts';
import { ViewTitle } from '../view-title.tsx';
import { useLocale, useT } from '../../text.ts';
import { hasText, translate, type Locale } from '../../../i18n/index.ts';
import { Slots } from '../slots.tsx';
import { componentsOf } from '../../../core/design/instances.ts';
import { requireDoor, drawnAs } from './doors.tsx';

// an element tile: the item whose command takes a palette entry (a component tile takes a component)
const INSERT_TILE = requireDoor('insert', (d) => drawnAs(d) === 'item' && Object.values(d.command.args).some((a) => a.type === 'palette-entry'));

const INSERT_GROUP = requireDoor('insert', (d) => drawnAs(d) === 'disclosure');

// a component's tile (components.insertInstance): the project's components, after the element groups
const COMPONENT_TILE = requireDoor('insert', (d) => drawnAs(d) === 'item' && 'component' in d.command.args);

// every palette entry, for the search's count of all the panel's entries
const PALETTE_SIZE = manifest.elements.palette.reduce((n, g) => n + g.entries.length, 0);

const tagOfElement = (element: string) => manifest.elements.elements.find((e) => e.id === element)?.tag ?? null;

// Where a palette click inserts now: element.insert's own rule (src/core/structure/insert.ts, `placement` used with no
// parent and no index: the selected container takes the element as its last child, a selected leaf is followed by it,
// nothing selected puts it at the end of the page). The Insert view's top line says it, and the Layers draws a
// dashed line at the row there (the user's real-use audit, A3.19); null when the document has no page.
export function insertDestination(state: EditorState): { readonly parent: Location; readonly previous: DocNode | null } | null {
  const at = placement(state, state.selection, MODEL_RULES, undefined, undefined);
  if (at === null) return null;
  const previous = at.index > 0 ? at.parent.node.children[at.index - 1] ?? null : null;
  return { parent: at.parent, previous };
}

// The line at the top of the Insert view naming where a click inserts: the destination as one JSON text (the hook's
// value stays stable), said in the language the editor shows (the user's real-use audit, A3.19)
function InsertDestination() {
  const t = useT();
  const said = useEditorState((s) => {
    const at = insertDestination(s);
    return at === null ? null : JSON.stringify({ parent: at.parent.node.name, sibling: at.previous?.name ?? null });
  });
  if (said === null) return null;
  const { parent, sibling } = JSON.parse(said) as { parent: string; sibling: string | null };
  return (
    <p className="insert__destination" data-insert-destination>
      {sibling === null ? t('insert.destination.inside', { parent }) : t('insert.destination.after', { parent, sibling })}
    </p>
  );
}

// The other words a palette entry answers to: its English name, and the synonyms the catalogues give it in the person's
// language and in English (palette.keywords.<entry>), where they have them
function alsoNamed(locale: Locale, entry: string, labelKey: string): readonly string[] {
  const key = `palette.keywords.${entry}`;
  const words = [translate('en', labelKey as MessageId)];
  if (hasText(locale, key)) words.push(translate(locale, key as MessageId));
  if (locale !== 'en' && hasText('en', key)) words.push(translate('en', key as MessageId));
  return words;
}

export function Insert() {
  const t = useT();
  const locale = useLocale();
  const density = useEditorState((s) => paletteDensity(s.ui));
  const collapsed = useEditorState((s) => s.ui.preferences.collapsedGroups ?? NO_GROUPS);
  // what the search field holds: the panel's own view (a filter, not a command)
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  // the entries that answer the search, the best answers first (palette.ts paletteRank): the name in the person's
  // language, then its English name and its synonyms (palette.keywords.<entry>, where the catalogue has them)
  const groups = manifest.elements.palette.map((g) => ({
    group: g,
    entries: g.entries
      .map((e) => ({ e, rank: paletteRank(query, t(e.labelKey as MessageId), tagOfElement(e.element), alsoNamed(locale, e.id, e.labelKey)) }))
      .filter((one): one is { e: (typeof g.entries)[number]; rank: number } => one.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((one) => one.e),
  }));
  const matches = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <section className="view" aria-label={t('activity.insert')} data-region="insert">
      <ViewTitle panel="elements" title={t('activity.insert')} />
      <InsertDestination />
      <div className={`insert insert--${density}`}>
        <input className="search" type="search" placeholder={t('insert.search')} aria-label={t('insert.search')} data-local="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {/* the densities, each the small button of its icon with its name as its tooltip (the canonical .seg.icons); they
            are one Tab stop, the density shown, and the arrows move among them (a roving group) */}
        <div className="segmented segmented--icons" role="group">
          <Slots region="insert" render={(slot) => (slot.kind === 'door' && drawnAs(slot.entry) === 'segment' ? <DoorControl key={slot.entry.ref} entry={slot.entry} roving /> : null)} />
        </div>
        {groups.map(({ group: g, entries }) => {
          if (searching && entries.length === 0) return null;
          // a search shows every group that matches, collapsed or not
          const open = searching || !collapsed.includes(g.id);
          return (
            <div key={g.id} className="palette-group">
              <DoorControl entry={INSERT_GROUP} args={{ group: g.id }} expanded={open} className="palette-group__header">
                <span className="door__label">{t(g.labelKey as MessageId)}</span>
                <span className="palette-group__count">{entries.length}</span>
              </DoorControl>
              {/* the tiles are the palette's key context: Enter and Space insert the focused tile's entry */}
              {open ? (
                // a group's tiles are one Tab stop, its first tile; the arrows walk the others (the palette key
                // context; jornada03 plan, stage 5: the Insert panel was 74 Tab stops)
                <div className="tiles" data-region="palette-tiles" data-key-context="palette">
                  {entries.map((e, index) => (
                    <DoorControl key={e.id} entry={INSERT_TILE} args={{ entry: e.id }} className="tile" label={t(e.labelKey as MessageId)} ready={isFeatureBuilt(e.feature as FeatureId)} tabbable={index === 0}>
                      <Icon name={e.icon ?? elementIcon(e.element) ?? GLYPHS.folder} />
                      <span className="tile__label">{t(e.labelKey as MessageId)}</span>
                      {density === 'list' ? <span className="tile__tag">{`<${tagOfElement(e.element) ?? ''}>`}</span> : null}
                    </DoorControl>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <ComponentTiles query={query} density={density} />
        {searching ? <p className="insert__matches">{matches === 0 ? t('palette.search.noMatch', { query: query.trim() }) : t('palette.search.matchCount', { count: matches, total: PALETTE_SIZE })}</p> : null}
      </div>
    </section>
  );
}

const NO_GROUPS: readonly string[] = [];

// The Components group of the Insert view (PRODUCT.md §5.3 `insert` 7; spec reusable-components): a tile per component
// of the project that the search matches, which places an instance (its click, or its drag onto the page); no group
// while the project has none.
function ComponentTiles({ query, density }: { readonly query: string; readonly density: string }) {
  const t = useT();
  const text = useEditorState((s) => componentsOf(s.document).map((c) => c.name).join('\n'));
  const names = (text === '' ? [] : text.split('\n')).filter((name) => paletteMatches(query, name, null));
  if (names.length === 0) return null;
  return (
    <div className="palette-group">
      <div className="palette-group__header palette-group__header--static">
        <span className="door__label">{t('palette.group.components')}</span>
        <span className="palette-group__count">{names.length}</span>
      </div>
      {/* a component tile is a button of its own: Enter and Space press it (the palette key context inserts
         elements) */}
      <div className="tiles" data-region="palette-tiles">
        {names.map((name) => (
          <DoorControl key={name} entry={COMPONENT_TILE} args={{ component: name }} className="tile" label={t(COMPONENT_TILE.door.labelKey as MessageId, { component: name })}>
            {COMPONENT_TILE.door.icon !== null ? <Icon name={COMPONENT_TILE.door.icon} /> : null}
            <span className="tile__label">{name}</span>
            {density === 'list' ? <span className="tile__tag">{t('palette.group.components')}</span> : null}
          </DoorControl>
        ))}
      </div>
    </div>
  );
}
