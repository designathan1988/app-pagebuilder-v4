import { registerPointerTool } from '../input/pointer-tools.ts';
import { motionDragTool } from '../motion/drag-tool.ts';
import { HtmlImportDialog } from './html-import.tsx';
// The shell regions (PRODUCT.md §5): the window grid of with the top bar, the activity
// bar and the sidebar, the centre column, the inspector, the dock and the status bar. The sidebar, the inspector and
// the dock are shown or hidden by the workspace state; the theme and the language follow the preferences.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { installSelectOnFocus } from '../input/select-on-focus.ts';
import { ContextMenu } from '../doors/menu.tsx';
import { CommandBar } from './command-bar.tsx';
import { Confirmation } from './confirmation.tsx';
import { installKeymap } from '../input/keymap.ts';
import { installOsFileDrop, installPointer } from '../input/pointer.ts';
import { installFocus } from '../focus/focus.ts';
import { useEditorState, useStore } from '../store.ts';
import { objectUrl } from '../../core/files/files.ts';
import { fontFaceCss } from '../../core/files/fonts.ts';
import { isPanelOpen } from '../workspace/panels.ts';
import { useT } from '../text.ts';
import { PanelBodies, bodiesDrawn } from './bodies.ts';
import { CanvasColumn } from './canvas.tsx';
import { DOCK_TABS, Dock } from './dock.tsx';
import { Inspector } from './inspector.tsx';
import { ActivityBar, SIDEBAR_SECTIONS, SIDEBAR_VIEWS, Sidebar } from './sidebar.tsx';
import { StatusBar } from './status-bar.tsx';
import { Toast } from './toast.tsx';
import { AssetPicker } from './asset-picker.tsx';
import { LinkPicker } from './link-picker.tsx';
import { ComponentPrompt } from './component-prompt.tsx';
import { ColorPicker } from './color.tsx';
import { GuidesGridsDialog } from './guides-grids.tsx';
import { SnapSettingsDialog } from './snap-settings.tsx';
import { BreakpointsDialog } from './breakpoints-dialog.tsx';
import { BatchRenameDialog } from './batch-rename.tsx';
import { CaptureUrlDialog } from './capture-url.tsx';
import { installCapture } from '../import/capture.ts';
import { uninstallAssistant } from '../assistant/controller.ts';
import { RecoveryDialog } from './recovery.tsx';
import { TabGuardNotice } from './tab-guard.tsx';
import { PreviewBar, PreviewPage } from './preview.tsx';
import { previewing } from '../view/preview.ts';
import { TopBar } from './top-bar.tsx';
import { FitZoom, ReportFitZoom } from './slots.tsx';
import { FloatingWindows, PanelBodyTable, PanelDragLayer, RightDock } from '../workspace/windows.tsx';
import { RegionBoundary } from './region-boundary.tsx';
import { NarrowWindow, useWindowNarrow } from '../workspace/narrow.ts';
import { splitterSize } from '../workspace/layout.ts';
import { onFirstUse, wiring } from '../wiring.ts';

// which panels the shell draws a body for, from the tables it draws them from (bodies.ts), and the component that
// draws each body: a floating window and the right dock draw a panel of any place from the same table
const ALL_BODIES = onFirstUse(() => ({ ...SIDEBAR_VIEWS(), ...SIDEBAR_SECTIONS, ...DOCK_TABS }));
const drawsBody = onFirstUse(() => bodiesDrawn(SIDEBAR_VIEWS(), DOCK_TABS, SIDEBAR_SECTIONS));

function usePreferencesOnDocument(): void {
  const theme = useEditorState((s) => s.ui.preferences.theme);
  const locale = useEditorState((s) => s.ui.preferences.locale);
  useEffect(() => {
    // "system" follows prefers-color-scheme (tokens.css); light and dark are forced with data-theme
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}

// The project's fonts in the editor's own document (the manifest's custom-fonts): one @font-face per font file of the
// tree, served from the file's object URL, so the font menu draws every project family in its own face. The rules come
// from the one owner of the rule text (core/files/fonts.ts); the canvas's copy is the renderer's.
const FONTS_STYLE_ATTRIBUTE = 'data-fonts-style';
function useProjectFontsOnDocument(): void {
  const files = useEditorState((s) => s.document.files);
  useEffect(() => {
    const css = fontFaceCss(files ?? [], (file) => objectUrl(file));
    let sheet = document.head.querySelector(`style[${FONTS_STYLE_ATTRIBUTE}]`);
    if (css === '') {
      sheet?.remove();
      return;
    }
    if (sheet === null) {
      sheet = document.createElement('style');
      sheet.setAttribute(FONTS_STYLE_ATTRIBUTE, '');
      document.head.append(sheet);
    }
    if (sheet.textContent !== css) sheet.textContent = css;
  }, [files]);
}

// Preview over the editor (spec preview-mode; the interface audit, finding F04): the covered editor is inert — no
// pointer, no focus, no assistive technology reaches it — and the focus moves into the preview, as the colour picker's
// own modal does. Leaving the preview puts the focus back where it was.
function usePreviewModal(open: boolean): RefObject<HTMLDivElement | null> {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = root.current;
    const preview = container?.querySelector<HTMLElement>('.preview') ?? null;
    if (!open || container === null || preview === null) return;
    const others = [...container.children].filter((el): el is HTMLElement => el !== preview && el instanceof HTMLElement && !el.inert);
    const wasFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const el of others) el.inert = true;
    const first = preview.querySelector<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? preview).focus();
    return () => {
      for (const el of others) el.inert = false;
      wasFocused?.focus();
    };
  }, [open]);
  return root;
}

