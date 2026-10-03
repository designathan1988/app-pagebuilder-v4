// What the canvas draws while a container is composed (spec "Layout Lenses", "Preview", "Structural Handles"): over
// the container, the stage that takes the composer's presses (interaction/tool.ts), the regions of the intent in the
// lens chosen with their labels, the handles of the selection — each the canvas-handle door of its kind — and the
// stroke held now with what its release would do. Measured from the page on every animation frame, like the rest of
// the canvas chrome; drawn in the chrome, never in the page.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { activeBreakpoint, canvasFrame, geometryOf, imageFiles, locate, manifest, nodeBox, objectUrl, useEditorState, useT } from '../../../editor/host.ts';
import type { DocNode, DoorEntry, MessageId, NodeId } from '../../../editor/host.ts';
import type { HandleKind } from '../gestures/recognize.ts';
import { markerOf, recordOf } from '../host/record.ts';
import { composerOf } from '../host/state.ts';
import { preview } from '../interaction/preview.ts';
import { scene, type Words } from './scene.ts';
import './composer.css';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// the doors a press on the stage or on a handle runs (manifest/commands/layout-composer.json)
const STAGE: DoorEntry | undefined = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'layout-stroke');
const HANDLE_DOORS: Readonly<Partial<Record<HandleKind, DoorEntry>>> = Object.fromEntries(
  manifest.doors.flatMap((d) => (d.door.kind === 'canvas-handle' && d.door.gesture === 'layout-handle' ? [[d.door.handle.replace(/^layout-/, ''), d]] : [])),
);
const MOVE: DoorEntry | undefined = HANDLE_DOORS.move;
const REGION_CLICK: DoorEntry | undefined = manifest.doors.find((d) => d.door.kind === 'canvas-click' && d.door.gesture === 'layout-click' && d.door.modifier === null);

// the words of a label: an enumerated value (a sizing, a semantic, a flow) in the person's language
const WORDS = new Set(['sizing', 'semantic', 'flow']);
function useWords(): (words: Words) => string {
  const t = useT();
  return (words) => t(words.key as MessageId, Object.fromEntries(Object.entries(words.params).map(([name, value]) => [name, WORDS.has(name) && typeof value === 'string' && !value.endsWith('px') ? t(`layout.word.${value}` as MessageId) : value])));
}

// the spatial lens's label, which says a region's size: narrower than the drawing, the size the page gives it there
const SIZE_LABEL = 'layout.label.size';

// a region where the page lays it out: its box in the layer's px, and its size in the page's px
interface Measured extends Box {
  readonly page: { readonly width: number; readonly height: number };
}

const same = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// Every element of the container the composer wrote or placed, by the region (or group) key its marker names.
function markedElements(container: DocNode): readonly (readonly [string, NodeId])[] {
  const found: [string, NodeId][] = [];
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker === null) continue;
      found.push([marker.key, child.id]);
      if (marker.kind === 'structural') visit(child);
    }
  };
  visit(container);
  return found;
}

