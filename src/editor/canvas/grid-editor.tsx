// What the canvas grid editor draws (canvas/grid-edit.ts; the user's real-use audit, item 8.2): while a grid is being
// edited, over its tracks — the number of every column at its start, a grip on the boundary between each two columns
// (the canvas-handle door of style.setGridTracks, dragged to size the track before it) and, on the selected item, a
// grip at its bottom-right corner (grid.spanItem, dragged to extend its span). Measured on every animation frame from
// the page (coordinates.ts: the children's boxes and the tracks' own line positions), drawn in the canvas chrome,
// never in the page.
import { useEffect, useRef, useState } from 'react';
import { locate, type NodeId } from '../../core/document/model.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { useEditorState } from '../store.ts';
import { canvasFrame, geometryOf, nodeBox, trackBoxes } from './coordinates.ts';
import { gridEditOf } from './grid-edit.ts';

// the doors this chrome draws: the track grip of the tracks' owner and the span grip of grid.spanItem
const TRACK_GRIP: DoorEntry | undefined = manifest.doors.find((d) => d.door.kind === 'canvas-handle' && d.door.handle === 'grid-track');
const SPAN_GRIP: DoorEntry | undefined = manifest.doors.find((d) => d.door.kind === 'canvas-handle' && d.door.handle === 'grid-span');
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function GridEditor() {
  const editing = useEditorState((s) => gridEditOf(s.ui));
  const item = useEditorState((s) => (s.selection.length === 1 ? (s.selection[0] ?? null) : null));
  const document = useEditorState((s) => s.document);
  const layer = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<{ readonly tracks: readonly Box[]; readonly grid: Box; readonly itemSpan: { readonly box: Box; readonly span: number } | null; readonly zoom: number } | null>(null);
  useEffect(() => {
    // nothing to measure while no grid is edited (the chrome draws nothing either: drawn is only read while editing)
    if (editing === null) return;
    let request = 0;
    const measure = () => {
      const frame = canvasFrame();
      const zoom = frame ? (geometryOf(frame)?.zoom ?? 1) : 1;
      const origin = layer.current?.parentElement?.getBoundingClientRect();
      const found = frame && origin !== null ? trackBoxes(frame, editing as NodeId) : null;
      const grid = frame ? nodeBox(frame, editing as NodeId) : null;
      const selection = item as NodeId | null;
      const at = selection === null ? null : locate(document, selection);
      const inside = at !== null && at.parent?.id === editing;
      const held = frame && inside && selection !== null ? nodeBox(frame, selection) : null;
      const spanProperty = SPAN_GRIP === undefined ? '' : String((SPAN_GRIP.door.args as Record<string, unknown>).property ?? '');
      const layers = inside && at !== null ? (at.node.styles as Record<string, Record<string, Record<string, unknown>>>) : null;
      const spanText = spanProperty === '' || layers === null ? '' : String(Object.values(layers)[0]?.base?.[spanProperty] ?? '');
      const span = /span\s+(\d+)/i.exec(spanText);
      // a new object only when what is drawn changed: an idle grid editor renders nothing (the audit's RL1)
      const next =
        origin === undefined || found === null || grid === null
          ? null
          : {
              zoom,
              tracks: found.map((b) => ({ x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height })),
              grid: { x: grid.x - origin.x, y: grid.y - origin.y, width: grid.width, height: grid.height },
              itemSpan: held === null ? null : { box: { x: held.x - origin.x, y: held.y - origin.y, width: held.width, height: held.height }, span: span === null ? 1 : Number.parseInt(span[1] as string, 10) },
            };
      setDrawn((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [editing, item, document]);
  const active = drawn !== null && editing !== null;
  return (
    <div className="chrome__grid-edit" ref={layer}>
      {!active || drawn === null ? null : drawn.tracks.map((track, i) => (
        <span key={`n${String(i)}`} className="chrome__grid-line-number" style={{ left: track.x, top: track.y }} data-chrome="grid-line-number" {...(i === 0 ? { 'data-region': 'grid-edit-chrome' } : {})}>
          {i + 1}
        </span>
      ))}
      {!active || TRACK_GRIP === undefined || drawn === null
        ? null
        : drawn.tracks.slice(0, -1).map((track, i) => (
            <div
              key={`g${String(i)}`}
              className="chrome__band chrome__band--grid-track"
              data-door={TRACK_GRIP.ref}
              data-args={JSON.stringify({ property: String((TRACK_GRIP.door.args as Record<string, unknown>).property ?? ''), track: i })}
              data-edit-handle=""
              data-start={Math.round(track.width / drawn.zoom)}
              data-normal="1,0"
              data-min="24"
              data-value-arg="value"
              data-chrome="grid-track-grip"
              style={{ left: track.x + track.width - 5, top: drawn.grid.y, width: 'var(--space-5)', height: drawn.grid.height }}
            />
          ))}
      {!active || drawn === null || SPAN_GRIP === undefined || drawn.itemSpan === null
        ? null
        : (() => {
            const { box, span } = drawn.itemSpan;
            return (
              <div
                className="chrome__band chrome__band--grid-span"
                data-door={SPAN_GRIP.ref}
                data-args={JSON.stringify({ property: String((SPAN_GRIP.door.args as Record<string, unknown>).property ?? ''), span, width: Math.round(box.width / drawn.zoom) })}
                data-edit-handle=""
                data-start={Math.round(box.width / drawn.zoom)}
                data-normal="1,0"
                data-min="8"
                data-value-arg="value"
                data-chrome="grid-span-grip"
                style={{ left: box.x + box.width - 7, top: box.y + box.height - 7, width: 'var(--space-6)', height: 'var(--space-6)' }}
              >
                <span className="chrome__handle-value">{span}</span>
              </div>
            );
          })()}
    </div>
  );
}
