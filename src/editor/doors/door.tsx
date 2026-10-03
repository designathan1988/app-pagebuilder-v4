// Door rendering (PRODUCT.md §5): one door of the manifest drawn as the control its drawnAs names, with the icon
// the manifest names, its label from the catalogue, its shortcut as a hint, and disabled with "not available yet"
// while its command's entry in the command table is NOT_AVAILABLE_YET. Every icon comes from the sprite by a name
// the manifest gives (a door's icon, a glyph, a panel, an element); no component chooses one.
import { useContext, type MouseEvent, type ReactNode } from 'react';
import { wiring } from '../wiring.ts';
import { isFeatureBuilt, isBuilt, type Message } from '../../core/commands/registry.ts';
import { projectFileText } from '../../core/project/archive.ts';
import { pickedFilePath, readUploadFile } from '../../core/files/files.ts';
import type { FolderFile } from '../../core/import/folder.ts';
import { readPickedFiles } from '../../core/import/import.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, KeyContextId, MessageId, PredicateId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { chordHint } from '../input/keymap.ts';
import { pressedByPointer } from '../input/pointer.ts';
import { layeredRules, useEditorState, useStore, type EditorStore } from '../store.ts';
import { PanelBodies } from '../shell/bodies.ts';
import { useT } from '../text.ts';
import { opensEmptyPanel } from '../workspace/panel-catalogue.ts';
import { readClipboard } from '../clipboard.ts';
import { isCurrent, labelParamsOf } from './current.ts';
import { GLYPHS } from './placement.ts';
import { readPickedDataFile } from '../data/read-file.ts';

export function Icon({ name, size = 'md' }: { readonly name: string; readonly size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <svg className={`icon icon--${size}`} aria-hidden="true" focusable="false">
      <use href={`#${name}`} />
    </svg>
  );
}

// A door is usable only when its command is built and its feature is registered as built (the feature table,
// src/app/features.ts; archive/DESIGN.md "Build order"): a menu item, a context-menu item or a toolbar button of a
// feature still to come is drawn "not available yet", or left out of the context menu, even when another feature built
// its command.
export function isDoorBuilt(entry: DoorEntry): boolean {
  return isBuilt(wiring().commands[entry.command.id]) && isFeatureBuilt(entry.door.feature as FeatureId);
}

export interface DoorState {
  // the accessible name and the tooltip's text
  readonly label: string;
  // the text the control shows: the door's face label when the drawing shows a shorter text ("+ Class"), else the label
  readonly face: string;
  readonly title: string;
  readonly built: boolean;
  // built and its availability predicate holds now (Undo with an empty history does not)
  readonly available: boolean;
  readonly current: boolean;
  readonly chord: string | null;
  // why the control is disabled: "not available yet" while its command is not built (archive/DESIGN.md "Build order"),
  // then the door's own reason (disabledReasonKey) while its predicate does not hold; null when it is enabled
  readonly reason: MessageId | null;
  readonly run: () => void;
}

