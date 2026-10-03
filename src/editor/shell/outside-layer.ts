// Nonmodal layers share one outside-press and focus policy. The pointer owner publishes the press;
// no shield consumes it. Portal children protect their parent through their trigger, not DOM ancestry alone.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { pointerViews } from '../input/pointer/views.ts';
import { useStore, type EditorStore } from '../store.ts';

interface Layer {
  readonly panel: HTMLElement;
  readonly anchor: HTMLElement | null;
  readonly dismiss: () => void;
}
// the open layers of each editor (the plan's T7: its own presses dismiss its own layers), listening to its presses
// from the first layer it opens
const LAYERS = new WeakMap<EditorStore, Set<Layer>>();
function layersOf(store: EditorStore): Set<Layer> {
  let layers = LAYERS.get(store);
  if (layers === undefined) {
    const own = new Set<Layer>();
    pointerViews(store).outsidePress.subscribe((target) => {
      const inside = new Set([...own].filter((layer) => layer.panel.contains(target) || layer.anchor?.contains(target)));
      for (const child of inside) {
        for (const parent of own) if (child.anchor && parent.panel.contains(child.anchor)) inside.add(parent);
      }
      for (const layer of [...own].reverse()) if (!inside.has(layer)) layer.dismiss();
    });
    LAYERS.set(store, own);
    layers = own;
  }
  return layers;
}

export function useOutsideLayer(panel: RefObject<HTMLElement | null>, open: boolean, close: () => void, anchor?: RefObject<HTMLElement | null>, restoreFocus = true, returnFocus?: RefObject<HTMLElement | null>): void {
  const store = useStore();
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useLayoutEffect(() => {
    const own = panel.current;
    if (!open || !own) return;
    const before = returnFocus?.current ?? anchor?.current ?? document.activeElement;
    const restore = before instanceof HTMLElement && before !== document.body ? before : null;
    let outside = false;
    const layer: Layer = {
      panel: own,
      anchor: anchor?.current ?? null,
      dismiss: () => { outside = true;
        latest.current();
      },
    };
    const layers = layersOf(store);
    layers.add(layer);
    return () => {
      layers.delete(layer);
      const focused = document.activeElement;
      if (restoreFocus && !outside && restore?.isConnected && (focused === document.body || focused === null || own.contains(focused))) restore.focus();
    };
  }, [panel, open, anchor, restoreFocus, returnFocus, store]);
}
