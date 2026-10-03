// The pointer's views of the editor a control is drawn in (pointer/views.ts; the plan's T7: one per editor), read the
// React way: a control redraws when the value it reads changes, and on nothing else.
import { useMemo, useSyncExternalStore } from 'react';
import { useStore } from '../../store.ts';
import { duplicating } from '../pointer.ts';
import { pointerViews, type PointerViews } from './views.ts';

export const usePointerViews = (): PointerViews => pointerViews(useStore());

// the views that are values with a subscribe
type Published = { [K in keyof PointerViews]: PointerViews[K] extends { get: () => unknown; subscribe: (listener: () => void) => () => void } ? K : never }[keyof PointerViews];

export function usePointerValue<K extends Published>(key: K): ReturnType<PointerViews[K]['get']> {
  const view = usePointerViews()[key] as { get: () => ReturnType<PointerViews[K]['get']>; subscribe: (listener: () => void) => () => void };
  return useSyncExternalStore(view.subscribe, view.get);
}

// whether the key that duplicates a drag is held (pointer.ts duplicating)
export function useDuplicating(): boolean {
  const store = useStore();
  const view = useMemo(() => duplicating(store), [store]);
  return useSyncExternalStore(view.subscribe, view.get);
}