// What every control of a door needs: its label, its tooltip (with the shortcut, or why it is disabled), whether its
// command is built, whether it stands for the current state, and running it through the store. A control that
// stands for one property, attribute or palette entry is labelled by it (the door's own label names the command
// with placeholders: "Set {property} to {value}"), so the caller passes that label. A control whose item a later
// feature brings (`ready` false: a palette entry whose feature the feature table does not register as built,
// src/app/features.ts) is not available yet either. The shortcut
// shown is the command's key in the context the control acts in (`keysIn`: the canvas's for the context menu).
export function useDoor(entry: DoorEntry, args: Readonly<Record<string, unknown>> = {}, labelled?: string, ready = true, keysIn: KeyContextId = 'global'): DoorState {
  const t = useT();
  const store = useStore();
  // a door whose only effect is to open a panel the shell draws no body for is not available yet, like an unbuilt
  // command
  const drawsBody = useContext(PanelBodies);
  const built = ready && isDoorBuilt(entry) && !opensEmptyPanel({ ...entry.door.args, ...args }, drawsBody);
  const current = useEditorState((s) => built && isCurrent(entry, s, args));
  const predicate = wiring().predicates[entry.command.availability.predicate as PredicateId];
  // the predicate reads the layer the editor shows, as the store does when the command runs
  // the door's own arguments with the ones its place adds (the row it stands for): what the command would run with
  const runArgs = { ...entry.door.args, ...args };
  const available = useEditorState((s) => built && (predicate?.test(s, layeredRules(s), runArgs) ?? true));
  // why it is not available now: its predicate's own refusal when it names one (Distribute: three elements, or
  // positioned ones; the audit's A3.23), else the door's reason (disabledReasonKey); one JSON text, stable between
  // renders
  const refused = useEditorState((s) => (built && !available && predicate?.refusal !== undefined ? JSON.stringify(predicate.refusal(s, layeredRules(s), runArgs)) : null));
  // the words the label fills in for the state now (the command's labelParams), as one JSON text so the hook's value
  // is stable between renders
  const params = useEditorState((s) => (built ? JSON.stringify(labelParamsOf(entry, s)) : '{}'));
  const label = labelled ?? t(entry.door.labelKey as MessageId, JSON.parse(params) as Record<string, string>);
  const face = labelled === undefined && entry.door.faceLabelKey !== null ? t(entry.door.faceLabelKey as MessageId) : label;
  const chord = chordHint(entry.command.id, keysIn);
  const said = refused === null ? null : (JSON.parse(refused) as Message);
  const reason: MessageId | null = !built ? 'common.notAvailableYet' : available ? null : (said?.key ?? (entry.door.disabledReasonKey as MessageId));
  const title = reason !== null ? t('common.disabledTitle', { label, reason: { key: reason, params: said?.params ?? {} } }) : chord !== null ? t('common.withShortcut', { label, shortcut: chord }) : label;
  const run = () => {
    if (!built || !available) return;
    const dispatch = store.dispatch as (id: CommandId, args: unknown) => DispatchResult;
    const given = { ...entry.door.args, ...args };
    // a command that reads several files (File › Import HTML) asks the browser for them, reads them — a ZIP stands for
    // its entries — and runs with what they hold (core/import/import.ts readPickedFiles)
    const files = Object.entries(entry.command.args).find(([name, arg]) => arg.type === 'files' && !arg.optional && !(name in given))?.[0];
    if (files !== undefined) {
      void (entry.door.adapter.fileReading === 'folder' ? chooseDirectoryFiles() : chooseFiles()).then(async (chosen) => {
        if (chosen.length === 0) return;
        dispatch(entry.command.id, { ...given, [files]: await readPickedFiles(chosen) });
      });
      return;
    }
    // a command that reads a file (File › Open) asks the browser for it, and runs with the file's text
    const file = Object.entries(entry.command.args).find(([name, arg]) => arg.type === 'file' && !arg.optional && !(name in given))?.[0];
    // a command that takes what the system clipboard holds (clipboard.paste) runs once the clipboard is read
    const clipboard = Object.entries(entry.command.args).find(([name, arg]) => arg.type === 'clipboard' && !(name in given))?.[0];
    if (clipboard !== undefined) {
      void readClipboard().then((content) => dispatch(entry.command.id, { ...given, [clipboard]: content }));
      return;
    }
    // a command that stores the files themselves (Upload files, an image file dropped on the canvas) reads them as an
    // asset: the bytes and, for an image, its intrinsic size (spec explorer-assets)
    // a command that imports a data file (the Data panel's Import) reads its sheets first: CSV, TSV, JSON or XLSX
    // (src/editor/data/read-file.ts), handed over as JSON; a file it cannot read is handed with its problem, which the
    // command says
    if (file !== undefined && entry.door.adapter.fileReading === 'data') {
      void chooseFiles().then(async (chosen) => {
        const one = chosen[0];
        if (one === undefined) return;
        dispatch(entry.command.id, { ...given, [file]: await readPickedDataFile(one) });
      });
      return;
    }
    if (file !== undefined && entry.door.adapter.fileReading === 'upload') {
      void chooseFiles().then(async (chosen) => {
        if (chosen.length === 0) return;
        const records = await Promise.all(chosen.map((one) => readUploadFile(one)));
        dispatch(entry.command.id, { ...given, [file]: records });
      });
      return;
    }
    // a command that takes a whole folder (File › Open folder): the browser's directory picker, and the files with
    // the paths they hold inside the chosen folder
    if (file !== undefined && entry.door.adapter.fileReading === 'folder') {
      void chooseFolder().then((chosen) => {
        if (chosen !== null) dispatch(entry.command.id, { ...given, [file]: chosen });
      });
      return;
    }
    if (file === undefined) {
      dispatch(entry.command.id, given);
      return;
    }
    // the file's text as the project reader takes it (archive.ts): a project archive's project.json, or the file's own
    // text (File › Open is the one command that takes a file)
    void chooseFile().then(async (bytes) => {
      if (bytes !== null) dispatch(entry.command.id, { ...given, [file]: await projectFileText(bytes) });
    });
  };
  return { label, face, title, built, available, current, chord, reason, run };
}

