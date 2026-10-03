// The rulers (PRODUCT.md §5; spec rulers): the top and left bands of the canvas, drawing the marks rulers.ts places.
// They follow the zoom, the pan and the page's scroll, highlight the extent of the primary selected element on both
// bands and mark the pointer while it is over the canvas; they are measured on every animation frame from the frame's
// geometry (coordinates.ts), which is what the page shows, and they change nothing.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../text.ts';
import { useEditorState } from '../store.ts';
import { canvasFrame, geometryOf, nodeBox } from './coordinates.ts';
import { rulerMarks, type Band, type RulerMeasure } from './rulers.ts';
import { usePointerValue } from '../input/pointer/use-views.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function BandMarks({ band, axis }: { readonly band: Band | undefined; readonly axis: 'x' | 'y' }) {
  if (!band) return null;
  const place = (at: number) => (axis === 'x' ? { left: at } : { top: at });
  return (
    <>
      {band.ticks.map((t) => (
        <span key={`t${t.value}`} className={`ruler__tick${t.major ? ' is-major' : ''}`} style={place(t.at)} />
      ))}
      {band.labels.map((l) => (
        <span key={`l${l.value}`} className="ruler__mark" style={place(l.at)}>
          {l.value}
        </span>
      ))}
      {band.selection ? (
        <span
          className="ruler__selection"
          data-region={axis === 'x' ? 'ruler-selection' : undefined}
          style={axis === 'x' ? { left: band.selection.at, width: band.selection.length } : { top: band.selection.at, height: band.selection.length }}
        />
      ) : null}
      {band.pointer !== null ? <span className="ruler__pointer" style={place(band.pointer)} /> : null}
    </>
  );
}

export function Rulers() {
  const top = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState<Omit<RulerMeasure, 'pointer'> | null>(null);
  const primary = useEditorState((s) => s.selection[0] ?? null);
  // hidden by View › Guides & Grids (view.toggleRulers, a preference)
  const hidden = useEditorState((s) => s.ui.preferences.rulersHidden === true);
  const pointer = usePointerValue('canvasPointer');
  // a guide dragged over its own ruler: the ruler says a release deletes it (spec guides-manual, Problems in Pager 1)
  const dropping = usePointerValue('guideOverRuler');
  const t = useT();
  const hint = <span className="ruler__hint">{t('canvas.guide.deleteHint')}</span>;

  useEffect(() => {
    let request = 0;
    const read = () => {
      const iframe = canvasFrame();
      const g = iframe ? geometryOf(iframe) : null;
      const x = top.current?.getBoundingClientRect();
      const y = left.current?.getBoundingClientRect();
      if (iframe && g && x && y) {
        const next = {
          x: { start: x.left, length: x.width },
          y: { start: y.top, length: y.height },
          origin: { x: g.left - g.scrollX * g.zoom, y: g.top - g.scrollY * g.zoom },
          zoom: g.zoom,
          selected: primary === null ? null : nodeBox(iframe, primary),
        };
        setMeasure((before) => (same(before, next) ? before : next));
      }
      request = requestAnimationFrame(read);
    };
    request = requestAnimationFrame(read);
    return () => cancelAnimationFrame(request);
  }, [primary]);

  const marks = measure ? rulerMarks({ ...measure, pointer }) : null;
  return (
    <>
      <div className="ruler ruler--corner" hidden={hidden} />
      <div className="ruler ruler--x" ref={top} data-region="rulers" data-ruler="horizontal" hidden={hidden}>
        <BandMarks band={marks?.x} axis="x" />
        {dropping === 'horizontal' ? hint : null}
      </div>
      <div className="ruler ruler--y" ref={left} data-ruler="vertical" hidden={hidden}>
        <BandMarks band={marks?.y} axis="y" />
        {dropping === 'vertical' ? hint : null}
      </div>
    </>
  );
}
