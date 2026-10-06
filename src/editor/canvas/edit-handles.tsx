// The handles of an Edit on canvas mode (canvas/edit-mode.ts) on the one selected element, drawn by the canvas chrome.
// Each handle is the door of its value (the canvas-handle doors of the mode; what it stands for is canvas/handles.ts's
// handleArgs): it tells the pointer owner what its drag starts from and which way on the screen grows it (data-start,
// data-normal, a unit direction, data-min, data-value-arg), labels its value in CSS px, and takes the focus for its
// arrows (the canvas-handle key context, handle.step: its data-args name it). The pointer owner runs the drag.
//  - Padding and Margin (spec spacing-handles): the four sides as tinted bands (padding inside the border, margin
//    outside it, a negative margin inside; each as thick as its value and never thinner than spacing.minBand screen
//    px); a band also says its opposite side and its start, for Alt, and its click opens its typed field (TypedBand:
//    Enter keeps the text with the band's command, leaving the field closes it).
//  - Radius (spec radius-border-gap-handles, Problems in Pager 1): a corner handle inside the top left corner, moved
//    along the diagonal as the radius grows; dragging it toward the element's centre grows every corner.
//  - Border (Problems in Pager 2): a handle per side, just inside it; dragging it inward thickens that side.
//  - Shadow offset and Shadow blur (spec shadow-handles): one handle below the element's middle, moved by the first
//    layer's X and Y (offset) or blur, so it follows the pointer while it is dragged (Problems in Pager 1), labelled
//    X, Y or the blur; it edits the text shadow of an element that holds one, else its box shadow (canvas/handles.ts
//    shadowOf); an element with no shadow draws none.
//  - Gap, Row gap, Column gap (Problems in Pager 4 and 5): the column gap as a band between each two columns of the
//    children, the row gap between each two rows, read from their real boxes (core/geometry/lines.ts: a grid's
//    columns and rows, a wrapped flex's lines, a row flex's items, a column's or a block's rows), as thick as the gap;
//    a gap the layout does not show (Row gap in a single row) draws none.
//  - The divider (the user's real-use audit, item 8.1): on the boundary between each two columns of a flex row, a grip
//    drawn over the gap band (element.setDivider), dragged to write the two children's share of the row.
//
// The sides are the box composite's longhands in CSS order (properties.json: top, right, bottom, left): a side's
// opposite is two places on, and the side's band lies across the element for the first and the third.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { locate, type NodeId } from '../../core/document/model.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { gapBands, lineExtent, linesOf } from '../../core/geometry/lines.ts';
import { appliesToOf, contextPredicate, elementPredicate } from '../../core/style/applies.ts';
import { mayBeNegative } from '../../core/style/spacing.ts';
import type { CommandId, FeatureId } from '../../generated/ids.ts';
import { manifest, numberConstant, type DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { useEditorState, useStore, MODEL_RULES } from '../store.ts';
import { useSelectionContext } from '../shell/field.tsx';
import { typedBand } from './band-typing.ts';
import { canvasFrame, computedValues, nodeBox } from './coordinates.ts';
import { editMode, handlesOf, type EditMode } from './edit-mode.ts';
import { handleArgs, movesOffset, shadowLength, shadowOf, valueArg } from './handles.ts';
import { lineStyles } from '../../core/style/set.ts';
import { usePointerValue } from '../input/pointer/use-views.ts';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const MIN_BAND = numberConstant('spacing.minBand');
// a band thinner than this keeps its number for the pointer and the focus (the audit's U-036: 4 to 6 px bands spilled
// it)
const VALUE_MIN_BAND = numberConstant('spacing.valueMinBand');
// the room an element wants before a control of the screen may cover it: the same the resize handles ask for
const ROOM = numberConstant('resize.handleRoom');
const DIRECT = numberConstant('handle.directSize');
// which way on the screen grows each side from inside the border (CSS order: down, left, up, right)
const INWARD: readonly (readonly [number, number])[] = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];
const DIAGONAL = Math.SQRT1_2;
// a box composite's longhands, in its CSS order (properties.json)
const COMPOSITES = manifest.properties.composites;
const longhandsOf = (box: string): readonly string[] => COMPOSITES.find((c) => c.id === box)?.longhands ?? [];
// the gap longhands, row first: those of the gap handle that writes both (manifest)
const [ROW_GAP = '', COLUMN_GAP = ''] = manifest.doors.find((d) => d.door.kind === 'canvas-handle' && 'property' in d.command.args && d.door.adapter.writes.length === 2)?.door.adapter.writes ?? [];
// The divider between two children of a row (element.setDivider; the user's real-use audit, item 8.1): the
// canvas-handle door whose command takes the boundary's place among the children, drawn on every boundary of a row's
// columns.
const DIVIDER: DoorEntry | undefined = manifest.doors.find((d) => d.door.kind === 'canvas-handle' && 'index' in d.command.args);
// the grip's width on the screen, and the least a column may measure (interactions.json)
const DIVIDER_GRIP = numberConstant('divider.grip');
const DIVIDER_MIN = numberConstant('divider.minWidth');
// the display and direction the divider's command reads (its own arguments, the manifest's data): a grip stands on a
// flex row alone
const dividerProperty = (name: string): string => (DIVIDER === undefined ? '' : (DIVIDER.command.args[name]?.values[0] ?? ''));
const ROW_DISPLAY = dividerProperty('view');
const ROW_DIRECTION = dividerProperty('axis');
// The bands the canvas draws on any selected element, with no mode (the user's real-use audit, item 4.1): the spacing
// bands (the padding and margin composites of properties.json) and the gap bands (the door that writes both gaps).
// Their modes only pin them: a band that is not pinned is drawn faint and shows itself when the pointer is on it.
const BOX_MODEL_CONTROL = 'box-model';
const BOX_LONGHANDS: ReadonlySet<string> = new Set(COMPOSITES.filter((c) => c.control === BOX_MODEL_CONTROL).flatMap((c) => c.longhands));
const GAP_BAND: string = COMPOSITES.find((c) => c.longhands.length === 2 && c.longhands.every((property, at) => property === [ROW_GAP, COLUMN_GAP][at]))?.id ?? '';
const BAND_LONGHANDS: ReadonlySet<string> = new Set([...BOX_LONGHANDS, ROW_GAP, COLUMN_GAP]);
const ALWAYS_BANDS = manifest.doors.filter((d) => d.door.kind === 'canvas-handle' && d.door.adapter.writes.length > 0 && d.door.adapter.writes.every((property) => BAND_LONGHANDS.has(property)));
const NONE: readonly string[] = [];
const px = (value: string | undefined): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// the values the page computes for these properties of a node, read at every frame while they are drawn
export function useComputed(node: NodeId | null, properties: readonly string[]): Readonly<Record<string, string>> | null {
  const [read, setRead] = useState<{ readonly node: NodeId; readonly values: Readonly<Record<string, string>> | null } | null>(null);
  // the properties by their names: the list is a new array at every render of the caller, and the loop restarted
  // with it, its first frame storing a new object that rendered again (the audit's RL1)
  const key = properties.join('|');
  useEffect(() => {
    const wanted = key === '' ? [] : key.split('|');
    if (node === null || wanted.length === 0) return;
    let request = 0;
    let last = '';
    const measure = () => {
      const values = computedValues(node, wanted, lineStyles(MODEL_RULES));
      const text = JSON.stringify(values);
      if (text !== last) {
        last = text;
        setRead({ node, values });
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [node, key]);
  return read !== null && read.node === node ? read.values : null;
}

// the boxes of a node's children on the chrome (`origin`: the chrome's place on the screen), read at every frame while
// they are drawn, each with the child it is (a divider grip stands for one child's place among its siblings)
function useFlow(node: NodeId | null, children: readonly string[], origin: { readonly x: number; readonly y: number }): { readonly boxes: readonly Box[]; readonly ids: readonly string[] } | null {
  const [read, setRead] = useState<{ readonly text: string; readonly boxes: readonly Box[]; readonly ids: readonly string[] } | null>(null);
  const { x, y } = origin;
  useEffect(() => {
    if (node === null) return;
    let request = 0;
    const measure = () => {
      const frame = canvasFrame();
      if (frame) {
        const pairs = children
          .map((id) => ({ id, box: nodeBox(frame, id) }))
          .filter((drawn): drawn is { readonly id: string; readonly box: Box } => drawn.box !== null)
          .map((drawn) => ({ id: drawn.id, x: drawn.box.x - x, y: drawn.box.y - y, width: drawn.box.width, height: drawn.box.height }));
        const text = JSON.stringify(pairs);
        setRead((before) => (before?.text === text ? before : { text, boxes: pairs, ids: pairs.map((drawn) => drawn.id) }));
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [node, children, x, y]);
  return read;
}

// A band's box on the chrome: side `i` of the element's box, with the four values in screen px.
function bandBox(box: Box, inwardOnly: boolean, i: number, screen: readonly number[]): Box {
  const own = screen[i] ?? 0;
  const thick = Math.max(Math.abs(own), MIN_BAND);
  const inside = inwardOnly || own < 0;
  const first = Math.abs(screen[0] ?? 0);
  const third = Math.abs(screen[2] ?? 0);
  if (i === 0) return { x: box.x, y: inside ? box.y : box.y - thick, width: box.width, height: thick };
  if (i === 2) return { x: box.x, y: inside ? box.y + box.height - thick : box.y + box.height, width: box.width, height: thick };
  const across = inside ? { y: box.y + first, height: Math.max(0, box.height - first - third) } : { y: box.y, height: box.height };
  if (i === 3) return { x: inside ? box.x : box.x - thick, width: thick, ...across };
  return { x: inside ? box.x + box.width - thick : box.x + box.width, width: thick, ...across };
}

interface Drawn {
  readonly entry: DoorEntry;
  readonly box: Box;
  readonly start: number;
  readonly normal: readonly [number, number];
  readonly min: number | null;
  readonly kind: 'band' | 'direct';
  // a band's kind, the composite it holds (padding, margin, gap): its tint and its label
  readonly band?: string;
  // a spacing band's four sides' starts, in the composite's order (top, right, bottom, left): what Shift writes to each
  readonly sides?: readonly number[];
  // a spacing band's opposite side and its start (Alt)
  readonly opposite?: { readonly side: string; readonly start: number };
  // a shadow handle: the property it edits, what it moves and where from, and its label
  readonly shadow?: { readonly property: string; readonly offset: boolean; readonly x: number; readonly y: number; readonly blur: number };
  // what the handle itself stands for besides its command's fixed arguments (a divider: the boundary's place)
  readonly args?: Readonly<Record<string, unknown>>;
}

// `bandKey`: the band's own key, which the arrangement names when the band gives way (`yielded`; arrangement.ts)
function Handle({ drawn, mode, bandKey, yielded }: { readonly drawn: Drawn; readonly mode: EditMode; readonly bandKey: string; readonly yielded: boolean }) {
  const { entry, box, start, normal, min, kind, opposite, shadow, band, sides, args } = drawn;
  const stands = shadow === undefined ? handleArgs(entry) : { property: shadow.property };
  const door = useDoor(entry, stands, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  // a band its mode pins stays shown; any other reveals itself under the pointer, and stays shown with its value while
  // a drag pulls it (the pointer leaves it as soon as it moves)
  const dragged = usePointerValue('bandingNow') === entry.ref;
  const pinned = band === undefined || dragged || handlesOf(mode).some((d) => d.ref === entry.ref);
  const sidesStart = sides === undefined ? undefined : sides.join(',');
  const style: CSSProperties = { left: box.x, top: box.y, width: box.width, height: box.height };
  return (
    <div
      className={`chrome__${kind} ${band === undefined ? `chrome__${kind}--${mode}` : `chrome__band--${band}${pinned ? '' : ' chrome__band--auto'}${Math.min(box.width, box.height) < VALUE_MIN_BAND ? ' chrome__band--thin' : ''}`}${dragged ? ' is-dragging' : ''}${door.available ? '' : ' is-unavailable'}${!pinned && yielded ? ' is-yielded' : ''}`}
      data-door={entry.ref}
      data-arrange-key={band === undefined ? undefined : bandKey}
      data-args={JSON.stringify({ ...stands, ...(args ?? {}), handle: entry.ref })}
      data-edit-handle=""
      data-start={start}
      data-normal={normal.join(',')}
      data-min={min === null ? '' : String(min)}
      data-value-arg={valueArg(entry)}
      data-opposite={opposite?.side}
      data-opposite-start={opposite?.start}
      data-sides-start={sidesStart}
      data-shadow={shadow === undefined ? undefined : shadow.offset ? 'offset' : 'blur'}
      data-start-x={shadow?.x}
      data-start-y={shadow?.y}
      data-chrome="handle"
      data-key-context="canvas-handle"
      tabIndex={door.available ? 0 : -1}
      role="slider"
      aria-valuenow={start}
      aria-label={door.label}
      aria-disabled={door.available ? undefined : true}
      title={door.title}
      style={style}
    >
      <span className="chrome__handle-value">{shadow?.offset === true ? `${shadow.x}, ${shadow.y}` : start}</span>
    </div>
  );
}

// The typed field of a band clicked without a drag: its text kept with the band's command (a bare number is px).
function TypedBand({ entry, box, value }: { readonly entry: DoorEntry; readonly box: Box; readonly value: number }) {
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const stands = handleArgs(entry);
  const door = useDoor(entry, stands);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.current?.value ?? '';
    typedBand.close();
    (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...stands, [valueArg(entry)]: text });
  };
  return (
    <form className="chrome__band-field" style={{ left: box.x, top: box.y }} onSubmit={submit} data-band-field="">
      <input ref={input} className="input" defaultValue={String(value)} aria-label={door.label} spellCheck={false} onBlur={() => typedBand.close()} data-key-context="field" />
    </form>
  );
}

// the properties each mode's handles read: every property their doors write
const READS = new Map<string, readonly string[]>();
const readsOf = (mode: EditMode, doors: readonly DoorEntry[]): readonly string[] => {
  const held = READS.get(mode);
  if (held !== undefined) return held;
  const list = [...new Set(doors.flatMap((d) => d.door.adapter.writes))];
  READS.set(mode, list);
  return list;
};
// a node's children, one list per text of them (a stable value while they are the same)
const IDS = new Map<string, readonly string[]>();
function childrenOf(text: string): readonly string[] {
  const held = IDS.get(text);
  if (held !== undefined) return held;
  const ids = JSON.parse(text) as string[];
  IDS.set(text, ids);
  return ids;
}

export function EditHandles({ node, box, yielded = [] }: { readonly node: NodeId; readonly box: Box; readonly yielded?: readonly string[] }) {
  const frame = canvasFrame();
  // the canvas zoom, which turns CSS px into the chrome's screen px, and the chrome's place on the screen
  const zoom = frame?.currentCSSZoom ?? 1;
  const screen = frame ? nodeBox(frame, node) : null;
  const origin = screen === null ? { x: 0, y: 0 } : { x: Math.round((screen.x - box.x) * 100) / 100, y: Math.round((screen.y - box.y) * 100) / 100 };
  const mode = useEditorState((s) => editMode(s.ui));
  const childrenText = useEditorState((s) => JSON.stringify(locate(s.document, node)?.node.children.map((c) => c.id) ?? []));
  // the spacing and gap bands any selection draws (item 4.1) first, then the mode's handles: a handle drawn over a
  // band takes the press (a radius corner sits inside a padding band's strip, and the point is the corner's)
  const modeDoors = handlesOf(mode);
  const doors = [...ALWAYS_BANDS.filter((d) => !modeDoors.some((m) => m.ref === d.ref)), ...modeDoors];
  // the divider grips (item 8.1) read what decides them too: the display of the element and the direction it lays its
  // children along
  const reads = [...(doors.length > 0 ? readsOf(mode, doors) : NONE), ...(DIVIDER === undefined ? NONE : [ROW_DISPLAY, ROW_DIRECTION])];
  const computed = useComputed(reads.length > 0 ? node : null, reads);
  const gaps = doors.some((d) => 'property' in handleArgs(d));
  const flow = useFlow(gaps || DIVIDER !== undefined ? node : null, childrenOf(childrenText), origin);
  const typing = useSyncExternalStore(typedBand.subscribe, typedBand.get);
  // the element as the document holds it (its shadows' layers)
  const held = useEditorState((s) => locate(s.document, node)?.node ?? null);
  // the layout context: where a band draws only where its property applies (a gap: a flex or grid container, A3.15)
  const context = useSelectionContext();
  if (computed === null || (doors.length === 0 && DIVIDER === undefined)) return null;
  const drawn: Drawn[] = [];
  for (const entry of doors) {
    const writes = entry.door.adapter.writes;
    const first = writes[0] ?? '';
    const stands = handleArgs(entry);
    // a band no mode pins: it waits faint and comes out under the pointer, and it gives way to an element with no room
    const auto = !modeDoors.some((m) => m.ref === entry.ref);
    // a band any selection draws is drawn where its properties apply (A3.15: the gap only in a flex or grid container,
    // the padding and margin on any element with a box)
    if (ALWAYS_BANDS.includes(entry) && held !== null && !writes.every((property) => {
      const predicate = appliesToOf(property, MODEL_RULES);
      return predicate === null || (contextPredicate(predicate, context) !== false && elementPredicate(predicate, held, MODEL_RULES) !== false);
    }))
      continue;
    if ('edit' in entry.command.args) {
      // a shadow handle: below the element's middle, moved by the layer's offset or blur
      const shadow = held === null ? null : shadowOf(entry, held, MODEL_RULES);
      if (shadow === null) continue;
      const offset = movesOffset(entry);
      const [fx = '', fy = ''] = entry.door.adapter.fields;
      const x = shadowLength(shadow.layer[offset ? fx : '']);
      const y = shadowLength(shadow.layer[offset ? fy : '']);
      const blur = shadowLength(shadow.layer[offset ? '' : fx]);
      const cx = box.x + box.width / 2 + (offset ? x : blur) * zoom;
      const cy = box.y + box.height - DIRECT + (offset ? y : 0) * zoom;
      drawn.push({ entry, box: { x: cx - DIRECT / 2, y: cy - DIRECT / 2, width: DIRECT, height: DIRECT }, start: offset ? x : blur, normal: [1, 0], min: offset ? null : 0, kind: 'direct', shadow: { property: shadow.property, offset, x, y, blur } });
    } else if (stands.box !== undefined) {
      // a spacing band
      const sides = longhandsOf(stands.box);
      const values = sides.map((p) => px(computed[p]));
      const i = sides.indexOf(first);
      if (i < 0) continue;
      // an unpinned band waits out an element with no room for it (the room a resize handle wants, plus the band on
      // each side): its bands would cover an element shorter than that, which then could not be pressed to drag it
      if (auto && (i % 2 === 0 ? box.height : box.width) < 2 * MIN_BAND + ROOM) continue;
      const [nx, ny] = INWARD[i] ?? [0, 0];
      const outward = mayBeNegative(stands.box);
      const facing = doors.find((d) => d.door.adapter.writes[0] === sides[(i + 2) % 4]);
      drawn.push({
        entry,
        box: bandBox(box, !outward, i, values.map((v) => v * zoom)),
        start: values[i] ?? 0,
        normal: outward ? [-nx, -ny] : [nx, ny],
        min: outward ? null : 0,
        kind: 'band',
        band: stands.box,
        sides: values,
        opposite: { side: facing === undefined ? '' : (handleArgs(facing).sides ?? ''), start: values[(i + 2) % 4] ?? 0 },
      });
    } else if (stands.corners !== undefined) {
      // the radius corner, along the diagonal
      const r = px(computed[first]);
      const at = Math.max(DIRECT, r * zoom * DIAGONAL + DIRECT / 2);
      drawn.push({ entry, box: { x: box.x + at - DIRECT / 2, y: box.y + at - DIRECT / 2, width: DIRECT, height: DIRECT }, start: r, normal: [DIAGONAL, DIAGONAL], min: 0, kind: 'direct' });
    } else if (stands.sides !== undefined) {
      // a border side, just inside it
      const widths = COMPOSITES.find((c) => c.longhands.includes(first) && c.longhands.length === 4)?.longhands ?? [];
      const i = widths.indexOf(first);
      const w = px(computed[first]);
      const [nx, ny] = INWARD[i] ?? [0, 0];
      const inset = w * zoom + DIRECT / 2;
      const cx = box.x + box.width / 2 - nx * (box.width / 2 - inset);
      const cy = box.y + box.height / 2 - ny * (box.height / 2 - inset);
      drawn.push({ entry, box: { x: cx - DIRECT / 2, y: cy - DIRECT / 2, width: DIRECT, height: DIRECT }, start: w, normal: [nx, ny], min: 0, kind: 'direct' });
    } else if (flow !== null) {
      // the gap bands, from the children's real boxes (Problems in Pager 5): the column gap between each two columns,
      // the row gap between each two rows; Gap draws both
      const laid = flow.boxes.map((b) => ({ box: b }));
      const gaps: readonly ('column' | 'row')[] = writes.length > 1 ? ['column', 'row'] : first === ROW_GAP ? ['row'] : ['column'];
      for (const gap of gaps) {
        const g = px(computed[gap === 'row' ? ROW_GAP : COLUMN_GAP]);
        for (const band of gapBands(laid, box, gap, MIN_BAND)) drawn.push({ entry, box: band, start: g, normal: gap === 'row' ? [0, 1] : [1, 0], min: 0, kind: 'band', band: GAP_BAND });
      }
    }
  }
  // the divider grips (item 8.1): on the boundary between each two columns of a flex row, a grip half a grip wide on
  // each side of the boundary line; its drag writes the two children's share of the row (element.setDivider). The grip
  // is a tab at the top of the line, not a strip down its whole length: the gap band between the same two columns is
  // dragged by its middle (item 4.1), and a grip over it would take every press meant for the gap.
  const children = childrenOf(childrenText);
  const row = computed !== null && (computed[ROW_DISPLAY] ?? '').includes('flex') && (computed[ROW_DIRECTION] ?? 'row').startsWith('row');
  if (DIVIDER !== undefined && flow !== null && row && held !== null && held.children.length >= 2) {
    const items = flow.boxes.map((box, i) => ({ box, id: flow.ids[i] ?? '' }));
    // a flex row lays its children along x: the columns of one line share their vertical extent (lines.ts, axis x)
    for (const line of linesOf(items, 'x')) {
      if (line.length < 2) continue;
      const extent = lineExtent(line, 'x');
      for (let i = 0; i + 1 < line.length; i += 1) {
        const left = line[i] as (typeof line)[number];
        const right = line[i + 1] as (typeof line)[number];
        const index = children.indexOf(left.id);
        if (index < 0) continue;
        const at = (left.box.x + left.box.width + right.box.x) / 2;
        const height = Math.min(DIVIDER_GRIP, Math.max(0, extent.to - extent.from));
        drawn.push({
          entry: DIVIDER,
          box: { x: at - DIVIDER_GRIP / 2, y: extent.from, width: DIVIDER_GRIP, height },
          start: Math.round(left.box.width / zoom),
          normal: [1, 0],
          min: DIVIDER_MIN,
          kind: 'band',
          band: 'divider',
          args: { index },
        });
      }
    }
  }
  const typed = typing === null ? undefined : drawn.find((d) => d.entry.ref === typing.ref && d.opposite !== undefined);
  return (
    <>
      {drawn.map((d, i) => (
        <Handle key={`${d.entry.ref}-${i}`} drawn={d} mode={mode} bandKey={`${d.entry.ref}-${i}`} yielded={yielded.includes(`${d.entry.ref}-${i}`)} />
      ))}
      {typed !== undefined && typing !== null ? <TypedBand key={typing.count} entry={typed.entry} box={typed.box} value={typed.start} /> : null}
    </>
  );
}
