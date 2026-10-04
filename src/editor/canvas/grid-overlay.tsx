// The layout grids drawn over the page (spec layout-grid-overlay; shown or hidden by src/core/page/grid.ts, sized by
// the page's settings of Guides & Grids, else their defaults: gridSetting): the column grid's bands (count columns of
// a band `width` wide, `gutter` apart, inset by max(margin, (page width − grid width) ÷ 2)), the row grid's bands
// (`height` tall, `gutter` apart) and the dot grid (`spacing` apart), all in page px from the page's top-left corner,
// translucent so the page shows through, in the canvas chrome, never in the page.
import { openedPage, pageShown } from '../../core/project/pages.ts';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { columnBands, columnsOf, dotsOf, foldLines, gridShown, rowBands, rowsOf } from '../../core/page/grid.ts';
import { useEditorState } from '../store.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';
import { useT } from '../text.ts';
import { canvasFrame, geometryOf, nodeBox } from './coordinates.ts';

interface Page {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function GridOverlay() {
  const t = useT();
  const columns = useEditorState((s) => gridShown(s, 'gridColumns'));
  const rows = useEditorState((s) => gridShown(s, 'gridRows'));
  const dots = useEditorState((s) => gridShown(s, 'gridDots'));
  const folds = useEditorState((s) => gridShown(s, 'foldLines'));
  // the screen the fold lines go by: the breakpoint in view (properties.json, item 2.3)
  const screen = useEditorState((s) => activeBreakpoint(s).height);
  const root = useEditorState((s) => pageShown(s)?.tree.id ?? null);
  // each grid's settings now (one text, so the hook's answer is stable)
  const breakpoint = useEditorState((s) => activeBreakpoint(s).id);
  // the open page's settings (the audit's PG2: the first page's were drawn on every page)
  const settings = useEditorState((s) => JSON.stringify({ columns: columnsOf(s.document, breakpoint, openedPage(s)), rows: rowsOf(s.document, breakpoint, openedPage(s)), dots: dotsOf(s.document, breakpoint, openedPage(s)) }));
  const { columns: grid, rows: bands, dots: spots } = JSON.parse(settings) as { columns: ReturnType<typeof columnsOf>; rows: ReturnType<typeof rowsOf>; dots: ReturnType<typeof dotsOf> };
  const { height: rowHeight, gutter: rowGutter } = bands;
  const dotSpacing = spots.spacing;
  const layer = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  // the frame's own height: the columns run to the bottom of what is shown, past the page's last element (A3.17)
  const [frameHeight, setFrameHeight] = useState(0);

  useEffect(() => {
    if (!columns && !rows && !dots && !folds) return;
    let request = 0;
    const read = () => {
      const iframe = canvasFrame();
      const g = iframe ? geometryOf(iframe) : null;
      const box = iframe && root !== null ? nodeBox(iframe, root) : null;
      const tall = iframe ? iframe.getBoundingClientRect().height : 0;
      setFrameHeight((before) => (Math.abs(before - tall) < 0.5 ? before : tall));
      const origin = layer.current?.getBoundingClientRect();
      if (g && box && origin) {
        const next = { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height, zoom: g.zoom };
        setPage((before) => (same(before, next) ? before : next));
      }
      request = requestAnimationFrame(read);
    };
    request = requestAnimationFrame(read);
    return () => cancelAnimationFrame(request);
  }, [columns, rows, dots, folds, root, breakpoint]);

  const rowTops = rows && page ? rowBands(page.height / page.zoom, rowHeight, rowGutter) : [];
  return (
    <div className="chrome__grids" ref={layer}>
      {columns && page
        ? columnBands(page.width / page.zoom, grid).map((c, i) => (
            <div key={i} className="chrome__grid-column" data-region={i === 0 ? 'grid-columns' : undefined} style={{ left: page.x + c.x * page.zoom, top: page.y, width: c.width * page.zoom, height: Math.max(page.height, frameHeight) }} />
          ))
        : null}
      {rows && page
        ? rowTops.map((y, i) => (
            <div key={i} className="chrome__grid-row" data-region={i === 0 ? 'grid-rows' : undefined} style={{ left: page.x, top: page.y + y * page.zoom, width: page.width, height: Math.min(rowHeight * page.zoom, page.height - y * page.zoom) }} />
          ))
        : null}
      {folds && page
        ? foldLines(page.height / page.zoom, screen).map((y, i) => (
            <div key={i} className="chrome__fold" data-region={i === 0 ? 'canvas-folds' : undefined} style={{ left: page.x, top: page.y + y * page.zoom, width: page.width }}>
              <span className="chrome__fold-label">{t('canvas.foldLabel', { fold: String(i + 1), px: String(y) })}</span>
            </div>
          ))
        : null}
      {dots && page ? <div className="chrome__grid-dots" data-region="grid-dots" style={{ left: page.x, top: page.y, width: page.width, height: page.height, '--grid-dot': `${dotSpacing * page.zoom}px` } as CSSProperties} /> : null}
    </div>
  );
}
