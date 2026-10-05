// A page for the motion runtime's unit tests (never shipped: only the tests import it): a happy-dom window whose
// Web Animations and animation frames are driven by the test's own clock, so what a timeline does at each time is
// read exactly. What only a browser can say (the interpolated computed style, the scroll timelines, the compositor) is
// proven in Chrome (spec/BEHAVIOUR.md#motion-runtime).
import { Window } from 'happy-dom';
import type { RuntimeConfig } from '../../../core/motion/export.ts';

// An animation of the fake clock: its keyframes and timing as the runtime asked, its time, its rate, its play state.
class FakeAnimation {
  currentTime: number | { readonly value: number; readonly unit: string } | null = 0;
  playbackRate = 1;
  playState: 'idle' | 'running' | 'paused' | 'finished' = 'running';
  timeline: unknown = null;
  rangeStart = 'normal';
  rangeEnd = 'normal';
  animationName?: string;
  readonly effect: { getTiming(): KeyframeEffectOptions; updateTiming(): void };
  constructor(
    readonly target: Element,
    readonly keyframes: Keyframe[] | null,
    readonly options: KeyframeEffectOptions,
  ) {
    this.effect = { getTiming: () => options, updateTiming: () => undefined };
  }
  // the end of its effect: its delay, its active time and its end delay
  get end(): number {
    const iterations = this.options.iterations ?? 1;
    const duration = typeof this.options.duration === 'number' ? this.options.duration : 0;
    return (this.options.delay ?? 0) + (iterations === Infinity ? Infinity : duration * iterations) + (this.options.endDelay ?? 0);
  }
  play(): void {
    this.playState = 'running';
  }
  pause(): void {
    this.playState = 'paused';
  }
  cancel(): void {
    this.playState = 'idle';
    this.currentTime = null;
  }
  reverse(): void {
    this.playbackRate = -this.playbackRate;
    this.playState = 'running';
  }
  // the clock moving on: a running animation's time advances by its rate, within its effect
  advance(ms: number): void {
    if (this.playState !== 'running' || typeof this.currentTime !== 'number') return;
    this.currentTime = Math.min(this.end, Math.max(0, this.currentTime + ms * this.playbackRate));
  }
}

export interface FakePage {
  readonly win: Window;
  readonly document: Document;
  // every animation the runtime made, in order
  readonly animations: FakeAnimation[];
  // the clock moved on by ms, the animation frames run after it
  tick(ms: number): void;
  // the person asks for less motion, or not
  reduceMotion(on: boolean): void;
  // the viewport's width (the breakpoints read it)
  resize(width: number): void;
}

export function fakePage(markup: string): FakePage {
  const window = new Window({ url: 'https://example.org/site/index.html', width: 1440, height: 900 });
  const document = window.document as unknown as Document;
  document.body.innerHTML = markup;
  const animations: FakeAnimation[] = [];
  // the fake page's own Element: its animate and getAnimations are the test's (a loose record, as happy-dom types them)
  const prototype = (window as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
  prototype.animate = function animate(this: Element, keyframes: Keyframe[] | null, options: KeyframeEffectOptions) {
    const animation = new FakeAnimation(this, keyframes, options);
    animations.push(animation);
    return animation;
  };
  prototype.getAnimations = function getAnimations(this: Element) {
    return animations.filter((one) => one.target === this && one.playState !== 'idle');
  };
  // the frames run when the test moves the clock, never on their own
  let frames: { id: number; run: FrameRequestCallback }[] = [];
  let nextFrame = 1;
  const page = window as unknown as Record<string, unknown>;
  page.requestAnimationFrame = (run: FrameRequestCallback) => {
    frames.push({ id: nextFrame, run });
    return nextFrame++;
  };
  page.cancelAnimationFrame = (id: number) => {
    frames = frames.filter((frame) => frame.id !== id);
  };
  let reduced = false;
  page.matchMedia = (query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion') ? reduced : false;
    },
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return {
    win: window,
    document,
    animations,
    tick(ms) {
      for (const animation of animations) animation.advance(ms);
      const due = frames;
      frames = [];
      for (const frame of due) frame.run(0);
    },
    reduceMotion(on) {
      reduced = on;
    },
    resize(width) {
      (window as unknown as { happyDOM: { setViewport(size: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });
    },
  };
}

// The motion data of a test: one binding, its timelines, nothing else unless asked.
export function config(fields: Partial<RuntimeConfig>): RuntimeConfig {
  return { bindings: [], timelines: {}, behaviours: [], breakpoints: [{ id: 'desktop', width: 1440, base: true }, { id: 'tablet', width: 834, base: false }, { id: 'phone', width: 390, base: false }], cssAnimations: {}, lottie: {}, pages: ['index.html'], ...fields };
}