// The browser's file chooser, as a user opens it; the chosen file's text, or null when nothing was chosen.
// Whether a door applies now, for a list that offers only what applies (the command bar): its command can run with
// the arguments the door and its control give. A command whose argument the door reads only when it runs (the file
// chosen, what the clipboard holds) is asked its availability predicate instead, the argument not being known yet.
export function appliesNow(entry: DoorEntry, args: Readonly<Record<string, unknown>>, store: EditorStore): boolean {
  const given = { ...entry.door.args, ...args };
  const readsAtRun = Object.entries(entry.command.args).some(([name, arg]) => (arg.type === 'file' || arg.type === 'files' || arg.type === 'clipboard') && !arg.optional && !(name in given));
  if (!readsAtRun) return store.canRun(entry.command.id, given as never);
  return wiring().predicates[entry.command.availability.predicate as PredicateId]?.test(store.getState(), layeredRules(store.getState())) ?? true;
}

function chooseFile(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', () => {
      const chosen = input.files?.[0];
      if (chosen) void chosen.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null));
      else resolve(null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// the same chooser for a door that keeps the files themselves, which may take more than one (spec explorer-assets)
function chooseFiles(): Promise<readonly File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// The browser's folder chooser, for a door whose command takes a whole folder (File › Open folder): the folder's name
// and its files, each with the path it holds inside the folder (the browser's own webkitRelativePath, the picked
// folder's name left out, so the tree the import builds stands where the folder does). Every file is read by the one
// reader of a file a door hands over (core/files/files.ts readUploadFile). Null when nothing was picked.
function chooseDirectoryFiles(): Promise<readonly File[]> {
  return new Promise<readonly File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

async function chooseFolder(): Promise<{ readonly name: string; readonly files: readonly FolderFile[] } | null> {
  const chosen = await chooseDirectoryFiles();
  if (chosen.length === 0) return null;
  const inside = (file: File): readonly string[] => file.webkitRelativePath.split('/').filter((one) => one !== '');
  const name = inside(chosen[0] as File)[0] ?? '';
  // by path, whatever order the browser listed them in: the tree the import builds reads in that order everywhere
  const ordered = [...chosen].sort((a, b) => (inside(a).join('/') < inside(b).join('/') ? -1 : 1));
  const files = await Promise.all(
    ordered.map(async (file): Promise<FolderFile> => {
      const read = await readUploadFile(file);
      return { ...read, path: pickedFilePath(file) };
    }),
  );
  return { name, files };
}

export interface DoorControlProps {
  readonly entry: DoorEntry;
  // arguments the context adds (the panel a close button belongs to, the page a row stands for)
  readonly args?: Readonly<Record<string, unknown>>;
  // the content of an item, a tab or a disclosure (a row's name, a tab's width); the label when absent; null for a
  // disclosure drawn as its caret alone
  readonly children?: ReactNode;
  // a disclosure's state
  readonly expanded?: boolean;
  readonly className?: string;
  // the label of what the control stands for (a palette entry), instead of the door's own
  readonly label?: string;
  readonly title?: string | undefined;
  // false while what the control stands for arrives with a feature not registered as built (a palette entry's)
  readonly ready?: boolean;
  // the key context the control acts in, whose shortcut its title shows (the text toolbar's: the text editing keys)
  readonly keysIn?: KeyContextId;
  // false: out of the Tab order (a field's Reset this value while the field holds nothing to reset)
  readonly tabbable?: boolean;
  // true: the control holds the group's one Tab stop while it is the current one (a segmented group, the matrix)
  readonly roving?: boolean;
  // whether it is current, instead of its door's own reading (a value several selected elements do not share: false)
  readonly current?: boolean | undefined;
  // true: the control turns its state on and off (a canvas anchor tab: its door toggles an edge), so it says whether it
  // is on (aria-pressed), as a toolbar door the manifest marks pressed does
  readonly toggle?: boolean;
  // the icon of what the control stands for (an insert entry's element), instead of the door's own; null for none
  readonly icon?: string | null;
}

// A toolbar or panel control, drawn as its door's drawnAs says.
// the key context of a group whose controls rove (interactions.json; the arrows move the focus in keymap.ts)
const ROVING_CONTEXT = 'roving-group';

export function DoorControl({ entry, args = {}, children, expanded, className, label, title, ready = true, keysIn = 'global', tabbable = true, current, roving = false, icon: ownIcon, toggle = false }: DoorControlProps) {
  const found = useDoor(entry, args, label, ready, keysIn);
  // a control that stands for a value several selected elements do not share is not current (A3.35)
  const door = current === undefined ? found : { ...found, current };
  const { door: d } = entry;
  const pointerRuns = pressedByPointer(entry);
  const drawnAs = d.kind === 'toolbar' || d.kind === 'panel-control' ? d.drawnAs : 'button';
  // a toggle button says whether its state is on (the door's pressed, manifest data)
  const pressed = toggle || ((d.kind === 'toolbar' || d.kind === 'panel-control') && d.pressed);
  const iconName = ownIcon !== undefined ? ownIcon : d.icon;
  const icon = iconName !== null ? <Icon name={iconName} size={drawnAs === 'icon-button' ? 'md' : 'sm'} /> : null;
  const common = {
    type: 'button' as const,
    className: ['door', `door--${drawnAs}`, door.current ? 'is-current' : '', door.available ? '' : 'is-unavailable', className ?? ''].filter((c) => c !== '').join(' '),
    'data-door': entry.ref,
    // what this control stands for when its door is drawn once per item (a node's row, a palette entry's tile, a panel
    // icon): the values the manifest declares for the door, over the ones the context adds, as the door runs with them
    // (a shortcut of the same command acts on them while the control has the focus)
    'data-args': Object.keys({ ...entry.door.args, ...args }).length > 0 ? JSON.stringify({ ...entry.door.args, ...args }) : undefined,
    title: title ?? door.title,
    tabIndex: roving && door.current !== true ? -1 : tabbable ? undefined : -1,
    // a control of a roving group names the context its arrows move the focus in (A3.24)
    ...(roving ? { 'data-key-context': ROVING_CONTEXT } : {}),
    'aria-disabled': door.available ? undefined : true,
    // a control whose presses the pointer owner runs (a palette tile: a press is its click or its drag, pointer.ts)
    // runs here only an activation with no press (detail 0: assistive technology's)
    onClick: pointerRuns ? (event: MouseEvent) => (event.detail === 0 ? door.run() : undefined) : door.run,
  };
  switch (drawnAs) {
    case 'icon-button':
      return (
        <button {...common} aria-label={door.label} aria-pressed={pressed ? door.current : undefined}>
          {icon}
        </button>
      );
    case 'tab':
      return (
        // named by its label when it differs from its face, or when the caller names it (the Checks tab with its count)
        <button {...common} role="tab" aria-selected={door.current} aria-label={label !== undefined || door.face !== door.label ? door.label : undefined}>
          {icon}
          {children ?? <span className="door__label">{door.face}</span>}
        </button>
      );
    case 'segment':
      return (
        <button {...common} aria-pressed={door.current} aria-label={door.label}>
          {icon}
          {children ?? <span className="door__label">{door.face}</span>}
        </button>
      );
    case 'disclosure':
      // children null: the caret alone (a tree row's), named by its label
      return (
        <button {...common} aria-expanded={expanded ?? true} aria-label={children === null ? door.label : undefined}>
          <Icon name={expanded === false ? GLYPHS.collapsed : GLYPHS.expanded} size="xs" />
          {children === undefined ? <span className="door__label">{door.face}</span> : children}
        </button>
      );
    case 'area':
      // part of a larger surface (a backdrop, a ruler): no text of its own, named by its label, out of the Tab order
      return <button {...common} aria-label={door.label} tabIndex={-1} />;
    default:
      return (
        <button {...common} aria-label={children !== undefined || door.face !== door.label ? door.label : undefined} aria-pressed={pressed ? door.current : undefined}>
          {icon}
          {children ?? <span className="door__label">{door.face}</span>}
        </button>
      );
  }
}
