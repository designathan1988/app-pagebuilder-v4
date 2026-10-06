// The Explorer view : the Pages section, one row per page, and the Files section, the
// project's folders and files as a tree; Layers is its section below (sidebar/layers.tsx).
import { isDataFile } from '../../../core/design/data.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fitNames } from './name-first.ts';
import type { Page } from '../../../core/document/model.ts';
import { pageShown } from '../../../core/project/pages.ts';
import type { DispatchResult } from '../../../core/store/store.ts';
import type { CommandId, RegionId } from '../../../generated/ids.ts';
import { elementIcon, manifest, type DoorEntry } from '../../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../../doors/door.tsx';
import { GLYPHS, doorSlots } from '../../doors/placement.ts';
import { fileAt, folderOf, folderPaths, nameOfPath, objectUrl, pathGenerated, sizeLabel } from '../../../core/files/files.ts';
import { treeRows, type TreeRow } from '../../explorer/explorer.ts';
import { MODEL_RULES, useEditorState, useStore } from '../../store.ts';
import { panelName } from '../../workspace/panel-catalogue.ts';
import { ViewTitle } from '../view-title.tsx';
import { useT } from '../../text.ts';
import { requireDoor, drawnAs, orderOf, SectionTitle } from './doors.tsx';

const PAGE_ROW = requireDoor('explorer-pages', (d) => drawnAs(d) === 'item');

// the row's name field (pages.rename): the region's one field
const PAGE_NAME = requireDoor('explorer-pages', (d) => drawnAs(d) === 'field');

// the files tree's name field, the door a row's rename runs (the door's own control: the field itself)
const RENAME_DOOR = requireDoor('explorer-files', (d) => d.door.kind === 'panel-control' && d.door.control === 'file-name-field');

// the door a row is dragged by (the Explorer's file tree): its press drags the row, its release on a folder moves it.
// It is a gesture, not a placed control, so it is looked up among the manifest's doors by what it is drawn on.
const DRAG_ROW = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'explorer-row') ?? undefined;

// the door a double-click on a row's name renames with (the Layers row's own pattern): the field it opens is
// files.rename's, drawn in the name's place
const RENAME_START = requireDoor('explorer-files', (d) => d.door.kind === 'panel-control' && d.door.control === 'file-name');

// the Files section's Upload button, and the command its folder drop runs (spec explorer-assets)
const PAGE_ACTIONS = doorSlots('explorer-pages').filter((d) => drawnAs(d) === 'icon-button' && orderOf(d) > orderOf(PAGE_ROW));

// the current page's row is marked by its door's own current state (pages.switch), none before that command exists
function PageRow({ page }: { readonly page: Page }) {
  return (
    <div className="row row--page">
      <DoorControl entry={PAGE_ROW} args={{ page: page.tree.id }} className="row__main">
        <Icon name={elementIcon('page') ?? GLYPHS.folder} size="sm" />
        <span className="row__meta" title={page.file}>{page.file}</span>
      </DoorControl>
      <PageNameField page={page} />
      <span className="row__actions">
        {PAGE_ACTIONS.map((a) => (
          <DoorControl key={a.ref} entry={a} args={{ page: page.tree.id }} />
        ))}
      </span>
    </div>
  );
}

