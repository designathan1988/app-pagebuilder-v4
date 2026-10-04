// Which way a wheel notch over a focused number field steps it (field.tsx useWheelSteps): up for a notch away from the
// person, down towards them, null for none. Chrome turns a Shift+wheel into a horizontal scroll (deltaX set, deltaY 0:
// Chromium's mouse wheel event translation), so with Shift held the horizontal delta stands for the notch (the audit's
// WH1); a horizontal scroll without Shift (a trackpad's sideways swipe) steps nothing.
export function wheelStep(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'shiftKey'>): 'up' | 'down' | null {
  const delta = event.deltaY !== 0 ? event.deltaY : event.shiftKey ? event.deltaX : 0;
  return delta === 0 ? null : delta < 0 ? 'up' : 'down';
}
