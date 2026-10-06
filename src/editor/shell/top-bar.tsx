// The top bar : the application menus, the page switcher, the command palette search, undo
// and redo, Preview and Export, in the order of region top-bar.
import { PRODUCT_MARK, PRODUCT_NAME } from '../../config/product.ts';
import { DoorControl, useDoor } from '../doors/door.tsx';
import { GLYPHS, breaksIn, drawnAsOf } from '../doors/placement.ts';
import { useEditorState } from '../store.ts';
import { pageShown } from '../../core/project/pages.ts';
import { Slots } from './slots.tsx';
import { Icon } from '../doors/door.tsx';
import { MenuGroup, useMenuLayer } from '../doors/menu.tsx';
import { useRef } from 'react';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { TopBarSaveState } from './status-bar.tsx';
import { chordCap } from '../input/keymap.ts';

const BREAKS = breaksIn('top-bar');

// The page switcher (the audit's U-011: its chevron opened nothing): the page shown, and a press opens the list of the
// project's pages, each item the switcher's own door standing for its page (pages.switch), the page shown checked;
// choosing one shows it and closes the list, whose Escape and backdrop close it as every menu's do.
function PageSwitcher({ entry }: { readonly entry: DoorEntry }) {
  const page = useEditorState((s) => pageShown(s));
  const pages = useEditorState((s) => s.document.pages);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const layer = useMenuLayer(button, list);
  const door = useDoor(entry);
  return (
    <span className="menu-anchor top-bar__pages">
      <button
        ref={button}
        type="button"
        className={`door door--item top-bar__page${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        aria-haspopup="menu"
        aria-expanded={layer.open}
        aria-label={door.label}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => {
          if (door.available) layer.toggle();
        }}
      >
        <b>{page?.name}</b>
        <span className="top-bar__file">{page?.file}</span>
        <Icon name={GLYPHS.dropdown} size="xs" />
      </button>
      {layer.open ? (
        <div className="menu top-bar__page-menu" role="menu" tabIndex={-1} ref={list} aria-label={door.label} data-key-context="menu">
          {pages.map((one) => (
            <PageItem key={one.tree.id} entry={entry} page={one.tree.id} name={one.name} file={one.file} shown={one.tree.id === page?.tree.id} onDone={layer.close} />
          ))}
        </div>
      ) : null}
    </span>
  );
}

function PageItem({ entry, page, name, file, shown, onDone }: { readonly entry: DoorEntry; readonly page: string; readonly name: string; readonly file: string; readonly shown: boolean; readonly onDone: () => void }) {
  const door = useDoor(entry, { page });
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={shown}
      className="menu__item"
      data-door={entry.ref}
      data-args={JSON.stringify({ page })}
      onClick={() => {
        onDone();
        door.run();
      }}
    >
      <span className="menu__icon">{shown ? <Icon name={GLYPHS.checked} size="sm" /> : null}</span>
      <span className="menu__label">{name}</span>
      <span className="menu__chord top-bar__file">{file}</span>
    </button>
  );
}

function Search({ entry }: { readonly entry: DoorEntry }) {
  const door = useDoor(entry);
  return (
    <DoorControl entry={entry} className="top-bar__search">
      <span className="door__label">{door.label}</span>
      {door.chord !== null ? <kbd>{chordCap(door.chord)}</kbd> : null}
    </DoorControl>
  );
}

export function TopBar() {
  return (
    <header className="top-bar" data-region="top-bar" data-key-context="toolbar">
      <h1 className="top-bar__mark" title={PRODUCT_NAME}>
        <svg className="icon icon--lg" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          {PRODUCT_MARK.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
        <span className="visually-hidden">{PRODUCT_NAME}</span>
      </h1>
      <nav className="top-bar__menus" aria-label={PRODUCT_NAME}>
        <MenuGroup><Slots region="top-bar" to={5} /></MenuGroup>
      </nav>
      <Slots
        region="top-bar"
        from={6}
        render={(slot) => {
          if (slot.kind !== 'door') return undefined;
          // the page switcher stands for the current page (an item), the palette's search is drawn as a field
          const drawn = drawnAsOf(slot.entry);
          const control = drawn === 'item' ? <PageSwitcher key={slot.entry.ref} entry={slot.entry} /> : drawn === 'field' ? <Search key={slot.entry.ref} entry={slot.entry} /> : <DoorControl key={slot.entry.ref} entry={slot.entry} />;
          // a separator before each group the region's breaks start (layout.json); the save state stands before the
          // last group (Preview, Export), after Undo and Redo, as the canonical bar draws it
          const saved = slot.order === BREAKS.at(-1) ? [<TopBarSaveState key="saved" />] : [];
          return BREAKS.includes(slot.order) ? [...saved, <span key={`break-${slot.order}`} className="separator" />, control] : control;
        }}
      />
    </header>
  );
}
