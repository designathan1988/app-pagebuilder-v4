// The host API of the removable modules (plan I.10; PRODUCT.md §5, Removable modules): everything a module under
// src/modules may use of the editor, the document core, the manifest and the generated lists, in one file. A module
// imports this file (and its tests src/editor/host-testing.ts) and nothing else outside its own folder: a lint rule
// refuses a deep import (eslint.config.js). A name joins here when a module needs it; what is not here is the
// editor's own business, free to change without breaking a module.

// commands: registering a module's handlers and predicates, and the words of their outcomes
export { message, registerHandler, registerPredicate } from '../core/commands/registry.ts';
export type { HandlerContext, Message, Outcome } from '../core/commands/registry.ts';
export type { DispatchResult, Gesture } from '../core/store/store.ts';

// the document: its model, its pages, breakpoints, files, locks and the elements a module makes
export { locate, walk } from '../core/document/model.ts';
export { leavingNames, releaseReferencesPatch, withoutReferencesTo } from '../core/document/tree.ts';
export type { DocNode, DocumentJson, NodeId, ProjectFile, Styles } from '../core/document/model.ts';
export { breakpointName, breakpointWords, breakpointsOf } from '../core/document/breakpoints.ts';
export { pageShown } from '../core/project/pages.ts';
export { imageFiles, objectUrl } from '../core/files/files.ts';
export { firstLockRefusal } from '../core/nodes/flags.ts';
export { freshName, newElement, nodeMaker } from '../core/structure/node-maker.ts';
export type { NodeMaker } from '../core/structure/node-maker.ts';
export { declarationsOf, readValue } from '../core/style/set.ts';
export { tracksToValue } from '../core/style/tracks.ts';
export { isIdentifier } from '../core/text/identifier.ts';

// the manifest and the generated lists
export { manifest, numberConstant } from '../manifest/runtime.ts';
export type { DoorEntry } from '../manifest/runtime.ts';
export type { JsonValue } from '../generated/commands.ts';
export type { CommandId, KeyContextId, MessageId } from '../generated/ids.ts';

// the editor: its store and state, its words, its doors, the canvas's geometry, the view, the panels, the field
// drafts and the canvas tools a module adds to the pointer owner
export { useEditorState, useStore } from './store.ts';
export type { EditorUi } from './state.ts';
export { textOf, useT } from './text.ts';
export { DoorControl, Icon, useDoor } from './doors/door.tsx';
export { ViewTitle } from './shell/view-title.tsx';
export { canvasFrame, geometryOf, nodeAt, nodeBox } from './canvas/coordinates.ts';
export { BASE_BREAKPOINT, activeBreakpoint } from './view/breakpoints.ts';
export type { Shown } from './view/breakpoints.ts';
export { zoomOf } from './view/camera.ts';
export { hidePanel, isPanelOpen, showPanel } from './workspace/panels.ts';
export { markFieldKept, recordFieldInput } from './input/drafts.ts';
export type { PointerTool, ToolPoint, ToolSession } from './input/pointer-tools.ts';