// A page's name, kept by pages.rename on Enter or when the field loses the focus (one undo step): the row shows the
// name its document holds — again after an undo, a redo or a refused name (the status bar's message changes with each)
// — and typing another one keeps it. Only the page on the canvas is renamed in place: another page's name reads as
// text, and a click on it opens that page (the dogfooding pass: a click on "Home" put its name in edit and left the
// canvas on the other page; only the small icon switched).
function PageNameField({ page }: { readonly page: Page }) {
  const field = useDoor(PAGE_NAME, { page: page.id });
  const store = useStore();
  const shown = useEditorState((s) => pageShown(s)?.tree.id === page.tree.id);
  const input = useRef<HTMLInputElement>(null);
  const said = useEditorState((state) => state.message);
  useEffect(() => {
    if (input.current !== null && document.activeElement !== input.current) input.current.value = page.name;
  }, [page.name, said]);
  // the page pages.add just made takes the focus with its name selected, so what is typed next names it (spec
  // explorer-pages, Problems 3: the journey "site" typed "Sobre" after the + and the name stayed "Page")
  // so does a page pages.duplicate just made (jornada03 J20)
  const added = (said?.key === 'status.pages.added' || said?.key === 'status.pages.duplicated') && said.params.file === page.file && shown;
  useEffect(() => {
    if (added && input.current !== null) {
      input.current.focus();
      input.current.select();
    }
  }, [added, said]);
  const keep = (name: string) => {
    if (!field.built || name.trim() === page.name) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(PAGE_NAME.command.id as CommandId, { ...PAGE_NAME.door.args, page: page.tree.id, name });
  };
  return (
    <form className="row__page-name" onSubmit={(event) => { event.preventDefault();
      keep((event.currentTarget.elements.namedItem('name') as HTMLInputElement).value);
    }}>
      <input
        ref={input}
        className="row__name-field"
        type="text"
        name="name"
        defaultValue={page.name}
        disabled={!field.available}
        aria-label={field.label}
        title={field.title}
        spellCheck={false}
        autoComplete="off"
        data-door={PAGE_NAME.ref}
        data-args={JSON.stringify({ page: page.tree.id })}
        readOnly={!shown}
        data-opens={shown ? undefined : ''}
        onClick={(event) => {
          if (shown) return;
          event.currentTarget.blur();
          (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(PAGE_ROW.command.id as CommandId, { ...PAGE_ROW.door.args, page: page.tree.id });
        }}
        onBlur={(event) => keep(event.currentTarget.value)}
      />
    </form>
  );
}

export function Explorer() {
  const t = useT();
  const pages = useEditorState((s) => s.document.pages);
  const makers = useMemo(() => paletteDoors('explorer-files'), []);
  return (
    <section className="view" aria-label={t(panelName('explorer'))}>
      <ViewTitle panel="explorer" title={t(panelName('explorer'))} />
      <div data-region="explorer-pages">
        <SectionTitle title={t('explorer.pages')} region="explorer-pages" />
        {pages.map((p) => (
          <PageRow key={p.id} page={p} />
        ))}
      </div>
      <div data-region="explorer-files">
        <SectionTitle title={t('explorer.files')} region="explorer-files" skip={(one) => (one.door.kind === 'panel-control' ? one.door.control === 'new-file' || one.door.control === 'new-folder' : false)}>
          {makers.newFile === undefined ? null : <NewPath door={makers.newFile} folder={false} />}
          {makers.newFolder === undefined ? null : <NewPath door={makers.newFolder} folder />}
        </SectionTitle>
        <FileRows />
      </div>
    </section>
  );
}

// The project's file tree (spec explorer-file-system): every folder at its path, and under it the files the project
// holds and the files its pages are written at — a page's file a row like any other, which opens the page's markup in
// the code pane. A row's doors are the explorer-files region's: the row itself opens the file, its name (a
// double-click) becomes the field that renames it, Move to… lists the folders it may move into (each an entry of the
// same door, with the folder among its arguments) and Delete takes it away — a folder that holds files asks first
// (dialog.deleteFiles). The two create doors are drawn as the fields their paths are typed into.
function FileRows() {
  const document = useEditorState((s) => s.document);
  const rows = useMemo(() => treeRows(document, MODEL_RULES), [document]);
  const makers = useMemo(() => paletteDoors('explorer-files'), []);
  // a file's name before its folder and size where both do not fit (name-first.ts): after every drawing and on a resize
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current !== null) fitNames(list.current);
  });
  useLayoutEffect(() => {
    const el = list.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => fitNames(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // an image file dropped onto the folder uploads: the pointer owner listens (input/pointer.ts), this marks the place
  return (
    <div ref={list} data-region="explorer-file-rows" data-drop-zone="explorer-folder">
      {rows.map((row) => (
        <TreeRow key={row.path} row={row} doors={makers} />
      ))}
    </div>
  );
}

// the explorer-files region's controls, by what they are
interface TreeDoors {
  readonly newFile: DoorEntry | undefined;
  readonly newFolder: DoorEntry | undefined;
  readonly open: DoorEntry | undefined;
  readonly rename: DoorEntry | undefined;
  readonly remove: DoorEntry | undefined;
  readonly move: DoorEntry | undefined;
  readonly target: DoorEntry | undefined;
  readonly fill: DoorEntry | undefined
}

function paletteDoors(region: RegionId): TreeDoors {
  const held = doorSlots(region);
  const of = (control: string): DoorEntry | undefined => held.find((slot) => slot.door.kind === 'panel-control' && slot.door.control === control);
  return { newFile: of('new-file'), newFolder: of('new-folder'), open: of('file-row'), rename: of('file-name-field'), remove: of('delete'), move: of('move-to'), target: of('move-target'), fill: of('fill-from-data') };
}

// one of the two create doors, drawn as the field a path is typed into: Enter makes it, Escape drops what was typed
function NewPath({ door, folder }: { readonly door: DoorEntry; readonly folder: boolean }) {
  const t = useT();
  const store = useStore();
  const field = useDoor(door, { path: '' });
  // the field is the door's own control: Enter submits its form (as the page name field does) and what is typed is
  // the path, made by the door's command; leaving the field empty makes nothing
  const make = (typed: string): void => {
    const path = typed.trim();
    if (path === '' || !field.built) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(door.command.id as CommandId, { ...door.door.args, path });
  };
  return (
    <form className="file-maker" onSubmit={(event) => { event.preventDefault();
      make(String(new FormData(event.currentTarget).get('path') ?? ''));
      event.currentTarget.reset();
      (event.currentTarget.elements.namedItem('path') as HTMLInputElement | null)?.blur();
    }}>
      <Icon name={folder ? 'folder-plus' : 'file-plus'} size="sm" />
      <input
        className="input file-maker__input"
        type="text"
        name="path"
        data-door={door.ref}
        aria-label={t(folder ? 'explorer.newFolderAria' : 'explorer.newFileAria')}
        placeholder={t(folder ? 'explorer.newFolderHint' : 'explorer.newFileHint')}
        spellCheck={false}
        autoComplete="off"
      />
    </form>
  );
}

function TreeRow({ row, doors }: { readonly row: TreeRow; readonly doors: TreeDoors }) {
  const t = useT();
  const store = useStore();
  const document = useEditorState((s) => s.document);
  const file = row.folder ? null : fileAt(document, row.path);
  // the folders this row may move into (a stable value: a selector that made a new list every read would loop)
  const folders = useMemo(() => (row.folder ? NO_FOLDERS : folderPaths(document).filter((one) => !pathGenerated(one))), [document, row.folder]);
  const [moving, setMoving] = useState(false);
  const target = doors.target;
  const dragDoor = DRAG_ROW;
  const name = nameOfPath(row.path);
  const renaming = useEditorState((s) => s.ui.renamingFile === row.path);
  const renamed = useDoor(RENAME_DOOR, { path: row.path, name: '' });
  // the name field is the door's own control: Enter submits it, leaving it keeps what it holds, and a name that is
  // empty or the one the row already has writes nothing
  const keepName = (typed: string): void => {
    void store.dispatch(RENAME_START.command.id as CommandId, { path: '' });
    if (renamed === null || !renamed.built) return;
    const wanted = typed.trim();
    if (wanted === '' || wanted === name) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(doors.rename?.command.id as CommandId, { path: row.path, name: wanted });
  };
  const style = { paddingLeft: `calc(var(--space-3) + ${row.depth} * var(--space-4))` } as CSSProperties;
  const label = (
    <>
      {file !== null && row.kind === 'image' && !row.folder ? (
        <img className="row__thumb" src={objectUrl(file)} alt="" />
      ) : doors.open === undefined || row.folder ? (
        <Icon name={row.folder ? 'folder' : row.page !== null ? 'globe' : row.generated ? 'file-code' : 'file'} size="sm" />
      ) : (
        /* the icon is the door that opens the file in the code pane (a click anywhere else on the row opens it too,
           run by the pointer owner with the row's drag) */
        <DoorControl entry={doors.open} args={{ path: row.path }} className="row__open-icon" tabbable={false}>
          {/* a code file's kind as its tag (HTML, CSS, JS: the canonical .ftag), any other file its icon */}
          {FILE_TAGS[row.kind] !== undefined ? <span className={`ftag ftag--${row.kind}`}>{FILE_TAGS[row.kind]}</span> : <Icon name={row.page !== null ? 'globe' : row.generated ? 'file-code' : 'file'} size="sm" />}
        </DoorControl>
      )}
      {renaming && doors.rename !== undefined ? (
        <form className="row__rename" onSubmit={(event) => { event.preventDefault();
          keepName(String(new FormData(event.currentTarget).get('name') ?? ''));
        }}>
          <input
            className="input row__name-field"
            type="text"
            name="name"
            data-door={doors.rename.ref}
            data-args={JSON.stringify({ path: row.path })}
            autoFocus
            defaultValue={name}
            aria-label={t('explorer.renameAria', { name })}
            spellCheck={false}
            autoComplete="off"
            onBlur={(event) => keepName(event.currentTarget.value)}
          />
        </form>
      ) : (
        <span className="row__name" title={name}>{name}</span>
      )}
      {/* a file the editor writes says so, its tooltip why it cannot be deleted (the canonical .gen pill) */}
      {row.generated && !row.folder ? <span className="row__gen" title={t(row.kind === 'js' ? 'files.generatedJsTip' : 'files.generatedTip')}>{t('files.generated')}</span> : null}
      {/* the file's folder and its size (spec explorer-assets: "the Explorer lists it, with its path and its size") */}
      <span className="row__meta">{file === null ? '' : folderOf(row.path) === '' ? sizeLabel(file) : `${folderOf(row.path)}/ · ${sizeLabel(file)}`}</span>
    </>
  );
  return (
    <div className={`row${row.folder ? ' row--folder' : ''}`} style={style} data-file={row.path} data-folder={row.folder ? row.path : undefined}>
      {/* a row's main area is the move door: a press drags the row (dropped on a folder it moves into it), a click
          opens it in the code pane — the pointer owner runs both (input/pointer.ts, the explorer-row drag) */}
      {row.folder || dragDoor === undefined ? (
        <span className="row__main">{label}</span>
      ) : (
        <span className="row__main" data-door={dragDoor.ref} data-args={JSON.stringify({ path: row.path, to: folderOf(row.path) })}>
          {label}
        </span>
      )}
      <span className="row__actions">
        {/* a page's file is generated and still moves: it is the page's address in the site's tree (files.move moves
            it with the page), while the stylesheet and the interactions' script stand at their fixed paths */}
        {(row.generated && row.page === null) || doors.move === undefined || folders.length === 0 ? null : <span onClick={() => setMoving((one) => !one)}><DoorControl entry={doors.move} args={{ path: row.path, to: folderOf(row.path) }} label={t('explorer.moveTo', { name })} /></span>}
        {/* a data file (JSON, CSV) fills the selected repeated items with its rows (spec repeat-element) */}
        {doors.fill === undefined || file === null || !isDataFile(file) ? null : <DoorControl entry={doors.fill} args={{ path: row.path }} />}
        {row.generated ? null : <DoorControl entry={RENAME_START} args={{ path: row.path }} />}
        {doors.remove === undefined || row.generated ? null : <DoorControl entry={doors.remove} args={{ path: row.path }} label={t('explorer.deleteRow', { name })} />}
      </span>
      {moving && target !== undefined ? (
        <span className="row__targets" onClick={() => setMoving(false)}>
          {folders.map((folder) => (
            <DoorControl key={folder} entry={target} args={{ path: row.path, to: folder }} className="row__target">
              {/* the entry says the folder it moves into: its path in the tree */}
              <span className="row__target-path">{folder}</span>
            </DoorControl>
          ))}
        </span>
      ) : null}
    </div>
  );
}

const NO_FOLDERS: readonly string[] = [];

// the tag a code file's row shows in place of its icon: the file's kind in capitals (never translated: they are the
// languages' own names)
const FILE_TAGS: Partial<Record<TreeRow['kind'], string>> = { html: 'HTML', css: 'CSS', js: 'JS' };
