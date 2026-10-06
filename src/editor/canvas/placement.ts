// Where the chrome may draw: the label rules and a resize handle's hit area (split out of canvas/chrome.tsx, which
// keeps the drawing). Pure: boxes in, boxes out — the caller supplies the page's content boxes, the visible canvas and
// the box being labelled, so the rules can be read (and tested) on their own.
//
// The selection's label has one place (the user's rule of 2026-10-05, DEC-70; selectionLabelBox): above its element,
// its bottom on the top edge of the selection's frame and its start on the frame's left edge — never inside, below,
// beside or moved aside for what lies there, at any size, zoom, scroll, rotation or breakpoint, for one element or
// several. Where it lies over page text it says so (`covers`), and the selection's label then takes no press, so a
// press meant for the text under it reaches the text (jornada03 J16: a label over a card's price selected the button
// instead).
//
// A drop label (placeLabel) never covers page content, nor a control the chrome draws (a
// resize handle or an edit band under it would lose the press to the label): it sits above its element when that space
// is free, otherwise inside the element's top-left corner when that corner is free, otherwise below the element; with a
// ghost chip at the pointer (a drag) it keeps clear of the chip too. Where no place is free it covers the least it can
// and says so.
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type Placement = 'above' | 'inside' | 'below';

// whether two boxes share any area
// less than this is no overlap for a label's place (a layout's fractional pixels)
const SLACK = 1;
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const within = (a: Box, area: Box) => a.x >= area.x && a.y >= area.y && a.x + a.width <= area.x + area.width && a.y + a.height <= area.y + area.height;

// The hit area of one resize handle in the chrome layer's pixels: a `size` square beside the element's edge or
// corner, wholly outside it, as the stylesheet draws it — slid toward the element where a neighbour's box would be
// covered (the canvas audit, 2026-09-28: the south handle of a selected card sat wholly over the 23 px card below it,
// so a press meant to drag that card resized instead). The room the neighbour leaves outside is all the handle keeps;
// the rest moves inside the element, so the box never covers a neighbouring element, and the drawn dot keeps to the
// element's edge wherever the box went: `at` is the edge point within the box as the fractions the dot is drawn at
// (--handle-x/--handle-y). With no neighbour at the edge the box is exactly where the stylesheet draws it.
export function handleHitBox(side: string, element: Box, size: number, neighbours: readonly Box[]): { readonly box: Box; readonly at: { readonly x: number; readonly y: number } } {
  const west = side.includes('w');
  const east = side.includes('e');
  const north = side.includes('n');
  const south = side.includes('s');
  const edgeX = west ? element.x : east ? element.x + element.width : element.x + element.width / 2;
  const edgeY = north ? element.y : south ? element.y + element.height : element.y + element.height / 2;
  // the box as the stylesheet draws it: wholly outside, centred on the edge point along the other axis
  let x = west ? edgeX - size : east ? edgeX : edgeX - size / 2;
  let y = north ? edgeY - size : south ? edgeY : edgeY - size / 2;
  // The far edge of the box on one axis, read from the neighbour's own near edge: where none is in the way it is the
  // whole drawn box (the element's edge, the size); a neighbour beyond the edge sets it to its near edge; and one drawn
  // over the edge leaves no room outside, the box keeping to the element's own edge (the audit of 2026-09-28). A
  // neighbour that begins where the element ends (within a hair: the layout reports one boundary twice, a fractional
  // zoom apart) keeps the box a layout unit short of it, so no rounding of the browser's can report the box inside it —
  // the boundary the two share is a place a press meant for either must reach.
  const NEAR = 0.5;
  const CLEAR = 1 / 64;
  const farEdge = (axis: 'x' | 'y', drawn: Box, edge: number, direction: number): number => {
    let far = edge + direction * size;
    for (const n of neighbours) {
      const crosses = axis === 'x' ? drawn.y < n.y + n.height && n.y < drawn.y + drawn.height : drawn.x < n.x + n.width && n.x < drawn.x + drawn.width;
      if (!crosses) continue;
      const lo = axis === 'x' ? n.x : n.y;
      const hi = lo + (axis === 'x' ? n.width : n.height);
      if (direction > 0) {
        if (hi <= edge) continue;
        far = Math.min(far, Math.abs(lo - edge) <= NEAR ? lo - CLEAR : Math.max(lo, edge));
      } else {
        if (lo >= edge) continue;
        far = Math.max(far, Math.abs(hi - edge) <= NEAR ? hi + CLEAR : Math.min(hi, edge));
      }
    }
    return far;
  };
  if (west || east) {
    const far = farEdge('x', { x, y, width: size, height: size }, edgeX, east ? 1 : -1);
    x = east ? far - size : far;
  }
  if (north || south) {
    const far = farEdge('y', { x, y, width: size, height: size }, edgeY, south ? 1 : -1);
    y = south ? far - size : far;
  }
  // the dot is drawn at the edge point as a fraction of the box, kept inside the box: the clearance the box keeps from
  // a neighbour at the same boundary leaves the fraction a hair past its end, where the dot would stand outside it
  const fraction = (value: number): number => Math.min(1, Math.max(0, value));
  return { box: { x, y, width: size, height: size }, at: { x: fraction((edgeX - x) / size), y: fraction((edgeY - y) / size) } };
}

