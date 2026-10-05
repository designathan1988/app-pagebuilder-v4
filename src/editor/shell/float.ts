// Where a floating layer is drawn (the audit's S-002 and U-009: popups that ran off the window or over the panel's
// edge): under its anchor, from the anchor's start edge — or ending at its end edge when that would leave the window —
// above it when there is no room below, and always inside the window with `edge` pixels between it and the window's
// sides. One answer for every layer that floats next to something: a menu under its button, a popover under its
// trigger, the link prompt under the text toolbar, the context menu at the pointer (an anchor with no size).
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

// where a layer goes, and the height it is held to when it is taller than the window allows (it scrolls then)
export interface Placed {
  readonly left: number;
  readonly top: number;
  readonly maxHeight?: number;
}

export function floatBelow(anchor: Box, size: Size, view: Size, edge: number, gap = 0): Placed {
  const fromStart = anchor.left + size.width + edge <= view.width;
  const left = fromStart ? anchor.left : anchor.right - size.width;
  const inside = Math.max(edge, Math.min(left, view.width - size.width - edge));
  // taller than the window: on the side with more room, as tall as that room, scrolled (VS Code's menus hold their
  // height to the window under their top; the user's review of 2026-10-05: the View menu ran past a 720 px window)
  if (size.height > view.height - 2 * edge) {
    const under = view.height - edge - (anchor.bottom + gap);
    const over = anchor.top - gap - edge;
    return under >= over ? { left: inside, top: anchor.bottom + gap, maxHeight: under } : { left: inside, top: edge, maxHeight: over };
  }
  const below = anchor.bottom + gap + size.height + edge <= view.height;
  const top = below ? anchor.bottom + gap : anchor.top - gap - size.height;
  return {
    left: Math.max(edge, Math.min(left, view.width - size.width - edge)),
    top: Math.max(edge, Math.min(top, view.height - size.height - edge)),
  };
}

// Where a submenu goes: beside its item, its first item level with it (`inset`, the menu's padding, above the item's
// top), on the item's other side when the window ends first, risen to stay inside the window, and held to the window's
// height when it is taller. Fixed to the window, so the menu it opens from may scroll without cutting it (CSS 2.2
// §11.1.1: a box's overflow clips no descendant whose containing block is the viewport).
export function floatBeside(item: Box, size: Size, view: Size, edge: number, inset = 0): Placed {
  const left = item.right + size.width + edge <= view.width ? item.right : Math.max(edge, item.left - size.width);
  if (size.height > view.height - 2 * edge) return { left, top: edge, maxHeight: view.height - 2 * edge };
  return { left, top: Math.max(edge, Math.min(item.top - inset, view.height - size.height - edge)) };
}

// the point a layer opens at (the context menu at the pointer), as an anchor of no size
export const pointAnchor = (x: number, y: number): Box => ({ left: x, top: y, right: x, bottom: y });
