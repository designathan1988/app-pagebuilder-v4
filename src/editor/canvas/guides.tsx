// The page's manual guides on the canvas (spec guides-manual): a line across the page at each guide's page px place,
// with its value at the ruler's end, drawn over the page (the overlay), placed at every frame as the page scrolls or
// zooms. A guide is the drag door of guides.move (the pointer owner moves it, and drops it on its ruler to delete it)
// and takes the focus: the guide key context's keys (arrows, Delete, Backspace, L) act on the focused guide alone
// (Problems in Pager 3).
import { useEffect, useState } from 'react';
import { openedPage } from '../../core/project/pages.ts';
import { guidesOf } from '../../core/page/guides.ts';
import { manifest } from '../../manifest/runtime.ts';
import { useEditorState } from '../store.ts';
import { canvasFrame, geometryOf, pageToScreen } from './coordinates.ts';

// the door a guide is: the drag that moves it over the page
const GUIDE_DRAG = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'guide' && d.door.zone === 'page') ?? null;
const GUIDE_CONTEXT = 'guide';
const NONE: readonly never[] = [];

export function Guides({ overlay }: { readonly overlay: { readonly current: HTMLDivElement | null } }) {
  // none drawn while hidden by View › Guides & Grids (guides.toggleVisible, a preference)
  const guides = useEditorState((s) => (s.ui.preferences.guidesHidden === true ? NONE : guidesOf(s.document, openedPage(s))));
  // the overlay point of the page's origin and the zoom, measured at every frame while there are guides
  const [origin, setOrigin] = useState<{ readonly x: number; readonly y: number; readonly zoom: number } | null>(null);
  useEffect(() => {
    if (guides.length === 0) return;
    let request = 0;
    const measure = () => {
      const frame = canvasFrame();
      const g = frame ? geometryOf(frame) : null;
      const area = overlay.current?.getBoundingClientRect();
      if (g && area) {
        const zero = pageToScreen({ x: 0, y: 0 }, g);
        const next = { x: zero.x - area.x, y: zero.y - area.y, zoom: g.zoom };
        setOrigin((before) => (before !== null && before.x === next.x && before.y === next.y && before.zoom === next.zoom ? before : next));
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [guides.length, overlay]);
  if (guides.length === 0 || origin === null || GUIDE_DRAG === null) return null;
  return (
    <>
      {guides.map((guide) => {
        const across = guide.axis === 'horizontal';
        const at = (across ? origin.y : origin.x) + guide.at * origin.zoom;
        return (
          <div
            key={guide.id}
            className={`guide guide--${guide.axis}${guide.locked === true ? ' is-locked' : ''}`}
            data-door={GUIDE_DRAG.ref}
            data-args={JSON.stringify({ guide: guide.id })}
            data-guide={guide.id}
            data-axis={guide.axis}
            data-key-context={GUIDE_CONTEXT}
            tabIndex={0}
            role="separator"
            aria-orientation={across ? 'horizontal' : 'vertical'}
            aria-valuenow={guide.at}
            aria-label={`${guide.at}`}
            style={across ? { top: at } : { left: at }}
          >
            <span className="guide__value">{guide.at}</span>
          </div>
        );
      })}
    </>
  );
}