// What the person can see of the canvas, in the chrome layer's own pixels: the overlay covers the whole page, which at
// some zooms (a page wider than the canvas viewport) reaches under the panels; a label held inside the overlay could
// still be drawn where nobody sees it (the user's real-use audit). The stage's box, mapped into the layer.
export function visibleCanvas(origin: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }): Box {
  const stage = document.querySelector('[data-canvas-stage]')?.getBoundingClientRect();
  if (!stage) return { x: 0, y: 0, width: origin.right - origin.left, height: origin.bottom - origin.top };
  const left = Math.max(origin.left, stage.left);
  const top = Math.max(origin.top, stage.top);
  const right = Math.min(origin.right, stage.right);
  const bottom = Math.min(origin.bottom, stage.bottom);
  return { x: left - origin.left, y: top - origin.top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// The chrome's own controls drawn over the page (the resize handles, the bands and radius corners an Edit on canvas
// mode pins, the north-east rotation zone), in the chrome layer's pixels: what a label must never cover either, or the
// press a person aims at the control lands on the label, which stands for the element and starts a move (the label
// rule; A3.16). The bands no mode pins wait faint along every edge of any selection (item 4.1) and the other rotation
// zones draw nothing; were they obstacles, no place touching the element would ever be free and every label would
// stand a band and a zone away from it (the user's review of 2026-10-05, LR2: 22 px off every element).
export function controlBoxes(layer: HTMLElement, origin: { readonly x: number; readonly y: number }): Box[] {
  return [...layer.querySelectorAll('[data-edit-handle]:not(.chrome__band--auto), [data-resize-handle]:not([data-chrome="edge"]), [data-rotate-zone="ne"]')].map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
  });
}

// The selection's label's one place (DEC-70): above the frame, touching it, at its left edge. `frame` is the element's
// box (or the union of several), `edge` the width of the frame's line drawn outside that box (the selection's outline),
// so the label touches the line, not the box under it. `covers` says whether it lies over page content.
export function selectionLabelBox(frame: Box, size: { readonly width: number; readonly height: number }, edge: number, content: readonly Box[]): { box: Box; placement: Placement; covers: boolean } {
  const box = { x: frame.x - edge, y: frame.y - edge - size.height, ...size };
  const inner = { x: box.x + SLACK, y: box.y + SLACK, width: box.width - 2 * SLACK, height: box.height - 2 * SLACK };
  return { box, placement: 'above', covers: content.some((c) => overlaps(inner, c)) };
}

// The box the selection's label stands on for an element turned by `degrees` about its centre (its frame drawn turned
// with it): the frame's line turned, its upright bounding box, given back as the box whose line of width `edge` drawn
// outside it would be that bounding box — so the label touches the turned frame's highest point and starts at its
// leftmost one (DEC-70).
export function turnedFrame(box: Box, degrees: number, edge: number): Box {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width + 2 * edge;
  const height = box.height + 2 * edge;
  const across = width * cos + height * sin;
  const down = width * sin + height * cos;
  const x = box.x + box.width / 2 - across / 2;
  const y = box.y + box.height / 2 - down / 2;
  return { x: x + edge, y: y + edge, width: across - 2 * edge, height: down - 2 * edge };
}

