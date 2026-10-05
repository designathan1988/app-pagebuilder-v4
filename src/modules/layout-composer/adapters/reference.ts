// Tracing a reference image (the plan's bet F, spec "Imagem de referência por baixo para decalcar"): an image the
// person lays under the composition — a wireframe, a screenshot, a sketch — read for its structure. The editor hands
// the image's pixels as luminance; the lines where the image changes most along a whole row or column of a part are
// the edges of its blocks, found by recursive XY-cut (the classic method of page layout analysis): the strongest line
// across the part splits it, and each side is read again. The found blocks become regions in one operation, and every
// found line is a snap line while the person traces by hand.
import type { Box, LayoutIntent, Point } from '../intent/model.ts';
import { region } from '../intent/model.ts';
import { nextRegionId } from '../intent/ids.ts';
import { refuse } from '../intent/problems.ts';
import type { Naming, Operation } from '../gestures/operations.ts';

export interface Luminance {
  readonly width: number;
  readonly height: number;
  // one value from 0 to 1 per pixel, row after row
  readonly values: ArrayLike<number>;
}

export interface TraceOptions {
  // the smallest block, in image pixels
  readonly minimum: number;
  // how many times a part is split at most
  readonly depth: number;
  // how much stronger than the part's average change a line must be to count as an edge
  readonly contrast: number;
}

const TRACE_DEFAULTS: TraceOptions = { minimum: 24, depth: 5, contrast: 3 };

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// How much the image changes across each column boundary (axis x) or row boundary (axis y) of a part, averaged over
// the part's length: a block's edge changes along its whole side.
function profile(image: Luminance, cell: Cell, axis: 'x' | 'y'): number[] {
  const at = (x: number, y: number) => image.values[y * image.width + x] ?? 0;
  const count = axis === 'x' ? cell.width - 1 : cell.height - 1;
  const span = axis === 'x' ? cell.height : cell.width;
  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    for (let j = 0; j < span; j += 1) sum += axis === 'x' ? Math.abs(at(cell.x + i + 1, cell.y + j) - at(cell.x + i, cell.y + j)) : Math.abs(at(cell.x + j, cell.y + i + 1) - at(cell.x + j, cell.y + i));
    result.push(sum / Math.max(1, span));
  }
  return result;
}

// The strongest edge across a part that leaves both sides at least the minimum, or null when none stands out.
function strongest(image: Luminance, cell: Cell, options: TraceOptions): { axis: 'x' | 'y'; at: number } | null {
  let best: { axis: 'x' | 'y'; at: number; strength: number } | null = null;
  for (const axis of ['x', 'y'] as const) {
    const values = profile(image, cell, axis);
    if (values.length === 0) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    const extent = axis === 'x' ? cell.width : cell.height;
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i] as number;
      const at = i + 1;
      const room = at >= options.minimum && extent - at >= options.minimum;
      const stands = v > mean + options.contrast * deviation && v > 0.02;
      if (room && stands && (best === null || v > best.strength)) best = { axis, at, strength: v };
    }
  }
  return best === null ? null : { axis: best.axis, at: best.at };
}

// The blocks of the image, in image pixels.
export function traceBlocks(image: Luminance, options: TraceOptions = TRACE_DEFAULTS): Cell[] {
  if (image.width <= 0 || image.height <= 0 || image.values.length < image.width * image.height) refuse('reference');
  const split = (cell: Cell, depth: number): Cell[] => {
    const edge = depth >= options.depth ? null : strongest(image, cell, options);
    if (edge === null) return [cell];
    const [a, b]: [Cell, Cell] = edge.axis === 'x' ? [{ ...cell, width: edge.at }, { ...cell, x: cell.x + edge.at, width: cell.width - edge.at }] : [{ ...cell, height: edge.at }, { ...cell, y: cell.y + edge.at, height: cell.height - edge.at }];
    return [...split(a, depth + 1), ...split(b, depth + 1)];
  };
  return split({ x: 0, y: 0, width: image.width, height: image.height }, 0);
}

// The edges of the traced blocks, as lines in the composition's coordinates, for snapping while tracing by hand.
export function traceLines(blocks: readonly Cell[], image: Luminance, box: Box): { readonly x: readonly number[]; readonly y: readonly number[] } {
  const sx = box.width / image.width;
  const sy = box.height / image.height;
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const b of blocks) {
    xs.add(box.x + b.x * sx);
    xs.add(box.x + (b.x + b.width) * sx);
    ys.add(box.y + b.y * sy);
    ys.add(box.y + (b.y + b.height) * sy);
  }
  return { x: [...xs].sort((a, b) => a - b), y: [...ys].sort((a, b) => a - b) };
}

// The operation that draws the traced blocks as regions over the reference's box (the top level of the composition).
export function traceRegions(graph: LayoutIntent, blocks: readonly Cell[], image: Luminance, box: Box, naming: Naming): Operation {
  if (blocks.length === 0) refuse('reference');
  const sx = box.width / image.width;
  const sy = box.height / image.height;
  let working = graph;
  const operations: Operation[] = blocks.map((b) => {
    const id = nextRegionId(working);
    const at: Point = { x: box.x + b.x * sx, y: box.y + b.y * sy };
    const made = { ...region(id, { ...at, width: b.width * sx, height: b.height * sy }, naming.named(null, Number(id.slice(1)))), provenance: ['reference'] };
    working = { ...working, regions: [...working.regions, made] };
    return { kind: 'draw', region: made };
  });
  return { kind: 'compose', operations };
}
