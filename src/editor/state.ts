import type { PickedFile } from '../generated/commands.ts';
import type { AssistantState } from './assistant/state.ts';
import type { DataUi } from './data/state.ts';
// The editor's part of the store state: panel visibility (workspace/panels.ts), the workspace layout
// (workspace/layout.ts), the preferences (preferences/preferences.ts), the keyboard focus requests (focus/focus.ts),
// the overlays' dismissals (menus/overlays.ts), the context menu's opening (menus/context-menu.ts), the folded
// Layers branches (layers/tree.ts), the name being edited in Layers (layers/rename.ts), the text being edited on the
// canvas (canvas/text-edit.ts), the drop level and the cancellations of the drags (drag/drag-session.ts) and the
// keyboard's hand (core/structure/hand.ts) and the camera's pan (view/camera.ts). Each module owns its part; this file
// only composes them. Document and selection state live in the core store, never here.
import type { NodeId } from '../core/document/model.ts';
import { NO_HAND, type HandState } from '../core/structure/hand.ts';
import { INITIAL_TEXT_EDIT, type TextEditState } from './canvas/text-edit.ts';
import { INITIAL_DRAG_SESSION, type DragSessionState } from './drag/drag-session.ts';
import { INITIAL_FOCUS, type FocusState } from './focus/focus.ts';
import { INITIAL_RENAME, type RenameState } from './layers/rename.ts';
import { INITIAL_LAYERS, type LayersState } from './layers/tree.ts';
import { INITIAL_CONTEXT_MENU, type ContextMenuState } from './menus/context-menu.ts';
import { INITIAL_OVERLAYS, type OverlaysState } from './menus/overlays.ts';
import { INITIAL_LAYOUT, type LayoutState } from './workspace/layout.ts';
import type { WorkspacePrefs } from './workspace/persist.ts';
import { panelsFor } from './workspace/panels.ts';
import type { PanelsState } from './workspace/panel-catalogue.ts';
import { INITIAL_CAMERA, type CameraState } from './view/camera.ts';
import type { EditorView } from './view/editor-view.ts';
import type { CodeTabsState } from './explorer/file-tabs.ts';
import type { PaneKind } from './code-panel/code-panel.ts';
import type { ColorPickerClosed, ColorPickerState } from './inspector/color-picker.ts';
import type { Preferences } from './preferences/preferences.ts';
import type { Selection } from '../core/document/model.ts';
import type { Revealed } from './inspector/sections.ts';
import type { EditMode } from './canvas/edit-mode.ts';
import type { TimelineState } from './timeline/playhead.ts';
import type { MotionUiState } from './motion/state.ts';

