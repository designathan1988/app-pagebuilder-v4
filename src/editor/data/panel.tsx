// The Data panel, a view of the sidebar (spec content-data; archive/DESIGN.md "Regions"): the project's collections and
// the file being imported, the collection shown with its fields, query and items, Connect fields for the selected
// element, pages made from the open page, and the shared regions. Every control is a door of the manifest's data
// regions (controls.tsx); what the panel shows is the document and the editor state (state.ts), never a state of its
// own.
import type { ReactNode } from 'react';
import type { NodeId } from '../../generated/commands.ts';
import { collectionsOf } from '../../core/data/collections.ts';
import { shownCollection } from '../../core/data/commands.ts';
import { pageShown } from '../../core/project/pages.ts';
import { DoorControl } from '../doors/door.tsx';
import { ViewTitle } from '../shell/view-title.tsx';
import { useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { panelName } from '../workspace/panel-catalogue.ts';
import { doorOf } from './controls.tsx';
import { CollectionView } from './grid.tsx';
import { MappingView } from './mapping.tsx';
import { PagesView, SharedView } from './pages.tsx';
import { PreviewView } from './preview.tsx';
import { dataOf } from './state.ts';
import './panel.css';

const PANEL = 'data-panel';
const IMPORT = doorOf(PANEL, 'import');
const NEW_COLLECTION = doorOf(PANEL, 'new-collection');
const TAB = doorOf(PANEL, 'collection-tab');

// A section of the panel: its title, then what it holds.
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="data-panel__section">
      <div className="section-title">
        <span className="section-title__text">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function DataPanel(): ReactNode {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const data = useEditorState((state) => dataOf(state.ui));
  const selection = useEditorState((state) => state.selection);
  const page = useEditorState((state) => pageShown(state));
  const collections = collectionsOf(document);
  const collection = useEditorState((state) => shownCollection(state.document, state.ui));
  const query = data.query ?? {};
  const selected = selection.length === 1 ? (selection[0] as NodeId) : null;
  return (
    <section className="view data-panel" aria-label={t(panelName('data'))}>
      <ViewTitle panel="data" title={t(panelName('data'))} />
      <div className="data-panel__body" data-region="data-panel">
        <div className="data-panel__actions">
          <DoorControl entry={IMPORT} />
          <DoorControl entry={NEW_COLLECTION} />
        </div>
        {data.preview === undefined ? null : <PreviewView preview={data.preview} into={collection} />}
        {collections.length === 0 ? (
          <p className="data-panel__note">{t('data.empty')}</p>
        ) : (
          <div className="data-panel__tabs" role="tablist" aria-label={t('data.collections')}>
            {collections.map((one) => (
              <DoorControl key={one.name} entry={TAB} args={{ collection: one.name }} label={one.name}>
                <span className="door__label">{one.name}</span>
              </DoorControl>
            ))}
          </div>
        )}
      </div>
      {collection === undefined ? null : (
        <>
          <Section title={t('data.collection')}>
            <CollectionView collection={collection} query={query} />
          </Section>
          <Section title={t('data.mapping')}>
            <MappingView collection={collection} query={query} selected={selected} />
          </Section>
        </>
      )}
      {page === null ? null : (
        <Section title={t('data.pagesTitle')}>
          <PagesView page={page} collection={collection} />
        </Section>
      )}
      <Section title={t('data.shared')}>
        <SharedView document={document} selected={selected} />
      </Section>
    </section>
  );
}
