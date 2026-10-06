// The least travel along one axis that brings a box [from, to] inside a view [low, high], its edge `inset` inside the
// view's (canvas/reveal-selection.tsx): 0 while any part of it is already inside; a box above or left of the view
// comes in at the view's start, one below or right of it at the view's end — or at the view's start when it is taller
// than the view holds, so its start (a heading, a label) is what shows.
export function travelInto(from: number, to: number, low: number, high: number, inset: number): number {
  if (to > low && from < high) return 0;
  if (to <= low) return low + inset - from;
  return to - from > high - low - 2 * inset ? low + inset - from : high - inset - to;
}
