// @vitest-environment happy-dom
// The drawing rule the census points at (tests/e2e/census.spec.ts): a door is drawn disabled, saying "not available
// yet", while the command behind it is not built or the feature that brings it is not registered — so no control looks
// usable without something working behind it. The rule lives in one place (door.tsx's `built`, from isDoorBuilt) and
// is proven here instead of by walking every screen state.
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { createEditorStore, StoreContext } from '../store.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { DoorControl, isDoorBuilt } from './door.tsx';

// React wants to be told this is an act environment before anything is rendered in it
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function drawnState(entry: DoorEntry): { disabled: boolean; title: string } {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => {
    createRoot(host).render(
      <StoreContext.Provider value={createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() })}>
        <DoorControl entry={entry} />
      </StoreContext.Provider>,
    );
  });
  const control = host.querySelector<HTMLElement>('button, input, [aria-disabled]');
  if (control === null) throw new Error(`the door ${entry.ref} drew no control`);
  return { disabled: control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true', title: control.getAttribute('title') ?? '' };
}

describe('how a door is drawn', () => {
  it('draws a door of a built command of a built feature as a control a person can press', () => {
    const built = manifest.doors.find((entry) => isDoorBuilt(entry));
    expect(built, 'no door of a built feature: nothing to prove the drawing with').toBeDefined();
    const state = drawnState(built as DoorEntry);
    expect(state.title).not.toContain('not available yet');
  });

  it('draws a door whose feature is not registered as disabled, saying not available yet', () => {
    // Every feature of the manifest is registered today (hover-measure was the last, QA 167): the rule is exercised on
    // an entry that names a feature no table registers, which is exactly what a door of a feature still to come will
    // be.
    const real = manifest.doors.find((entry) => isDoorBuilt(entry)) as DoorEntry;
    const toCome = 'a-feature-still-to-come' as FeatureId;
    expect(isFeatureBuilt(toCome)).toBe(false);
    const awaited: DoorEntry = { ...real, door: { ...real.door, feature: toCome } };
    expect(isDoorBuilt(awaited)).toBe(false);
    const state = drawnState(awaited);
    expect(state.disabled).toBe(true);
    expect(state.title).toContain('not available yet');
  });
});
