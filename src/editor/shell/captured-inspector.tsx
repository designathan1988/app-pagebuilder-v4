import { useMemo, useState, type FormEvent } from 'react';
import type { CapturedNode } from '../../core/document/captured.ts';
import { capturedAt, formattedCapturedCss, formattedCapturedHtml } from '../../core/render/captured.ts';
import type { ProjectFile } from '../../core/document/model.ts';
import { openedPage } from '../../core/project/pages.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';
import type { NodeId } from '../../generated/commands.ts';
import { useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import './captured-inspector.css';

const doors = doorSlots('captured-inspector');
const entry = (id: string) => {
  const found = doors.find((one) => one.door.id === id);
  if (found === undefined) throw new Error(`captured inspector door ${id} is absent`);
  return found;
};
const SELECT = entry('captured-inspector-node');
const APPLY = entry('captured-apply');
const VALUE = entry('captured-value');

interface Row { readonly node: CapturedNode; readonly depth: number; readonly label: string; readonly inBody: boolean }

function flatten(root: CapturedNode): Row[] {
  const rows: Row[] = [];
  const visit = (node: CapturedNode, depth: number, inBody: boolean): void => {
    const label = node.kind === 'element'
      ? `<${node.tag}${node.attributes.find((one) => one.name === 'id')?.value ? ` #${node.attributes.find((one) => one.name === 'id')?.value}` : ''}>`
      : `${node.kind}: ${node.value.replace(/\s+/g, ' ').slice(0, 70)}`;
    const visible = inBody || (node.kind === 'element' && node.tag === 'body');
    rows.push({ node, depth, label, inBody: visible });
    if (node.kind === 'element') node.children.forEach((child) => visit(child, depth + 1, visible));
  };
  visit(root, 0, false);
  return rows;
}

function CapturedRow({ row, selected }: { readonly row: Row; readonly selected: boolean }) {
  const door = useDoor(SELECT, { target: row.node.id as NodeId });
  return <button type="button" className={`captured-inspector__row${selected ? ' is-selected' : ''}`} data-door={SELECT.ref} data-args={JSON.stringify({ target: row.node.id })}
    aria-pressed={selected} title={row.node.id} onClick={door.run} disabled={!door.available}>
    {'  '.repeat(Math.min(row.depth, 12))}{row.label}
  </button>;
}

function CapturedEdit({ node }: { readonly node: CapturedNode }) {
  const t = useT();
  const paintFallback = node.kind === 'element' && (node.attributes.some((one) => one.name === 'data-capture-paint') || (node.tag === 'video' && node.attributes.some((one) => one.name === 'poster')));
  const [operation, setOperation] = useState<'text' | 'attribute' | 'insert' | 'remove' | 'move'>(node.kind === 'text' ? 'text' : 'attribute');
  const [name, setName] = useState('style');
  const [value, setValue] = useState(node.kind === 'text' ? node.value : '');
  const [parent, setParent] = useState(node.id);
  const [index, setIndex] = useState(0);
  const args = { target: node.id, operation, name, value, parent, index };
  const apply = useDoor(APPLY, args);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply.run();
  };
  return <form className="captured-inspector__form" data-region="captured-edit" onSubmit={submit}>
    {paintFallback && <p>{t('capture.editor.paintFallback')}</p>}
    <label>{t('capture.editor.operation')}
      <select value={operation} onChange={(event) => setOperation(event.currentTarget.value as typeof operation)}>
        {node.kind === 'text' && <option value="text">{t('capture.editor.text')}</option>}
        {node.kind === 'element' && <option value="attribute">{t('capture.editor.attribute')}</option>}
        {node.kind === 'element' && <option value="insert">{t('capture.editor.insert')}</option>}
        <option value="remove">{t('capture.editor.remove')}</option>
        {node.kind === 'element' && <option value="move">{t('capture.editor.move')}</option>}
      </select>
    </label>
    {operation === 'attribute' && <label>{t('capture.editor.attribute')}<input value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>}
    {['text', 'attribute', 'insert'].includes(operation) && <label>{t('capture.editor.value')}<textarea data-door={VALUE.ref} data-key-context="captured-value" data-args={JSON.stringify({ target: node.id, operation, name, parent, index })} value={value} onChange={(event) => setValue(event.currentTarget.value)} /></label>}
    {['insert', 'move'].includes(operation) && <label>{t('capture.editor.target')}<input value={parent} onChange={(event) => setParent(event.currentTarget.value)} /></label>}
    {['insert', 'move'].includes(operation) && <label>{t('capture.editor.index')}<input type="number" min="0" value={index} onChange={(event) => setIndex(Number(event.currentTarget.value))} /></label>}
    <button type="submit" data-door={APPLY.ref} data-args={JSON.stringify(args)} disabled={!apply.available}>{apply.face}</button>
  </form>;
}

function CapturedCss({ file }: { readonly file: ProjectFile }) {
  const [open, setOpen] = useState(false);
  const content = useMemo(() => {
    if (!open) return '';
    const bytes = Uint8Array.from(atob(file.bytes), (character) => character.charCodeAt(0));
    return formattedCapturedCss(new TextDecoder().decode(bytes));
  }, [file, open]);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{file.path}</summary>
    {open && <pre className="captured-inspector__code"><code>{content}</code></pre>}
  </details>;
}

export function CapturedInspector() {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const page = useEditorState((state) => state.document.pages[openedPage(state)]);
  const width = useEditorState((state) => activeBreakpoint(state).width);
  const selected = useEditorState((state) => state.ui.capturedNode ?? null);
  const [search, setSearch] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const root = page?.capture === undefined ? null : capturedAt(page.capture, width);
  const rows = useMemo(() => root === null ? [] : flatten(root), [root]);
  const visible = search.trim() === '' ? rows.filter((one) => one.inBody && (one.node.kind === 'element' || one.node.value.trim() !== '')).slice(0, 200) : rows.filter((one) => one.label.toLowerCase().includes(search.toLowerCase())).slice(0, 200);
  const node = rows.find((one) => one.node.id === selected)?.node ?? null;
  const formatted = useMemo(() => codeOpen && root !== null ? formattedCapturedHtml(root) : '', [codeOpen, root]);
  const stylesheets = document.files?.filter((one) => one.type.toLowerCase().startsWith('text/css')) ?? [];
  return <div className="inspector-scroll captured-inspector" data-region="captured-inspector">
    <h2>{t('capture.editor.nodes')}</h2>
    {(page?.capture?.resourceProblems?.length ?? 0) > 0 && <div role="status" data-region="captured-resource-problems">
      <strong>{t('capture.editor.missingResources', { count: page?.capture?.resourceProblems?.length ?? 0 })}</strong>
      <ul>{page?.capture?.resourceProblems?.slice(0, 12).map((one) => <li key={one.url} title={one.url}>{one.reason}: {one.url}</li>)}</ul>
    </div>}
    <input aria-label={t('capture.editor.search')} placeholder={t('capture.editor.search')} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
    <div role="list" className="captured-inspector__list">{visible.map((row) => <CapturedRow key={row.node.id} row={row} selected={row.node.id === selected} />)}</div>
    {node !== null && <CapturedEdit key={node.id} node={node} />}
    <details onToggle={(event) => setCodeOpen(event.currentTarget.open)}>
      <summary>{t('capture.editor.code')}</summary>
      {codeOpen && <>
        <pre className="captured-inspector__code"><code>{formatted}</code></pre>
        <h3>{t('capture.editor.css')}</h3>
        {stylesheets.map((file) => <CapturedCss key={file.path} file={file} />)}
      </>}
    </details>
  </div>;
}
