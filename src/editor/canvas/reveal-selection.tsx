// A selection made away from the canvas brings its element into view (spec keyboard-tree-walk Problem 2: "walking to
// an element outside the canvas viewport scrolls it into view (nearest edge)"; palette-click-insert: "the inserted
// element is scrolled into view if it lands off screen"). The audit of 2026-10-05 found every way of selecting away
// from the canvas leaving it where it was: the arrows' walk, a Layers row, the command bar's find and an insertion
// at the page's end selected an element below the stage, and the inspector named an element the person could not see.
// One rule for all of them: when the selection's first element changes and no part of it is in the stage's view, the
// canvas moves by the least that shows it, its edge an inset inside the view's (an element taller than the view shows
// its top). An element any part of which is in view never moves the canvas: a press on the page always reaches one.
// A selection made with a press in the Layers leaves the canvas as it is: the contract's drag-autoscroll scenario
// chooses an element far below in the Layers, then drags one at the page's top, which must stay where it was.
import { useEffect, type RefObject } from 'react';
import type { CommandId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import { usePointerValue, usePointerViews } from '../input/pointer/use-views.ts';
import { useEditorState, useStore } from '../store.ts';
import { canvasFrame, nodeBox } from './coordinates.ts';
import { travelInto } from './reveal.ts';

// the canvas's pan, the wheel's command: what moves the page under the stage (the quick panel's reveal uses it too)
const PAN = manifest.doors.find((d) => d.door.kind === 'canvas-wheel' && 'dx' in d.command.args);
const token = (element: Element, name: string) => parseFloat(getComputedStyle(element).getPropertyValue(name)) || 0;

export function RevealSelection({ stage }: { readonly stage: RefObject<HTMLDivElement | null> }) {
  const store = useStore();
  const primary = useEditorState((s) => s.selection[0] ?? null);
  const dragging = usePointerValue('drag');
  // where the person's last press went down (the pointer owner's view, pointer/views.ts)
  const views = usePointerViews();
  useEffect(() => {
    if (primary === null || dragging !== null || PAN === undefined || views.pressRegion() === 'layers') return;
    // two frames: the renderer draws an element just inserted, and the layout settles, before it is measured
    let request = requestAnimationFrame(() => {
      request = requestAnimationFrame(() => {
        const area = stage.current;
        const frame = canvasFrame();
        const box = frame === null ? null : nodeBox(frame, primary);
        if (area === null || box === null || (box.width <= 0 && box.height <= 0)) return;
        const stageBox = area.getBoundingClientRect();
        // the page's view, under the frame's tabs: what the person sees of the page
        const view = area.querySelector('.frame__view')?.getBoundingClientRect() ?? stageBox;
        const top = Math.max(stageBox.top, view.top);
        const bottom = Math.min(stageBox.bottom, view.bottom);
        const inset = token(area, '--space-8');
        const dy = travelInto(box.y, box.y + box.height, top, bottom, inset);
        const dx = travelInto(box.x, box.x + box.width, stageBox.left, stageBox.right, inset);
        // a part in view overlaps the view along both axes; seen along one only, it moves along the other
        if (dx === 0 && dy === 0) return;
        (store.dispatch as (command: CommandId, args: unknown) => unknown)(PAN.command.id, { dx: Math.round(dx), dy: Math.round(dy) });
      });
    });
    return () => cancelAnimationFrame(request);
  }, [primary, dragging, stage, store, views]);
  return null;
}
