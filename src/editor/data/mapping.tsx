// Connect fields (spec content-data, "binding"; jornada03 C4, bet C): the element to repeat — the one selected, or the
// repeated item it lies in — and each of its parts that can show a value (a text, an image's source and alternative
// text, a link's address), with the field it shows: chosen in its menu, or by dragging a column (of the grid or of the
// list here) onto it, which the pointer owner runs (data-door, data-args). Under them, a preview of what the first
// items would show, with the problem of a value no element could show (an image no project file answers to). Then the
// labelled Fill, which repeats the element for every item the query shows, and Unbind for a list bound already.
import type { ReactNode } from 'react';
import type { NodeId } from '../../generated/commands.ts';
import { DataRefusal, queryItems } from '../../core/data/collections.ts';
import { reached, targetsOf, fieldFits, itemPagesOf, valueFor, type DataContext } from '../../core/data/bindings.ts';
import { ITEM_PAGE, type BindTarget, type Collection, type Query } from '../../core/data/model.ts';
import { lineage, type DocNode, type DocumentJson } from '../../core/document/model.ts';
import { fileAt, objectUrl } from '../../core/files/files.ts';
import { plainText, type InlineRun } from '../../core/text/inline.ts';
import type { MessageId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import { DoorControl } from '../doors/door.tsx';
import { MODEL_RULES, useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { DoorField, doorOf, type Option } from './controls.tsx';

const MAPPING = 'data-mapping';
const BIND = doorOf(MAPPING, 'bind-field');
const FILL = doorOf(MAPPING, 'fill-list');
const UNBIND = doorOf(MAPPING, 'unbind');
const COLUMN_DRAG = manifest.doors.find((entry) => entry.door.kind === 'panel-drag' && entry.door.source === 'data-column');
// the items the preview shows
const PREVIEWED = 3;

// The element a fill repeats for the selected one: the repeated item of a bound list it lies in, else the instance it
// lies in, else the element itself; the page's root never.
function templateOf(document: DocumentJson, id: NodeId): { readonly root: DocNode; readonly list: DocNode | null } | null {
  const chain = lineage(document, id);
  for (let i = chain.length - 1; i >= 1; i -= 1) {
    const node = chain[i] as DocNode;
    const parent = chain[i - 1] as DocNode;
    if (node.component !== undefined) return { root: node, list: parent.dataList?.component === node.component ? parent : null };
  }
  const node = chain.at(-1);
  return node === undefined || chain.length < 2 ? null : { root: node, list: null };
}

// What a value shows in the preview: a text, a thumbnail of a project image, an address.
function Shown({ document, value, to }: { readonly document: DocumentJson; readonly value: string | readonly InlineRun[] | undefined; readonly to: BindTarget }): ReactNode {
  const t = useT();
  if (value === undefined) return <span className="data-preview__empty">{t('data.emptyValue')}</span>;
  const text = typeof value === 'string' ? value : plainText(value);
  const file = to === 'image' ? fileAt(document, text) : null;
  if (file !== null) return <img className="data-preview__image" src={objectUrl(file)} alt="" />;
  return <span>{text}</span>;
}

export function MappingView({ collection, query, selected }: { readonly collection: Collection; readonly query: Query; readonly selected: NodeId | null }): ReactNode {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const template = selected === null ? null : templateOf(document, selected);
  const columns = (
    <ul className="data-columns" aria-label={t('data.columns')}>
      {collection.fields.map((field) => (
        <li key={field.key} className="data-column" data-door={COLUMN_DRAG?.ref} data-args={JSON.stringify({ field: field.key })} data-column={field.key}>
          {field.label}
          <span className="data-column__type">{t(`data.type.${field.type}` as MessageId)}</span>
        </li>
      ))}
    </ul>
  );
  if (template === null) {
    return (
      <section className="data-mapping" data-region="data-mapping" aria-label={t('data.mapping')}>
        <p className="data-panel__note">{t('data.selectToRepeat')}</p>
        {columns}
      </section>
    );
  }
  const targets = [...reached(template.root)].flatMap((node) => targetsOf(node, MODEL_RULES).map((to) => ({ node, to })));
  const options = (to: BindTarget): Option[] => [
    { value: '', label: t('data.none') },
    ...collection.fields.filter((field) => fieldFits(to, field)).map((field) => ({ value: field.key, label: field.label })),
    ...(fieldFits(to, ITEM_PAGE) ? [{ value: ITEM_PAGE, label: t('data.itemPage') }] : []),
  ];
  // the preview makes nothing: it reads values, so it needs no id
  const context: DataContext = { ids: { next: () => {
    throw new Error('the preview makes no node');
  } }, rules: MODEL_RULES, words: (key) => t(key) };
  const pages = itemPagesOf(document);
  const rows = queryItems(collection, query).slice(0, PREVIEWED);
  const bound = targets.flatMap(({ node, to }) => (node.bind ?? []).filter((b) => b.to === to).map((b) => ({ node, bound: b })));
  return (
    <section className="data-mapping" data-region="data-mapping" aria-label={t('data.mapping')}>
      <p className="data-panel__note">{t('data.mappingHelp', { name: template.root.name })}</p>
      {columns}
      <ul className="data-targets" aria-label={t('data.targets')}>
        {targets.map(({ node, to }) => (
          <li key={`${node.id}:${to}`} className="data-target" data-data-target="" data-args={JSON.stringify({ node: node.id, to })}>
            <span className="data-target__name">
              {node.name}
              <span className="data-column__type">{t(`data.target.${to}` as MessageId)}</span>
            </span>
            <DoorField entry={BIND} args={{ node: node.id, to }} name="field" value={(node.bind ?? []).find((b) => b.to === to)?.field ?? ''} options={options(to)} label={t('data.bindLabel', { name: node.name, target: t(`data.target.${to}` as MessageId) })} />
          </li>
        ))}
      </ul>
      {bound.length === 0 ? null : (
        <div className="data-grid" aria-label={t('data.previewTitle')}>
          <table className="data-grid__table">
            <thead>
              <tr>
                {bound.map(({ node, bound: b }) => (
                  <th key={`${node.id}:${b.to}`} scope="col">
                    {node.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const place = { collection, item, row: collection.items.indexOf(item) + 1 };
                return (
                  <tr key={item.id}>
                    {bound.map(({ node, bound: b }) => {
                      try {
                        return (
                          <td key={`${node.id}:${b.to}`}>
                            <Shown document={document} value={valueFor(document, b, place, pages, context)} to={b.to} />
                          </td>
                        );
                      } catch (error) {
                        if (!(error instanceof DataRefusal)) throw error;
                        return (
                          <td key={`${node.id}:${b.to}`} className="data-panel__problem" role="alert">
                            {t(error.refusal.key, error.refusal.params)}
                          </td>
                        );
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="data-panel__actions">
        <DoorControl entry={FILL} args={{ node: template.root.id, collection: collection.name, query }} />
        {template.list === null ? null : <DoorControl entry={UNBIND} args={{ node: template.list.id }} />}
      </div>
    </section>
  );
}
