// The OS file drop (split out of input/pointer.ts): the HTML5 drag events of a file dragged in from the operating
// system — an image held over the canvas (spec explorer-assets-use; the user's real-use audit, 7.3), which publishes
// the same creation-drag proposal the palette's drag draws, so the person sees where the image lands; and a file
// released on the Explorer's Files region, which uploads it (spec explorer-assets). The frame's own window reports
// its drags to this module too (canvas/frame.tsx). Pointer state, not editor state.
import { locate, type NodeId } from '../../core/document/model.ts';
import { readUploadFile, type UploadedFile } from '../../core/files/files.ts';
import { message } from '../../core/commands/registry.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { canvasFrame, framePointOnScreen, geometryOf, nodesUnder, type Point } from '../canvas/coordinates.ts';
import type { EditorStore } from '../store.ts';
import { proposalAt } from './drop-proposals.ts';
import { pointerViews, type Inserting } from './pointer/views.ts';

// The door an image file dropped in from the operating system runs: the same creation-drag proposal the palette draws.
export const osImageDoor: DoorEntry | null = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'os-image-file') ?? null;
// the element type a drop that lands on one replaces the source of
const IMAGE_TYPE = 'image';

// An image file held over the canvas: the proposal the release would commit, so the chrome draws where it lands; over
// an image, the image the file would replace is outlined instead (the pointer's own hover mark).
export function showFileDrag(store: EditorStore, inserting: Inserting, at: Point): void {
  const proposal = proposalAt(store.getState().document, [], at);
  const { setDrag, setHovered } = pointerViews(store);
  setHovered(null);
  setDrag({ dragged: [], inserting, proposal, refusal: null, redirect: null, levels: 0, at, side: null });
}
// The place an image file released at this point would take, as the proposal the chrome drew: what the drop proposes.
export function fileDropProposal(store: EditorStore | null, at: Point): { readonly parent: string; readonly index: number } | null {
  const proposal = store === null ? null : proposalAt(store.getState().document, [], at);
  return proposal === null ? null : { parent: proposal.parent, index: proposal.index };
}
export function showFileTarget(store: EditorStore, node: string): void {
  const { setDrag, setHovered } = pointerViews(store);
  setDrag(null);
  setHovered(node);
}
export function hideFileDrag(store: EditorStore): void {
  const { setDrag, setHovered } = pointerViews(store);
  setDrag(null);
  setHovered(null);
}

// The image the pointer is over: the one a release would replace the source of.
function imageUnder(store: EditorStore, at: Point): string | null {
  const frame = canvasFrame();
  if (frame === null) return null;
  const document = store.getState().document;
  for (const id of nodesUnder(frame, at)) {
    const found = locate(document, id as NodeId);
    if (found !== null && found.node.type === IMAGE_TYPE) return found.node.id;
  }
  return null;
}

// An image file dropped onto the Explorer's Files region uploads (spec explorer-assets; the door files.upload's folder
// drop). The drop zone is the region the sidebar marks (data-drop-zone), read here so no control holds a drag handler.
function installFolderDrop(store: EditorStore, win: Window): () => void {
  const door = folderDoor;
  if (door === null) return () => {};
  const over = (event: DragEvent): void => {
    const zone = zoneOf(event.target);
    if (zone === null || !carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent): void => {
    const zone = zoneOf(event.target);
    if (zone === null) return;
    event.preventDefault();
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (dropped.length === 0) return;
    void Promise.all(dropped.map((one) => readUploadFile(one))).then((stored) => {
      store.dispatch(door.command.id as never, { ...door.door.args, files: stored } as never);
    });
  };
  win.addEventListener('dragover', over as EventListener);
  win.addEventListener('drop', drop as EventListener);
  return () => {
    win.removeEventListener('dragover', over as EventListener);
    win.removeEventListener('drop', drop as EventListener);
  };
}
const folderDoor = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'os-file') ?? null;
function zoneOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('[data-drop-zone="explorer-folder"]') : null;
}
function carriesFiles(event: DragEvent): boolean {
  const items = event.dataTransfer?.items;
  return items !== undefined && items !== null && [...items].some((item) => item.kind === 'file');
}

function carriesImage(event: DragEvent): boolean {
  const items = event.dataTransfer?.items;
  if (items === undefined || items === null) return false;
  return [...items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

// the pointer's place on the screen, when the event lies on the frame's own box (an event of the frame's own window
// arrives in its coordinates, one of the editor's in the editor's)
function overCanvas(event: DragEvent, inside: boolean): Point | null {
  const frame = canvasFrame();
  if (frame === null) return null;
  if (inside) return framePointOnScreen(frame, { x: event.clientX, y: event.clientY });
  const g = geometryOf(frame);
  if (g === null) return null;
  const rect = frame.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
  return { x: event.clientX, y: event.clientY };
}

// An image file dragged in from the operating system (spec explorer-assets-use): held over the canvas it shows where
// it would land; released there it is stored and inserted where the line stood — or replaces the image it was dropped
// on. A release over the Explorer's folder zone uploads into it (spec explorer-assets). `inside` names the frame's own
// window, whose events also reach the editor's (canvas/frame.tsx).
export function installOsFileDrop(store: EditorStore, win: Window, inside: boolean): () => void {
  const stopFolder = installFolderDrop(store, win);
  const door = osImageDoor;
  if (door === null) return stopFolder;
  const inserting: Inserting = { tile: door, args: {}, drop: door };
  const over = (event: DragEvent): void => {
    if (!carriesImage(event)) return;
    event.preventDefault();
    const at = overCanvas(event, inside);
    if (at === null) {
      hideFileDrag(store);
      return;
    }
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    const target = imageUnder(store, at);
    if (target !== null) showFileTarget(store, target);
    else showFileDrag(store, inserting, at);
  };
  const leave = (): void => hideFileDrag(store);
  const drop = (event: DragEvent): void => {
    if (!carriesImage(event)) return;
    event.preventDefault();
    const at = overCanvas(event, inside);
    hideFileDrag(store);
    if (at === null) return;
    const file = event.dataTransfer?.files?.[0];
    if (file === undefined) return;
    const target = imageUnder(store, at);
    const place = target === null ? fileDropProposal(store, at) : null;
    if (target === null && place === null) return;
    // The image is decoded asynchronously, and the place and the target were computed before the wait: they are
    // re-checked against the document as it is now, so a target that is gone — or a parent that is — refuses the drop
    // with a word instead of landing where the person never saw it (plan T3; a plain revision comparison would refuse
    // on any other command that landed meanwhile, which is not the same thing).
    void readUploadFile(file).then((payload: UploadedFile) => {
      const document = store.getState().document;
      const parent = target === null && place !== null ? locate(document, place.parent as NodeId) : null;
      const stillThere = target !== null ? locate(document, target as NodeId) !== null : parent !== null;
      if (!stillThere) {
        store.notice(message('status.stale'));
        return;
      }
      const args = target === null
        ? { ...door.door.args, file: payload, parent: place?.parent, index: Math.min(place?.index ?? 0, parent?.node.children.length ?? 0) }
        : { ...door.door.args, file: payload, parent: locate(document, target as NodeId)?.parent?.id, index: 0, replace: target };
      store.dispatch(door.command.id, args as never);
    });
  };
  const listeners: readonly [string, EventListener][] = [
    ['dragenter', over as EventListener],
    ['dragover', over as EventListener],
    ['dragleave', leave as EventListener],
    ['drop', drop as EventListener],
  ];
  for (const [name, listener] of listeners) win.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of listeners) win.removeEventListener(name, listener);
    stopFolder();
  };
}
