// The player of the motion runtime (spec motion-runtime, Playing a timeline): a timeline played on one element (the
// source its relative targets are read from) is a run — native Web Animations for everything that moves, and cues for
// the instant actions, crossed as the run's clock passes them.
//  - Every animation of a run lasts the whole run: its delay is its action's start (plus its stagger), its end delay
//    pads it to the run's end. So all of them share one clock — seeking, reversing and attaching them to a scroll
//    timeline keeps them together, and a scroll timeline's proportions are the timeline's own.
//  - A run is made when the runtime starts, paused at 0, so each animation's first keyframe holds from the start (an
//    element that fades in on scroll is transparent before it scrolls in).
//  - A cue fires forwards when the clock passes it and is undone when the clock goes back past it. While a timeline is
//    scrubbed (a scroll, the editor's playhead) only cues that can be undone run (actions.ts reversible).
//  - Less motion asked (prefers-reduced-motion) and an interaction that respects it: the run jumps to its end (or its
//    start) at once, every cue crossed, nothing moving.
//
// Self-contained: embedded as text in the page's motion script (self-contained.test.ts).
import type { RuntimeAction, RuntimeTimeline } from '../../../core/motion/export.ts';
import type { Control, Effect, PlaybackOperation, PropertyTrack, Stagger } from '../../../core/motion/model.ts';
import type { MotionKit } from './kit.ts';
import type { ScrollKind } from './scroll.ts';

interface Run {
  readonly timeline: RuntimeTimeline;
  readonly source: Element;
  // the run's length in ms (an infinite action counted once)
  readonly total: number;
  // where the clock is, in ms (-1 before anything ran)
  time(): number;
  playing(): boolean;
  play(direction: 1 | -1): void;
  pause(): void;
  // back to before the start, everything the run did undone
  stop(): void;
  // the clock set to a time without playing: only cues that can be undone run (the editor's playhead, a scrub)
  seek(time: number): void;
  // a scrub's progress, 0 to 1
  progress(fraction: number): void;
  // to the end (or the start) at once, every cue crossed as if played
  jump(direction: 1 | -1): void;
  // the direction it last played in (-1 before it ever played)
  lastDirection(): 1 | -1;
  // the run's animations follow the browser's own scroll timeline; false where it cannot
  attachScroll(kind: ScrollKind, start: number, end: number): boolean;
  dispose(): void;
}

export interface PlayerKit {
  // the run of a timeline on a source, made the first time it is asked; null when the project has no such timeline
  run(timeline: string, source: Element): Run | null;
  // an interaction's control applied to a run, respecting reduced motion unless the interaction ignores it
  apply(run: Run, control: Control, respectReducedMotion: boolean): void;
  // a timeline action controlling another timeline, on each of its targets as a source
  control(timeline: string, operation: PlaybackOperation, sources: readonly Element[], time: number): void;
  // every run, for the editor's playhead preview
  runs(): readonly Run[];
  dispose(): void;
}

