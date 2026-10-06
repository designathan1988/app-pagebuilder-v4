// The measured size of an element, in page pixels (the status bar's readout, the box model's centre): the layout
// port's own box for it, re-measured on every frame while it is selected, and the same at any zoom — the number a
// person compares against the Width and Height fields (spec canvas-page-iframe, the box
// model).
import { useEffect, useState } from 'react';
import type { NodeId } from '../../generated/commands.ts';
import { pageLayout } from '../canvas/coordinates.ts';

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

export function usePrimarySize(id: NodeId | null): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);
  useEffect(() => {
    if (id === null) {
      setSize(null);
      return;
    }
    let frame = requestAnimationFrame(function measure() {
      const box = pageLayout.box(id);
      const next = box === null ? null : { width: Math.round(box.width), height: Math.round(box.height) };
      setSize((was) => (was?.width === next?.width && was?.height === next?.height ? was : next));
      frame = requestAnimationFrame(measure);
    });
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return size;
}

// The size of what is selected, in page pixels: the one element's, or with several the box that holds them all (the
// status bar's readout; the canonical "1248 × 390" for three cards), re-measured on every frame. The ids are given as
// one text (joined by spaces) so the hook's input is stable while the selection is.
export function useSelectionSize(ids: string): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);
  useEffect(() => {
    const list = ids.split(' ').filter((id) => id !== '') as NodeId[];
    if (list.length === 0) {
      setSize(null);
      return;
    }
    let frame = requestAnimationFrame(function measure() {
      const boxes = list.map((id) => pageLayout.box(id)).filter((box) => box !== null);
      const left = Math.min(...boxes.map((box) => box.x));
      const top = Math.min(...boxes.map((box) => box.y));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      const next = boxes.length === 0 ? null : { width: Math.round(right - left), height: Math.round(bottom - top) };
      setSize((was) => (was?.width === next?.width && was?.height === next?.height ? was : next));
      frame = requestAnimationFrame(measure);
    });
    return () => cancelAnimationFrame(frame);
  }, [ids]);
  return size;
}