export function LayoutOverlay() {
  const composer = useEditorState((s) => composerOf(s.ui));
  const container = useEditorState((s) => (composer === null ? null : (locate(s.document, composer.target)?.node ?? null)));
  const record = container === null ? null : recordOf(container);
  const layer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  // at a screen size narrower than the drawing, the regions as the page lays them out there, by region id (layer px)
  const base = useEditorState((s) => activeBreakpoint(s).base);
  const [measured, setMeasured] = useState<Readonly<Record<string, Measured>> | null>(null);
  const elements = useMemo(() => (container === null ? [] : markedElements(container)), [container]);
  const held = useSyncExternalStore(preview.subscribe, preview.get);
  const referencePath = record?.intent.reference?.file ?? null;
  const referenceFile = useEditorState((s) => (referencePath === null ? null : (imageFiles(s.document).find((f) => f.path === referencePath) ?? null)));
  const say = useWords();
  const t = useT();
  useEffect(() => {
    if (composer === null) return;
    let request = 0;
    const measure = () => {
      const frame = canvasFrame();
      const origin = layer.current?.parentElement?.getBoundingClientRect();
      const found = frame === null || origin === undefined ? null : nodeBox(frame, composer.target as NodeId);
      const next = found === null || origin === undefined ? null : { x: found.x - origin.x, y: found.y - origin.y, width: found.width, height: found.height };
      setBox((before) => (before !== null && next !== null && same(before, next) ? before : next));
      const boxes: Record<string, Measured> = {};
      const zoom = frame === null ? 1 : (geometryOf(frame)?.zoom ?? 1);
      if (!base && frame !== null && origin !== undefined && next !== null)
        for (const [key, id] of elements) {
          const b = nodeBox(frame, id);
          if (b !== null && b.width > 0 && b.height > 0) boxes[key] = { x: b.x - origin.x - next.x, y: b.y - origin.y - next.y, width: b.width, height: b.height, page: { width: Math.round(b.width / zoom), height: Math.round(b.height / zoom) } };
        }
      setMeasured((before) => (base ? null : before !== null && Object.keys(before).length === Object.keys(boxes).length && Object.entries(boxes).every(([k, b]) => before[k] !== undefined && same(
        before[k] as Box,
        b
      ) && before[k]?.page.width === b.page.width) ? before : boxes));
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [composer, base, elements]);
  // entering the composer puts the keyboard on its stage: its keys (Escape leaves, Delete deletes the selected regions)
  // work at once, whatever control opened it
  const stage = useRef<HTMLDivElement>(null);
  const placed = box !== null;
  const composing = composer?.target ?? null;
  useEffect(() => {
    if (composing !== null && placed) stage.current?.focus({ preventScroll: true });
  }, [composing, placed]);
  const drawn = useMemo(() => (record === null || composer === null ? null : scene(held?.reading?.result?.ok === true ? held.reading.result.graph : record.intent, composer.selection, composer.lens)), [record, composer, held]);
  if (composer === null || record === null || box === null || drawn === null || STAGE === undefined) return <div ref={layer} className="layout-composer" hidden />;
  // at the base screen size the intent is drawn to the container's scale; narrower, each region where the page has it
  const scale = box.width / drawn.viewport.width;
  const at = (b: Box): CSSProperties => ({ left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale });
  const placedAt = (id: string, b: Box): CSSProperties | null => {
    if (measured === null) return at(b);
    const m = measured[id];
    return m === undefined ? null : { left: m.x, top: m.y, width: m.width, height: m.height };
  };
  const reading = held?.reading ?? null;
  const refused = reading !== null && (reading.problems.length > 0 || reading.result?.ok === false);
  const problem = reading === null ? null : (reading.problems[0] ?? (reading.result?.ok === false ? reading.result.problems[0] : undefined) ?? null);
  return (
    <div ref={layer} className="layout-composer" data-region="layout-composer-canvas">
      <div
        className={`layout-composer__stage${refused ? ' is-refused' : ''}`}
        ref={stage}
        tabIndex={-1}
        data-key-context="layout-composer"
        aria-label={t('layout.door.stage')}
        data-layout-stage=""
        data-door={STAGE.ref}
        data-viewport-width={drawn.viewport.width}
        data-viewport-height={drawn.viewport.height}
        data-cursor={reading?.cursor ?? 'crosshair'}
        data-measured={measured === null ? undefined : ''}
        style={{ left: box.x, top: box.y, width: box.width, height: measured === null ? drawn.viewport.height * scale : box.height }}
      >
        {referenceFile === null || drawn.reference == null || measured !== null ? null : (
          <img className="layout-composer__reference" src={objectUrl(referenceFile)} alt="" data-layout-reference={drawn.reference.file} style={{ ...at(drawn.reference.box), opacity: drawn.reference.opacity }} />
        )}
        {drawn.regions.map((region) => {
          const place = placedAt(region.id, region.box);
          return place === null ? null : (
          <div
            key={region.id}
            className={['layout-composer__region', region.selected ? 'is-selected' : '', region.content ? 'is-content' : '', region.hidden ? 'is-hidden' : '', reading?.visited.includes(region.id) === true ? 'is-visited' : ''].filter((c) => c !== '').join(' ')}
            data-layout-region={region.id}
            data-door={REGION_CLICK?.ref}
            data-depth={region.depth}
            style={{ ...place, borderRadius: region.radius * scale, ...(region.polygon === null ? {} : { clipPath: `polygon(${region.polygon.map((p) => `${(p.x - region.box.x) * scale}px ${(p.y - region.box.y) * scale}px`).join(', ')})` }) }}
          >
            {/* a selected region's label is its handle: dragged, it moves the region (at the drawing's width); an
                unselected one's lets a drag begin there and draw, as anywhere in the region */}
            <span className="layout-composer__label" data-layout-handle={measured === null && region.selected && MOVE !== undefined ? `move:${region.id}` : undefined} data-door={measured === null && region.selected ? MOVE?.ref : undefined}>
              {measured?.[region.id] === undefined || region.label.key !== SIZE_LABEL ? say(region.label) : say({ key: SIZE_LABEL, params: { ...region.label.params, ...measured[region.id]?.page } })}
            </span>
          </div>
          );
        })}
        {reading?.area == null ? null : <div className="layout-composer__area" data-layout-preview="area" style={at(reading.area)}><span className="layout-composer__measure">{t('layout.preview.size', { width: Math.round(reading.area.width), height: Math.round(reading.area.height) })}</span></div>}
        {held === null || held.points.length < 2 ? null : (
          <svg className="layout-composer__stroke" width={box.width} height={box.height} aria-hidden="true">
            {/* no trail of the pointer: what the stroke does is drawn instead (the area, the cut, the guides) */}
            {reading?.cuts.map((piece, i) => <line key={i} className="layout-composer__cut" x1={piece.from.x * scale} y1={piece.from.y * scale} x2={piece.to.x * scale} y2={piece.to.y * scale} />)}
            {/* the lines the stroke snapped to, across the whole container, before the release fixes them */}
            {reading?.guides.map((guide, i) =>
              guide.axis === 'x' ? (
                <line key={`g${String(i)}`} className="layout-composer__guide" data-layout-guide="x" x1={guide.at * scale} y1={0} x2={guide.at * scale} y2={drawn.viewport.height * scale} />
              ) : (
                <line key={`g${String(i)}`} className="layout-composer__guide" data-layout-guide="y" x1={0} y1={guide.at * scale} x2={box.width} y2={guide.at * scale} />
              ),
            )}
          </svg>
        )}
        {drawn.relations.map((relation, i) => (
          <svg key={`r${String(i)}`} className="layout-composer__relation" width={box.width} height={box.height} aria-hidden="true">
            <line x1={relation.from.x * scale} y1={relation.from.y * scale} x2={relation.to.x * scale} y2={relation.to.y * scale} />
          </svg>
        ))}
        {held !== null || measured !== null
          ? null
          : drawn.handles.map((handle) => {
              const door = HANDLE_DOORS[handle.kind];
              if (door === undefined) return null;
              return (
                <span
                  key={handle.id}
                  className={`layout-composer__handle layout-composer__handle--${handle.kind}${handle.axis === null ? '' : ` is-${handle.axis}`}`}
                  data-layout-handle={handle.id}
                  data-door={door.ref}
                  title={t(door.door.labelKey as MessageId)}
                  style={{ left: handle.point.x * scale, top: handle.point.y * scale }}
                >
                  {/* a gap shows its spacing, dragged to change it; a repeat end shows it adds items */}
                  {handle.kind === 'gap' ? handle.value : handle.kind === 'repeat' ? '+' : null}
                </span>
              );
            })}
      </div>
      {problem === null || problem === undefined ? null : (
        <div className="layout-composer__problem" style={{ left: box.x, top: box.y + drawn.viewport.height * scale }}>
          {t(`layout.problem.${problem.code}` as MessageId, problem.params)}
        </div>
      )}
    </div>
  );
}
