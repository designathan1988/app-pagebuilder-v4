import type { Sample } from './metrics.ts';

interface Probe {
  phase: string | null;
  samples: Sample[];
  pending: number;
  eventTiming: { name: string; duration: number; interactionId: number }[];
}
export type ProbedWindow = Window & { __builderPerformance: Probe };

// Browser-only instrumentation. Never changes the editor's document, selection, storage or history.
export function installPerformanceProbe(): void {
  if (window !== window.top) return;
  const top = (window.top ?? window) as unknown as ProbedWindow;
  const local = window as unknown as { __stopPerformanceProbe?: () => void };
  local.__stopPerformanceProbe?.();
  top.__builderPerformance ??= { phase: null, samples: [], pending: 0, eventTiming: [] };
  const sample = (event: Event, clock: Performance) => {
    const log = top.__builderPerformance;
    if (log.phase === null || !event.isTrusted) return;
    const phase = log.phase;
    // Stay on the event window's clock. Adding independently rounded epoch origins loses sub-ms precision.
    const start = clock.now();
    const created = event.timeStamp;
    log.pending += 1;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const end = clock.now();
      log.samples.push({ phase, event: event.type, key: 'key' in event && typeof event.key === 'string' ? event.key : null, trusted: event.isTrusted, inputMs: end - created, handlerMs: end - start, inputDelayMs: start - created, parentRealm: event instanceof Event, originOffsetMs: clock.timeOrigin - performance.timeOrigin });
      log.pending -= 1;
    }));
  };
  // Parent-realm callbacks can observe the script-disabled canvas, just like the app's keyboard owner.
  const frames = [...document.querySelectorAll<HTMLIFrameElement>('.frame__page')].flatMap(frame => frame.contentWindow ? [frame.contentWindow] : []);
  const stops = [window, ...frames].map(target => {
    const listener = (event: Event) => sample(event, target.performance);
    target.addEventListener('pointerdown', listener, true);
    target.addEventListener('keydown', listener, true);
    return () => {
      target.removeEventListener('pointerdown', listener, true);
      target.removeEventListener('keydown', listener, true);
    };
  });
  let observer: PerformanceObserver | undefined;
  // Native Event Timing is supplementary: samples below 16ms are censored, durations are rounded to 8ms.
  if (PerformanceObserver.supportedEntryTypes.includes('event')) {
    observer = new PerformanceObserver(list => {
      if (top.__builderPerformance.phase === null) return;
      for (const entry of list.getEntries()) {
        const timing = entry as PerformanceEventTiming;
        top.__builderPerformance.eventTiming.push({ name: timing.name, duration: timing.duration, interactionId: (timing as PerformanceEventTiming & { interactionId: number }).interactionId });
      }
    });
    observer.observe({ type: 'event', buffered: false, durationThreshold: 16 } as PerformanceObserverInit);
  }
  local.__stopPerformanceProbe = () => {
    for (const stop of stops) stop();
    observer?.disconnect();
  };
}
