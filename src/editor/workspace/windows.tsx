// The panels that left their place (specs floating-panels and panel-combine-tabs; PRODUCT.md §5 "The shell
// regions"): a floating window at the point it was dropped, the right dock, a combined area's tabs and stacks, and the
// hint drawn while a panel is dragged. The drag itself belongs to the pointer owner, which publishes it in
// panel-drag.ts; this file draws every place that gesture reaches. Each panel's header carries the drag door of the
// manifest (the canvas place: anywhere else the pointer lands, the release runs that place's own door, panel-drag.ts)
// and the panel it moves, so a press on it starts the drag.
import { createContext, useContext, useSyncExternalStore, type ComponentType, type ReactElement } from 'react';
import type { MessageId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import { DoorControl, Icon } from '../doors/door.tsx';
import { useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { PANELS, panelName, type Panel } from './panel-catalogue.ts';
import { combinationAt, type FloatingPanel } from './layout.ts';
import { keptInside, panelDrop, panelHint } from './panel-drag.ts';

export type PanelBodies = Readonly<Partial<Record<Panel, ComponentType>>>;

// which panels the shell draws a body for, and the component that draws it: the shell provides it once (shell.tsx)
export const PanelBodyTable = createContext<PanelBodies>({});

// the tab of a combined area (workspace.setActiveTab, the sidebar group): each tab stands for the panel it names
const SIDEBAR_TAB = manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.args.group === 'sidebar') ?? null;

// the panel drags of a header: the five places a release lands in, and — for a floating window's header — the drag
// that moves a window (the manifest's own doors, one per place)
const SIDEBAR_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'panel-header');
const WINDOW_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'floating-header');

// The grip of a panel's header (specs floating-panels and panel-combine-tabs): one control per place a dragged panel
// can land in, side by side across the header. A press on any of them opens the drag (pointer.ts); the place the
// pointer is in when the release comes decides which one runs (panel-drag.ts), so a person presses the header and the
// panel follows the pointer — the grip only says, in the manifest's data, what the release can do.
export function PanelGrip({ panel, floating }: { readonly panel: Panel; readonly floating?: boolean | undefined }) {
  const drags = floating === true ? [...SIDEBAR_DRAGS, ...WINDOW_DRAGS] : SIDEBAR_DRAGS;
  return (
    <span className="panel-grip" data-panel-grip>
      {drags.map((entry) => (
        <span key={entry.ref} className="panel-grip__band" data-door={entry.ref} data-args={JSON.stringify({ ...entry.door.args, panel })} />
      ))}
    </span>
  );
}

// The drag layer: the hint drawn while a panel is dragged (a strip along the edge it would dock to, a cover over the
// panel it would combine with, nothing for a float, where the panel follows the pointer). The gesture itself belongs
// to the pointer owner (src/editor/input/pointer.ts), which publishes the hint here (panel-drag.ts).
export function PanelDragLayer(): ReactElement | null {
  const t = useT();
  const hint = useSyncExternalStore(panelHint.subscribe, panelHint.get);
  // over no other place the panel floats where it is dropped, and the drag draws nothing (spec floating-panels): the
  // panel itself follows the pointer
  if (hint === null || hint.zone === 'canvas') return null;
  const door = panelDrop(hint).door;
  return (
    <div
      className="panel-hint"
      data-zone={hint.zone}
      data-region="panel-hint"
      style={hint.box === null ? undefined : { left: hint.box.x, top: hint.box.y, width: hint.box.width, height: hint.box.height }}
      role="presentation"
    >
      {door === null ? null : (
        <span className="panel-hint__label" data-chrome="panel-hint">
          {t(door.door.labelKey as MessageId)}
        </span>
      )}
    </div>
  );
}

// a panel's body, wherever it shows (a floating window, the right dock)
function PanelBody({ panel }: { readonly panel: Panel }) {
  const t = useT();
  const Body = useContext(PanelBodyTable)[panel];
  return (
    <div className="panel-area__body" role="tabpanel" aria-label={t(panelName(panel))}>
      {Body ? <Body /> : t('common.notAvailableYet')}
    </div>
  );
}

// The tab strip of a combined area (spec panel-combine-tabs): one tab per panel, each the workspace.setActiveTab door
// of the sidebar group with the panel it names.
export function PanelTabs({ host }: { readonly host: Panel }) {
  const t = useT();
  const tabs = useEditorState((s) => combinationAt(s.ui, host).tabs.join(','));
  if (SIDEBAR_TAB === null || !tabs.includes(',')) return null;
  return (
    <div className="panel-area__tabs" role="tablist" data-region="tab-strip" data-key-context="tab-strip" aria-label={t(panelName(host))}>
      {tabs.split(',').map((name) => (
        <DoorControl key={name} entry={SIDEBAR_TAB} args={{ group: 'sidebar', panel: name }}>
          <Icon name={PANELS[name as Panel].icon} size="sm" />
          <span className="door__label">{t(panelName(name as Panel))}</span>
        </DoorControl>
      ))}
    </div>
  );
}

// A panel drawn with everything combined with its area: its tab strip, the active tab's body, and each stacked panel
// below with its own header. Used by the sidebar beside its view and inside a floating window, so one rule draws both.
export function PanelArea({ panel }: { readonly panel: Panel }) {
  const active = useEditorState((s) => combinationAt(s.ui, panel).active);
  const stack = useEditorState((s) => combinationAt(s.ui, panel).stack.join(','));
  return (
    <div className="panel-area" data-panel-area={panel} data-panel-area-active={active}>
      <PanelTabs host={panel} />
      <PanelBody panel={active} />
      {stack === ''
        ? null
        : stack.split(',').map((name) => (
            <section key={name} className="panel-area panel-area--stacked" data-panel-area={name}>
              <PanelBody panel={name as Panel} />
            </section>
          ))}
    </div>
  );
}

// The right dock (spec floating-panels): the panels docked to the right edge, each with its header, beside the canvas.
export function RightDock(): ReactElement | null {
  const panels = useEditorState((s) => (s.ui.layout.right ?? []).join(','));
  if (panels === '') return null;
  return (
    <aside className="right-dock" data-region="right-dock">
      {panels.split(',').map((name) => (
        <section key={name} className="panel-shell">
          <PanelArea panel={name as Panel} />
        </section>
      ))}
    </aside>
  );
}

// The floating windows (spec floating-panels): the panels dragged out of their dock, each a window at the point it was
// dropped, kept inside the window whatever point was stored.
export function FloatingWindows(): ReactElement | null {
  const floating = useEditorState((s) => JSON.stringify(s.ui.layout.floating ?? []));
  const list = JSON.parse(floating) as readonly FloatingPanel[];
  if (list.length === 0) return null;
  return (
    <>
      {list.map((window) => {
        const at = keptInside(window);
        return (
          <section key={window.panel} className="panel-window" data-panel-window={window.panel} data-region="panel-window" style={{ left: at.x, top: at.y }} aria-label={window.panel}>
            <PanelArea panel={window.panel} />
          </section>
        );
      })}
    </>
  );
}
