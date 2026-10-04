// @vitest-environment happy-dom
// Family FD2 of the code audit (2026-10-04, second reading): a panel field kept showing what was typed after the field
// was left without keeping it (its own header says the document's value is shown again then), so the project
// language field read "banana" while the project still had its own language.
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { createEditorStore, StoreContext } from '../store.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import { PanelField } from './panel-field.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('a panel field left without keeping its typing shows the document\'s value (FD2)', () => {
  it('drops the draft when the focus leaves the field', () => {
    const store = createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() });
    const entry = manifest.doors.find((d) => d.command.id === 'project.setLanguage');
    if (entry === undefined) throw new Error('no project language door');
    const host = document.createElement('div');
    document.body.append(host);
    act(() => {
      createRoot(host).render(
        <StoreContext.Provider value={store}>
          <PanelField entry={entry} value="en" label={entry.ref} />
        </StoreContext.Provider>,
      );
    });
    const input = host.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      input.focus();
      setter?.call(input, 'banana');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('banana');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('blur'));
    });
    expect(input.value).toBe('en');
  });
});