export interface EditorUi {
  readonly assistant?: AssistantState;
  // the Data panel: the collection it shows, its query and the data file being imported (data/state.ts); absent until
  // used
  readonly data?: DataUi;
  readonly panels: PanelsState;
  readonly layout: LayoutState;
  readonly preferences: Preferences;
  readonly focus: FocusState;
  readonly overlays: OverlaysState;
  readonly contextMenu: ContextMenuState;
  readonly layers: LayersState;
  // the node whose name is edited in its Layers row (spec rename-element)
  readonly rename: RenameState;
  readonly textEdit: TextEditState;
  readonly drag: DragSessionState;
  // the element held by the keyboard's hand and its aim (spec hand-keyboard-move)
  readonly hand: HandState | null;
  // the page's horizontal place on the stage while it is wider than the stage (spec zoom-keyboard-buttons)
  readonly camera: CameraState;
  // A temporary responsive preview width; choosing a breakpoint returns to its reference width.
  readonly viewportWidth?: number;
  // the colour picker open on a property, and how its last session ended (inspector/color-picker.ts)
  readonly colorPicker: ColorPickerState | null;
  readonly colorPickerClosed: ColorPickerClosed;
  // the asset picker open on an attribute (shell/asset-picker.tsx; spec explorer-assets-use); null while closed
  readonly assetPicker: { readonly attribute: string } | null;
  // the link picker open on a node (shell/link-picker.tsx; the audit's item 7.4); null while closed
  readonly linkPicker: { readonly node: NodeId; readonly kind: string } | null;
  // the component name prompt open on an element (shell/component-prompt.tsx; the audit's item A3.12); null while
  // closed
  readonly componentPrompt: { readonly node: NodeId } | null;
  // the grid the canvas grid editor edits (canvas/grid-edit.ts; the audit's item 8.2); absent while none is
  readonly gridEdit?: NodeId | undefined;
  // the page the editor shows (pages.switch, core/project/pages.ts); absent while it is the project's first page
  readonly page?: string | undefined;
  // the field the inspector was last asked to show (inspector.reveal); absent until one is
  readonly revealed?: Revealed | undefined;
  // the Edit on canvas mode (canvas/edit-mode.ts); absent while none is on
  readonly editMode?: EditMode | undefined;
  // the spacing boxes (padding, margin) an element's link was turned on or off for, by element (inspector/spacing.ts,
  // J27): a box with no entry is linked while its four sides hold the same value
  readonly spacingLinks?: Readonly<Record<string, Readonly<Record<string, boolean>>>> | undefined;
  // the editor state of removable modules (src/modules/*), by the module's namespace: what a tool shows while it is
  // open (the Layout Composer's target, selection, lens, tool); absent while no module holds any
  readonly modules?: Readonly<Record<string, unknown>> | undefined;
  // the class the Style tab's writes go to (inspector/style-target.ts); absent while the target is the element
  readonly styleTarget?: string | undefined;
  // the dialog open (workspace/dialogs.ts): Guides & Grids, Snap settings; absent while none is
  readonly dialog?: 'guides-grids' | 'snap-settings' | 'breakpoints' | 'batch-rename' | 'capture-url' | 'recovery' | 'html-import' | undefined;
  // the last web address asked to be captured, counted (import/capture.ts); absent until one is
  readonly capture?: { readonly url: string; readonly count: number; readonly pages?: number } | undefined;
  // Captured DOM selection is an editor view id. Authored-node commands keep their own selection invariant.
  readonly capturedNode?: string | undefined;
  readonly htmlImport?: { readonly files: readonly PickedFile[] } | undefined;
  // the saved versions the recovery dialog offers, the newest first, with their times (spec
  // autosave-corruption-recovery); absent when the saved work was read
  readonly recovery?: readonly { readonly revision: number; readonly time: number }[] | undefined;
  // the style state the editor edits (view.setStyleState; view/style-state.ts); absent while it is Base
  readonly styleState?: string | undefined;
  // the preview (view/preview.ts): the selection to give back when it ends; absent while editing
  readonly preview?: { readonly selection: Selection } | undefined;
  // the command bar shown (commandBar.open; command-bar/command-bar.ts); absent while closed
  readonly commandBar?: true | undefined;
  // the quick panel open (quickPanel.setOpen; quick-panel/quick-panel.ts); absent while it is a chip
  readonly quickPanelOpen?: true | undefined;
  // the Style tab's Find a property query (inspector.search; inspector/sections.ts); absent while empty
  readonly inspectorSearch?: string | undefined;
  // the centre column's view (view.setEditorView; view/editor-view.ts): the canvas, the canvas beside the code pane,
  // or the code pane alone; absent while it is the canvas
  readonly editorView?: EditorView | undefined;
  // the part of the code the pane shows (codePanel.setPane; code-panel/code-panel.ts); absent while it is HTML
  readonly codePane?: PaneKind | undefined;
  // the file or folder the Explorer's tree renames (files.startRename, explorer/explorer.ts); absent while none is
  readonly renamingFile?: string | undefined;
  // the code files open in the code pane, the last one open, and the pane's drafts (explorer/file-tabs.ts); absent
  // while no code file is open
  readonly code?: CodeTabsState | undefined;
  // the timeline: the animation it shows, where the playhead sits, whether it plays and loops
  // (timeline/playhead.ts, timeline/preview.ts); absent while nothing moved it
  readonly timeline?: TimelineState | undefined;
  // which interaction of the selected element is being given a target (inspector/pick-target.ts); absent while nothing
  // is picked
  readonly pickTarget?: number | undefined;
  // the motion Timeline: the timeline it shows, the playhead, the zoom, the selection, the copied keyframes, recording,
  // snapping, the preview and run mode (motion/state.ts); absent while nothing moved it
  readonly motion?: MotionUiState | undefined;
}

// The workspace the person left (src/editor/workspace/persist.ts): its panels and layout, else the manifest's firsts
export function initialEditorUi(preferences: Preferences, workspace?: WorkspacePrefs): EditorUi {
  return {
    panels: workspace?.panels ?? panelsFor(preferences.developerTools === true),
    layout: workspace?.layout ?? INITIAL_LAYOUT,
    ...(workspace?.page === undefined ? {} : { page: workspace.page }),
    preferences,
    focus: INITIAL_FOCUS,
    overlays: INITIAL_OVERLAYS,
    contextMenu: INITIAL_CONTEXT_MENU,
    layers: INITIAL_LAYERS,
    rename: INITIAL_RENAME,
    textEdit: INITIAL_TEXT_EDIT,
    drag: INITIAL_DRAG_SESSION,
    hand: NO_HAND,
    camera: INITIAL_CAMERA,
    colorPicker: null,
    colorPickerClosed: { applied: false, count: 0 },
    assetPicker: null,
    linkPicker: null,
    componentPrompt: null,
  };
}