// A label's box held inside an area: moved the least distance that puts it inside, its size kept.
function heldInside(box: Box, area: Box): Box {
  return {
    x: Math.min(Math.max(box.x, area.x), Math.max(area.x, area.x + area.width - box.width)),
    y: Math.min(Math.max(box.y, area.y), Math.max(area.y, area.y + area.height - box.height)),
    width: box.width,
    height: box.height,
  };
}

// A drop label also keeps clear of the drag's ghost chip (`ghost`, the user's real-use audit, item 3.1): a place it
// would cover is not free, and with none free the label moves beside the chip, on the side with room. The rule's
// invariant is that no label covers page content; the line of a drop spans the
// receiver, so the three places are tried at its start and then at its far end (a line between two lines of text: the
// text sits at the left, and the far end is empty), and where even those are not free the place covering the least
// content wins — never the largest overlap just because it is the documented order.
export function placeLabel(box: Box, size: { readonly width: number; readonly height: number }, gap: number, content: readonly Box[], canvas: Box, ghost: Box | null = null): { box: Box; placement: Placement; covers: boolean } {
  const far = box.x + box.width - size.width;
  // 'inside' needs the label to fit within the element it names: a label taller than the element spills past its
  // bottom edge and reads as a label of whatever lies there (a paragraph one line tall), so the corner is offered only
  // where the label fits it
  const fitsInside = size.height <= box.height && size.width <= box.width;
  const around = (out: number): { box: Box; placement: Placement }[] => [
    { placement: 'above', box: { x: box.x, y: box.y - out - size.height, ...size } },
    ...(fitsInside ? [{ placement: 'inside' as const, box: { x: box.x + out, y: box.y + out, ...size } }] : []),
    { placement: 'below', box: { x: box.x, y: box.y + box.height + out, ...size } },
    { placement: 'above', box: { x: far, y: box.y - out - size.height, ...size } },
    { placement: 'below', box: { x: far, y: box.y + box.height + out, ...size } },
    ...(fitsInside ? [{ placement: 'inside' as const, box: { x: far - out, y: box.y + out, ...size } }] : []),
  ];
  const places = around(gap);
  const clear = (p: { box: Box }) => ghost === null || !overlaps(p.box, ghost);
  // how much of the label's area covers page content, in square pixels
  const covered = (b: Box) =>
    content.reduce((sum, c) => {
      const width = Math.min(b.x + b.width, c.x + c.width) - Math.max(b.x, c.x);
      const height = Math.min(b.y + b.height, c.y + c.height) - Math.max(b.y, c.y);
      return width > 0 && height > 0 ? sum + width * height : sum;
    }, 0);
  const candidates = places.map((p) => (within(p.box, canvas) ? p : { ...p, box: heldInside(p.box, canvas) }));
  // a place is free of what it meets by less than a pixel: the boxes are read from a layout of fractional pixels, and a
  // label ending at its element's edge met the corner handle beside that edge by its rounding (LR2)
  const meets = (a: Box, b: Box) => overlaps({ x: a.x + SLACK, y: a.y + SLACK, width: a.width - 2 * SLACK, height: a.height - 2 * SLACK }, b);
  const free = candidates.find((p) => !content.some((c) => meets(p.box, c)) && clear(p));
  const fallback = places.find((p) => p.placement === 'below') as { box: Box; placement: Placement };
  const best = candidates.reduce((held, p) => (covered(p.box) < covered(held.box) ? p : held), { ...fallback, box: heldInside(fallback.box, canvas) });
  const chosen = { ...(free ?? best), covers: free === undefined };
  if (ghost === null || clear(chosen)) return chosen;
  // beside the chip: to its left, to its right, above it or below it, the first on the canvas
  const beside = [
    { ...chosen.box, x: ghost.x - gap - size.width },
    { ...chosen.box, x: ghost.x + ghost.width + gap },
    { ...chosen.box, y: ghost.y - gap - size.height },
    { ...chosen.box, y: ghost.y + ghost.height + gap },
  ];
  return { placement: chosen.placement, covers: chosen.covers, box: beside.find((b) => within(b, canvas)) ?? heldInside(beside[0] as Box, canvas) };
}
