// @vitest-environment happy-dom
// The pointer's state is each editor's own (the plan's T7): its views (the band, the hover, the drag…) by its store,
// its pan, open gesture and picker session by its store too. The installer listens to the whole window, so one window
// has one pointer owner: a second editor installed on the same window is refused (and throws in development and tests,
// recording an incident), the first keeps the pointer, and unmounting frees it again; an editor in another window
// installs its own.
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../store.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { clearIncidents, incidents } from '../../core/incidents.ts';
import { installPointer } from './pointer.ts';
import { pointerViews } from './pointer/views.ts';

const store = () => createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() });

describe('installing the pointer owner', () => {
  it('refuses a second editor on the same window while one holds it, and frees it when that one leaves', () => {
    clearIncidents();
    const first = store();
    const second = store();
    const remove = installPointer(first, window);
    // a different editor is refused, loudly, and the feed says why
    expect(() => installPointer(second, window)).toThrow(/one editor per window/);
    expect(incidents().some((one) => one.what.includes('second editor'))).toBe(true);
    // the first leaves (its effect's cleanup, as React runs it): the pointer is free for another editor
    remove();
    const again = installPointer(second, window);
    expect(typeof again).toBe('function');
    again();
  });

  it('gives each editor its own pointer state: two editors in two windows never share a hover or a drag', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const other = frame.contentWindow as Window;
    const first = store();
    const second = store();
    const removeFirst = installPointer(first, window);
    const removeSecond = installPointer(second, other);
    expect(typeof removeSecond).toBe('function');
    expect(pointerViews(first)).not.toBe(pointerViews(second));
    pointerViews(first).setHovered('a node of the first editor');
    expect(pointerViews(first).hover.get()).toBe('a node of the first editor');
    expect(pointerViews(second).hover.get()).toBeNull();
    pointerViews(second).holdAlt(true);
    expect(pointerViews(second).measuring.get()).toBe(true);
    expect(pointerViews(first).measuring.get()).toBe(false);
    removeSecond();
    removeFirst();
    frame.remove();
  });
});
