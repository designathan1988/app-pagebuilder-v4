// @vitest-environment happy-dom
// Family RL1 of the code audit (2026-10-04, second reading): the edit handles read the page's computed values at every
// frame, and the hook restarted its measuring loop at every render because the list of properties it was given was a
// new array each time; the loop's first frame then stored a new object, which rendered again: with anything selected,
// the handles rendered at every frame, an idle editor busy for nothing.
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { NodeId } from '../../generated/commands.ts';
import { useComputed } from './edit-handles.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the computed values are read without a render loop (RL1)', () => {
  it('renders a bounded number of times while nothing changes', async () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      useComputed('n' as NodeId, ['color']);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    act(() => {
      createRoot(host).render(<Probe />);
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 300));
    });
    expect(renders).toBeLessThan(5);
  });
});