export function Shell() {
  const store = useStore();
  const t = useT();
  const sidebar = useEditorState((s) => s.ui.panels.sidebar);
  const inspector = useEditorState((s) => isPanelOpen(s.ui, 'inspector'));
  const dock = useEditorState((s) => s.ui.layout.dock);
  // a measure of the layout (the zoom that fits the frame), not editor state: the camera arrives with the canvas
  const [zoom, setZoom] = useState(1);
  usePreferencesOnDocument();
  useProjectFontsOnDocument();
  useEffect(() => installKeymap(store), [store]);
  useEffect(() => installPointer(store), [store]);
  // the assistant goes with the editor, never with its panel (assistant/controller.ts: a turn outlives a sidebar view)
  useEffect(() => () => uninstallAssistant(store), [store]);
  // the canvas tools of the installed modules (app/modules-view.ts) and the motion Timeline's drags, asked first by the
  // pointer owner (input/pointer-tools.ts)
  useEffect(() => wiring().installTools(), []);
  useEffect(() => registerPointerTool(motionDragTool), []);
  // an image file dragged in from the operating system: here for the editor's window (the canvas and the Explorer's
  // folder drop), in canvas/frame.tsx for the frame's own
  useEffect(() => installOsFileDrop(store, window, false), [store]);
  useEffect(() => installFocus(store), [store]);
  // a web address asked to be captured goes to the Builder Companion (import/capture.ts, spec capture-url)
  useEffect(() => installCapture(store), [store]);
  useEffect(() => installSelectOnFocus(), []);
  // below the manifest's width the sidebar opens over the canvas (workspace/narrow.ts)
  const narrow = useWindowNarrow();
  // the widths the person gave the sidebar and the inspector (their splitters: workspace.resizeSplitter), which the
  // window's columns and everything sized by them take
  const sidebarWidth = useEditorState((s) => splitterSize(s.ui, 'sidebar-width'));
  const inspectorWidth = useEditorState((s) => splitterSize(s.ui, 'inspector-width'));
  const widths = { ...(sidebarWidth === null ? {} : { '--size-sidebar': `${sidebarWidth}px` }), ...(inspectorWidth === null ? {} : { '--size-inspector': `${inspectorWidth}px` }) } as CSSProperties;
  const classes = ['shell', sidebar ? '' : 'shell--no-sidebar', inspector ? '' : 'shell--no-inspector', narrow ? 'shell--narrow' : '', `shell--dock-${dock}`].filter((c) => c !== '').join(' ');
  // while previewing, the preview bar and the exported page over the editor (spec preview-mode): the editor stays as it
  // is underneath, its canvas included, and the status bar below says so
  const inPreview = useEditorState((s) => previewing(s.ui));
  // the editor the preview covers takes no pointer, no focus and no assistive technology while it is open, and the
  // focus moves into the preview and comes back to where it was (the interface audit, finding F04)
  const root = usePreviewModal(inPreview);
  return (
    <NarrowWindow.Provider value={narrow}>
    <PanelBodyTable.Provider value={ALL_BODIES()}>
    <PanelBodies.Provider value={drawsBody()}>
      <FitZoom.Provider value={zoom}>
        <ReportFitZoom.Provider value={setZoom}>
          <div ref={root} className={classes} style={widths} aria-label={t('editor.label')} data-key-context="global">
            {/* each region behind its own error boundary: one that cannot draw leaves the others drawn (AUD-01) */}
            <RegionBoundary region="top-bar"><TopBar /></RegionBoundary>
            <RegionBoundary region="activity-bar"><ActivityBar /></RegionBoundary>
            {sidebar ? <RegionBoundary region="sidebar"><Sidebar /></RegionBoundary> : null}
            <div className="workbench">
              <div className="workbench__row">
                <RegionBoundary region="canvas"><CanvasColumn /></RegionBoundary>
                {/* the panels docked to the right edge, beside the canvas (spec floating-panels) */}
                <RegionBoundary region="right-dock"><RightDock /></RegionBoundary>
              </div>
              <RegionBoundary region="dock"><Dock /></RegionBoundary>
            </div>
            <RegionBoundary region="inspector"><Inspector /></RegionBoundary>
            <RegionBoundary region="status-bar"><StatusBar /></RegionBoundary>
            <RegionBoundary region="overlays">
              <Toast />
              <ContextMenu />
              {/* the panels dragged out of their dock, and the drag that moves a panel (specs floating-panels and
                  panel-combine-tabs) */}
              <FloatingWindows />
              <PanelDragLayer />
              <CommandBar />
              <Confirmation />
              <ColorPicker />
              <AssetPicker />
              <LinkPicker />
              <ComponentPrompt />
              <GuidesGridsDialog />
              <SnapSettingsDialog />
              <BreakpointsDialog />
              <BatchRenameDialog />
              <CaptureUrlDialog />
              <RecoveryDialog />
              <HtmlImportDialog />
              <TabGuardNotice />
            </RegionBoundary>
            {inPreview ? (
              <div className="preview" data-key-context="preview" tabIndex={-1}>
                <RegionBoundary region="preview">
                  <PreviewBar />
                  <PreviewPage />
                </RegionBoundary>
              </div>
            ) : null}
          </div>
        </ReportFitZoom.Provider>
      </FitZoom.Provider>
    </PanelBodies.Provider>
    </PanelBodyTable.Provider>
    </NarrowWindow.Provider>
  );
}