export function createPlayer(win: Window, kit: MotionKit): PlayerKit {
  // the stagger of split text when its action sets none, in ms between two pieces
  const SPLIT_STAGGER = 40;
  // the parts of a transform a track may key, as the registered custom property each animates
  const PARTS: Record<string, { readonly syntax: string; readonly initial: string }> = {
    'translate-x': { syntax: '<length-percentage>', initial: '0px' },
    'translate-y': { syntax: '<length-percentage>', initial: '0px' },
    'translate-z': { syntax: '<length>', initial: '0px' },
    'scale-x': { syntax: '<number>', initial: '1' },
    'scale-y': { syntax: '<number>', initial: '1' },
    'rotate-x': { syntax: '<angle>', initial: '0deg' },
    'rotate-y': { syntax: '<angle>', initial: '0deg' },
    'rotate-z': { syntax: '<angle>', initial: '0deg' },
    'skew-x': { syntax: '<angle>', initial: '0deg' },
    'skew-y': { syntax: '<angle>', initial: '0deg' },
  };
  const part = (name: string): string => `--bm-${name}`;
  const variable = (name: string): string => `var(${part(name)}, ${PARTS[name]?.initial ?? '0'})`;
  // the transform the parts compose into, after the element's own transform
  const COMPOSED = [
    `translate3d(${variable('translate-x')}, ${variable('translate-y')}, ${variable('translate-z')})`,
    `rotateX(${variable('rotate-x')})`,
    `rotateY(${variable('rotate-y')})`,
    `rotate(${variable('rotate-z')})`,
    `skew(${variable('skew-x')}, ${variable('skew-y')})`,
    `scale(${variable('scale-x')}, ${variable('scale-y')})`,
  ].join(' ');

  const registry = new Map<string, Map<Element, Run>>();
  const partsRegistered = new WeakSet<Document>();
  const composed = new Map<Element, { users: number; restore: () => void }>();
  let animateMissingSaid = false;
  // a timeline that controls a timeline that controls it back stops after this many nested controls
  const MAX_DEPTH = 8;
  let depth = 0;

  // ---------------------------------------------------------------- helpers

  const easingCss = (text: string | undefined, duration: number): string => {
    if (text === undefined) return 'linear';
    const parsed = kit.easing.parse(text);
    return parsed === null ? 'linear' : kit.easing.css(parsed, duration);
  };
  const cycles = (action: RuntimeAction): number => (action.repeat === 'infinite' ? 1 : (action.repeat ?? 1));

  // a seeded random number generator (mulberry32), so a random stagger is the same on every play and every page
  function random(seedText: string): () => number {
    let seed = 0;
    for (let index = 0; index < seedText.length; index += 1) seed = (Math.imul(seed, 31) + seedText.charCodeAt(index)) | 0;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // each target's offset from the action's start: one after the other from the first, the middle, the last, or in a
  // seeded shuffle of them
  function staggerOffsets(count: number, stagger: Stagger | undefined, seed: string): number[] {
    if (stagger === undefined || count <= 1 || stagger.each <= 0) return new Array<number>(count).fill(0);
    const ranks = new Array<number>(count).fill(0).map((_zero, index) => index);
    if (stagger.from === 'end') return ranks.map((index) => (count - 1 - index) * stagger.each);
    if (stagger.from === 'center') return ranks.map((index) => Math.round(Math.abs(index - (count - 1) / 2) * stagger.each));
    if (stagger.from === 'random') {
      const next = random(seed);
      const shuffled = ranks.slice();
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        const held = shuffled[index] as number;
        shuffled[index] = shuffled[swap] as number;
        shuffled[swap] = held;
      }
      const offsets = new Array<number>(count).fill(0);
      shuffled.forEach((target, rank) => (offsets[target] = rank * stagger.each));
      return offsets;
    }
    return ranks.map((index) => index * stagger.each);
  }

  // a CSS property as a keyframe names it: camelCase, a custom property as it is, a transform part as its variable
  function keyOf(property: string): string {
    if (property.startsWith('--')) return property;
    if (property in PARTS) return part(property);
    if (property === 'float') return 'cssFloat';
    if (property === 'offset') return 'cssOffset';
    return property.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());
  }

  function registerParts(document: Document): void {
    if (partsRegistered.has(document)) return;
    partsRegistered.add(document);
    const css = (document.defaultView as (Window & { CSS?: { registerProperty?: (definition: object) => void } }) | null)?.CSS;
    if (css === undefined || typeof css.registerProperty !== 'function') return;
    for (const [name, { syntax, initial }] of Object.entries(PARTS)) {
      try {
        css.registerProperty({ name: part(name), syntax, inherits: false, initialValue: initial });
      } catch {
        // registered already (the canvas reinstalls the runtime in the same document)
      }
    }
  }

  // an element whose transform parts are keyed takes the composed transform, after its own; given back with the last
  // run that uses it
  function composeParts(element: Element): () => void {
    registerParts(element.ownerDocument);
    const held = composed.get(element);
    if (held !== undefined) {
      held.users += 1;
    } else {
      const style = (element as HTMLElement).style;
      const before = style.getPropertyValue('transform');
      const priority = style.getPropertyPriority('transform');
      const own = win.getComputedStyle(element).transform;
      style.setProperty('transform', `${own === 'none' || own === '' ? '' : `${own} `}${COMPOSED}`);
      composed.set(element, {
        users: 1,
        restore: () => {
          if (before === '') style.removeProperty('transform');
          else style.setProperty('transform', before, priority);
        },
      });
    }
    return () => {
      const entry = composed.get(element);
      if (entry === undefined) return;
      entry.users -= 1;
      if (entry.users > 0) return;
      composed.delete(element);
      entry.restore();
    };
  }

  function keyframesOf(track: PropertyTrack, duration: number): Keyframe[] {
    const key = keyOf(track.property);
    return track.keyframes.map((keyframe, index) => {
      const next = track.keyframes[index + 1];
      const segment = next === undefined ? duration : next.time - keyframe.time;
      // an action that lasts 0 ms sets its value at once: the keyframe sits at its end, so it holds afterwards
      const offset = duration === 0 ? 1 : keyframe.time / duration;
      return { offset, [key]: keyframe.value, easing: easingCss(keyframe.easing, segment) };
    });
  }

  // ---------------------------------------------------------------- a run

  interface Cue {
    readonly time: number;
    fire(forward: boolean, live: boolean): void;
  }

  function build(timeline: RuntimeTimeline, source: Element): Run {
    const animations: Animation[] = [];
    // the animations of infinite actions: they loop on and are never played backwards
    const looping = new Set<Animation>();
    const cues: Cue[] = [];
    const cleanups: (() => void)[] = [];

    // first the targets and their offsets, so the run's length is known before any animation is made
    const planned = timeline.actions.map((action) => {
      const targets = kit.targets.resolve(action.target, source);
      if (action.effect.kind === 'split-text') {
        const effect = action.effect;
        const splits = targets.map((target) => kit.split.split(target, effect.by));
        for (const one of splits) cleanups.push(() => one.restore());
        const pieces = splits.flatMap((one) => one.pieces);
        const groups = effect.by === 'line' ? Math.max(0, ...pieces.map((one) => one.line)) + 1 : pieces.length;
        const offsets = staggerOffsets(groups, action.stagger ?? { each: SPLIT_STAGGER, from: 'start' }, action.id);
        const pieceOffsets = pieces.map((one, index) => offsets[effect.by === 'line' ? one.line : index] ?? 0);
        return { action, targets: pieces.map((one) => one.element as Element), offsets: pieceOffsets };
      }
      return { action, targets, offsets: staggerOffsets(targets.length, action.stagger, action.id) };
    });
    const total = Math.max(1, ...planned.map(({ action, offsets }) => action.start + Math.max(0, ...offsets) + action.duration * cycles(action)));

    let cursor = -1;
    let isPlaying = false;
    let direction: 1 | -1 = 1;
    let last: 1 | -1 = -1;
    let frame = 0;
    // the scroll timeline the run follows, while it follows one (attachScroll), and the range it plays across
    let native: { readonly stop: () => void } | null = null;
    let nativeTimeline: AnimationTimeline | null = null;
    let nativeRange: readonly [string, string] = ['0%', '100%'];

    // the clock: an animation with no keyframes on the source, as long as the run
    const master = typeof source.animate === 'function' ? source.animate(null, { duration: total, fill: 'both' }) : null;
    if (master !== null) {
      master.pause();
      master.currentTime = 0;
    }

    const now = (): number => {
      if (master === null) return Math.max(0, cursor);
      const held = master.currentTime as number | { readonly value: number; readonly unit: string } | null;
      if (held === null) return 0;
      // a scroll timeline's time is a percentage of its range
      return typeof held === 'number' ? held : (held.value / 100) * total;
    };

    // an animation of the run: delay to its start, end delay to the run's end, paused where the clock is
    function animate(element: Element, keyframes: Keyframe[], start: number, action: RuntimeAction): Animation | null {
      if (typeof element.animate !== 'function') {
        if (!animateMissingSaid) kit.report({ code: 'action-failed', detail: 'Element.animate' });
        animateMissingSaid = true;
        return null;
      }
      const infinite = action.repeat === 'infinite';
      const active = action.duration * cycles(action);
      const animation = element.animate(keyframes, {
        delay: start,
        duration: action.duration,
        iterations: infinite ? Infinity : cycles(action),
        direction: action.yoyo === true ? 'alternate' : 'normal',
        easing: easingCss(action.easing, action.duration),
        endDelay: infinite ? 0 : Math.max(0, total - start - active),
        fill: 'both',
      });
      animation.pause();
      animation.currentTime = Math.max(0, now());
      if (infinite) looping.add(animation);
      animations.push(animation);
      if (native !== null && !infinite) attachOne(animation);
      else if (isPlaying) playOne(animation);
      return animation;
    }

    const forget = (animation: Animation | null): void => {
      if (animation === null) return;
      animation.cancel();
      const at = animations.indexOf(animation);
      if (at >= 0) animations.splice(at, 1);
      looping.delete(animation);
    };

    function plan(action: RuntimeAction, target: Element, offset: number): void {
      const start = action.start + offset;
      const effect: Effect = action.effect;
      if (effect.kind === 'wait') return;
      if (effect.kind === 'animate' || effect.kind === 'split-text') {
        if (effect.tracks.some((track) => track.property in PARTS)) cleanups.push(composeParts(target));
        for (const track of effect.tracks) animate(target, keyframesOf(track, action.duration), start, action);
        return;
      }
      if (effect.kind === 'display' && action.duration > 0 && effect.transition !== 'none') {
        let started: ReturnType<typeof kit.actions.display> | null = null;
        let transition: Animation | null = null;
        let ended: (() => void) | null = null;
        cues.push({
          time: start,
          fire(forward) {
            if (forward) {
              started = kit.actions.display(effect, target);
              started.start();
              transition = started.keyframes === null ? null : animate(target, started.keyframes, start, { ...action, repeat: 1 });
            } else {
              forget(transition);
              transition = null;
              started?.restore();
              started = null;
            }
          },
        });
        cues.push({
          time: start + action.duration,
          fire(forward) {
            if (forward) ended = started?.end() ?? null;
            else {
              ended?.();
              ended = null;
            }
          },
        });
        return;
      }
      if (effect.kind === 'variable' && action.duration > 0) {
        let tween: Animation | null = null;
        cues.push({
          time: start,
          fire(forward) {
            if (forward) tween = animate(target, kit.actions.variableKeyframes(effect, target), start, action);
            else {
              forget(tween);
              tween = null;
            }
          },
        });
        return;
      }
      // an instant action, at its start
      let undo: (() => void) | null = null;
      cues.push({
        time: start,
        fire(forward, live) {
          if (forward) {
            if (!live && !kit.actions.reversible(effect)) return;
            try {
              undo = kit.actions.run(effect, target);
            } catch (error) {
              kit.report({ code: 'action-failed', detail: `${effect.kind}: ${String(error)}` });
            }
          } else {
            undo?.();
            undo = null;
          }
        },
      });
    }

    for (const { action, targets, offsets } of planned) targets.forEach((target, index) => plan(action, target, offsets[index] ?? 0));
    // cues in time order; two at the same time in the timeline's order
    const ordered = cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.time - b.cue.time || a.index - b.index);

    // the cues between where the clock was and where it is now: forwards in time order, backwards undone in reverse
    function cross(to: number, live: boolean): void {
      if (to > cursor) {
        for (const { cue } of ordered) if (cue.time > cursor && cue.time <= to) cue.fire(true, live);
      } else if (to < cursor) {
        for (let index = ordered.length - 1; index >= 0; index -= 1) {
          const cue = (ordered[index] as { cue: Cue }).cue;
          if (cue.time <= cursor && cue.time > to) cue.fire(false, live);
        }
      }
      cursor = to;
    }

    const all = (): Animation[] => (master === null ? animations.slice() : [master, ...animations]);

    function setAll(time: number): void {
      for (const animation of all()) {
        animation.pause();
        // an infinite loop keeps its own phase: it is set inside the run, never past it
        animation.currentTime = Math.max(0, time);
      }
    }

    function playOne(animation: Animation): void {
      if (looping.has(animation) && direction < 0) {
        animation.pause();
        return;
      }
      animation.playbackRate = looping.has(animation) ? 1 : direction;
      animation.play();
    }

    function loop(): void {
      frame = 0;
      if (!isPlaying) return;
      const time = now();
      if (direction > 0 && time >= total) {
        isPlaying = false;
        cross(total, true);
        return;
      }
      if (direction < 0 && time <= 0) {
        isPlaying = false;
        setAll(0);
        // back at the start: what the run did at 0 is undone too, the page as it was before the trigger
        cross(-1, true);
        return;
      }
      cross(time, true);
      frame = win.requestAnimationFrame(loop);
    }

    function stopLoop(): void {
      if (frame !== 0) win.cancelAnimationFrame(frame);
      frame = 0;
    }

    function play(towards: 1 | -1): void {
      detachScroll();
      direction = towards;
      last = towards;
      // playing forwards from the end starts again; backwards from the start, from the end
      if (towards > 0 && cursor >= total) {
        setAll(0);
        cross(-1, true);
      }
      if (towards < 0 && cursor <= 0) {
        setAll(total);
        cross(total, false);
      }
      const time = Math.min(total, Math.max(0, cursor));
      setAll(time);
      for (const animation of all()) playOne(animation);
      isPlaying = true;
      stopLoop();
      // the cues at the clock now (a forward play from 0 runs what starts at 0 at once)
      if (towards > 0) cross(time, true);
      frame = win.requestAnimationFrame(loop);
    }

    function pause(): void {
      stopLoop();
      const time = now();
      for (const animation of all()) animation.pause();
      isPlaying = false;
      if (cursor >= 0) cross(Math.min(total, Math.max(0, time)), true);
    }

    function seek(time: number): void {
      detachScroll();
      stopLoop();
      isPlaying = false;
      const clamped = Math.min(total, Math.max(0, time));
      setAll(clamped);
      cross(time <= 0 ? -1 : clamped, false);
    }

    function jump(towards: 1 | -1): void {
      detachScroll();
      stopLoop();
      isPlaying = false;
      last = towards;
      setAll(towards > 0 ? total : 0);
      cross(towards > 0 ? total : -1, true);
    }

    // ---- scroll timelines

    function attachOne(animation: Animation): void {
      if (native === null) return;
      const [rangeStart, rangeEnd] = nativeRange;
      const scrolled = animation as Animation & { rangeStart?: string; rangeEnd?: string };
      animation.timeline = nativeTimeline;
      scrolled.rangeStart = rangeStart;
      scrolled.rangeEnd = rangeEnd;
      animation.play();
    }
    function attachScroll(kind: ScrollKind, start: number, end: number): boolean {
      // an infinite loop has no length to map a scroll onto: the listener drives that run
      if (looping.size > 0 || master === null || !('rangeStart' in master)) return false;
      const timeline = kit.scroll.nativeTimeline(kind, source);
      if (timeline === null) return false;
      stopLoop();
      isPlaying = false;
      nativeTimeline = timeline;
      nativeRange = kit.scroll.nativeRange(kind, start, end);
      native = { stop: () => undefined };
      try {
        for (const animation of all()) attachOne(animation);
      } catch {
        detachScroll();
        return false;
      }
      // the instant actions follow the scroll as the animations do (only the ones that can be undone)
      let pending = 0;
      const follow = (): void => {
        if (pending !== 0) return;
        pending = win.requestAnimationFrame(() => {
          pending = 0;
          const time = now();
          cross(time <= 0 ? -1 : Math.min(total, time), false);
        });
      };
      win.addEventListener('scroll', follow, { passive: true });
      follow();
      native = {
        stop: () => {
          win.removeEventListener('scroll', follow);
          if (pending !== 0) win.cancelAnimationFrame(pending);
        },
      };
      return true;
    }

    function detachScroll(): void {
      if (native === null) return;
      const time = now();
      native.stop();
      native = null;
      nativeTimeline = null;
      for (const animation of all()) {
        animation.pause();
        animation.timeline = win.document.timeline;
      }
      setAll(Math.min(total, Math.max(0, time)));
    }

    function dispose(): void {
      detachScroll();
      stopLoop();
      isPlaying = false;
      // what the run did is undone, then its animations go, then what it changed of the page's structure
      cross(-1, false);
      for (const animation of all()) animation.cancel();
      animations.length = 0;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    }

    return {
      timeline,
      source,
      total,
      time: () => (cursor < 0 ? -1 : now()),
      playing: () => isPlaying,
      play,
      pause,
      stop: () => seek(-1),
      seek,
      progress: (fraction) => seek(Math.min(1, Math.max(0, fraction)) * total),
      jump,
      lastDirection: () => last,
      attachScroll,
      dispose,
    };
  }

  // ---------------------------------------------------------------- the registry

  function run(name: string, source: Element): Run | null {
    const timeline = kit.config.timelines[name];
    if (timeline === undefined) {
      kit.report({ code: 'timeline-missing', detail: name });
      return null;
    }
    const bySource = registry.get(name) ?? new Map<Element, Run>();
    registry.set(name, bySource);
    const held = bySource.get(source);
    if (held !== undefined) return held;
    const made = build(timeline, source);
    bySource.set(source, made);
    return made;
  }

  function apply(target: Run, control: Control, respect: boolean): void {
    const reduced = respect && kit.reducedMotion();
    switch (control) {
      case 'play':
        if (reduced) target.jump(1);
        else target.play(1);
        return;
      case 'restart':
        target.stop();
        if (reduced) target.jump(1);
        else target.play(1);
        return;
      case 'reverse':
        if (reduced) target.jump(-1);
        else target.play(-1);
        return;
      case 'toggle': {
        const towards: 1 | -1 = target.lastDirection() > 0 ? -1 : 1;
        if (reduced) target.jump(towards);
        else target.play(towards);
        return;
      }
      case 'pause':
        target.pause();
        return;
      case 'stop':
        target.stop();
        return;
      case 'scrub':
        // a continuous trigger hands its progress itself (install.ts)
        return;
    }
  }

  function control(name: string, operation: PlaybackOperation, sources: readonly Element[], time: number): void {
    if (depth >= MAX_DEPTH) {
      kit.report({ code: 'action-failed', detail: `timeline ${name}: controls nest too deep` });
      return;
    }
    depth += 1;
    try {
      for (const source of sources) {
        const target = run(name, source);
        if (target === null) continue;
        if (operation === 'seek') target.seek(time);
        else if (operation === 'restart') apply(target, 'restart', true);
        else apply(target, operation === 'play' ? 'play' : operation === 'reverse' ? 'reverse' : operation === 'pause' ? 'pause' : 'toggle', true);
      }
    } finally {
      depth -= 1;
    }
  }

  function runs(): readonly Run[] {
    return [...registry.values()].flatMap((bySource) => [...bySource.values()]);
  }

  function dispose(): void {
    for (const one of runs()) one.dispose();
    registry.clear();
  }

  return { run, apply, control, runs, dispose };
}
