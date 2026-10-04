// @vitest-environment happy-dom
// Family DR1 of the code audit (2026-10-04): a file dropped where nothing takes it is refused, never opened. The drop
// listeners prevented the browser's default only for an image (or over the Explorer's folder zone), so a PDF, a ZIP or
// an HTML file dropped on the canvas or a panel made Chrome open it in place of the editor.
import { describe, expect, it } from 'vitest';
import { installOsFileDrop } from './file-drop.ts';
import type { EditorStore } from '../store.ts';

const filesEvent = (type: 'dragover' | 'drop', mime: string): DragEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  const items = [{ kind: 'file', type: mime }];
  Object.defineProperty(event, 'dataTransfer', { value: { items, files: [], dropEffect: 'move' } });
  return event;
};

describe('a dropped file never navigates the editor (DR1)', () => {
  it('prevents the default of a PDF dragged over and dropped on the editor', () => {
    const stop = installOsFileDrop({ getState: () => ({ document: { pages: [] } }) } as unknown as EditorStore, window, false);
    const over = filesEvent('dragover', 'application/pdf');
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = filesEvent('drop', 'application/pdf');
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    stop();
  });
});
