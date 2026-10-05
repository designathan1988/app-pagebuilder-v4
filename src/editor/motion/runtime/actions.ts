// The instant actions of the motion runtime (spec motion-runtime, Actions): what an action does to its target at the
// moment the timeline crosses its start. A visual change returns its undo, so playing a timeline backwards or
// scrubbing it puts the page back exactly as it was; an effect outside the page (navigating, copying, sending a form,
// a custom event) has none and runs only while a timeline really plays forwards, never while it is scrubbed.
// Components are reached through what their own scripts already listen to: a tab is clicked, a dialog is opened with
// its own API, a carousel is scrolled.
//
// Self-contained: embedded as text in the page's motion script (self-contained.test.ts).
import type { Effect } from '../../../core/motion/model.ts';
import type { MotionKit } from './kit.ts';

type Undo = () => void;

interface DisplayStart {
  // whether the action shows its target (false: it hides it)
  readonly showing: boolean;
  // the transition's keyframes, from the hidden look to the shown one when showing, the other way when hiding; null
  // for no transition
  readonly keyframes: Keyframe[] | null;
  // at the start: a shown target becomes visible (the transition then runs on it)
  start(): void;
  // at the end: a hidden target is hidden for good; its undo shows it again (the timeline played backwards)
  end(): Undo;
  // the target as it was before the action
  restore(): void;
}

export interface ActionKit {
  // whether the effect may run while a timeline is scrubbed (its undo puts the page back exactly)
  reversible(effect: Effect): boolean;
  // an instant effect run on a target; its undo, or null when it has none
  run(effect: Effect, target: Element): Undo | null;
  display(effect: Extract<Effect, { kind: 'display' }>, target: Element): DisplayStart;
  // the keyframes of a custom property tweened from what it holds now to the action's value
  variableKeyframes(effect: Extract<Effect, { kind: 'variable' }>, target: Element): Keyframe[];
}

export function createActions(win: Window, kit: MotionKit): ActionKit {
  // the window's own constructors: an event sent on the canvas's page is of that page's realm
  const realm = win as Window & typeof globalThis;
  const REVERSIBLE = new Set(['class', 'attribute', 'style', 'text', 'display', 'variable', 'dialog', 'details', 'theme']);
  // the theme a theme action remembers between visits
  const THEME_KEY = 'builder-theme';
  const THEME_CLASSES = { light: 'theme-light', dark: 'theme-dark' } as const;

  const isMedia = (element: Element): element is HTMLMediaElement => element.localName === 'video' || element.localName === 'audio';
  const html = (element: Element): HTMLElement => element as HTMLElement;
  // the element of a kind an action works on: the target itself, else the first one inside it
  const within = (target: Element, tag: string): Element | null => (target.localName === tag ? target : target.querySelector(tag));

  function inlineStyle(element: Element, property: string): Undo {
    const style = html(element).style;
    const value = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property);
    return () => {
      if (value === '') style.removeProperty(property);
      else style.setProperty(property, value, priority);
    };
  }

  function attribute(element: Element, name: string): Undo {
    const had = element.getAttribute(name);
    return () => {
      if (had === null) element.removeAttribute(name);
      else element.setAttribute(name, had);
    };
  }

  function isHidden(element: Element, mode: 'hidden' | 'visibility'): boolean {
    if (mode === 'hidden') return html(element).hidden === true;
    return win.getComputedStyle(element).visibility === 'hidden';
  }

  function setHidden(element: Element, mode: 'hidden' | 'visibility', hidden: boolean): void {
    if (mode === 'hidden') html(element).hidden = hidden;
    else html(element).style.visibility = hidden ? 'hidden' : 'visible';
  }

  // the look a transition starts a shown element from
  function hiddenLook(transition: string): Keyframe {
    if (transition === 'slide-up') return { opacity: 0, translate: '0 1em' };
    if (transition === 'slide-down') return { opacity: 0, translate: '0 -1em' };
    if (transition === 'scale') return { opacity: 0, scale: '0.92' };
    return { opacity: 0 };
  }
  function shownLook(transition: string): Keyframe {
    if (transition === 'slide-up' || transition === 'slide-down') return { opacity: 1, translate: '0 0' };
    if (transition === 'scale') return { opacity: 1, scale: '1' };
    return { opacity: 1 };
  }

  function display(effect: Extract<Effect, { kind: 'display' }>, target: Element): DisplayStart {
    const before = effect.mode === 'hidden' ? attribute(target, 'hidden') : inlineStyle(target, 'visibility');
    const hidden = isHidden(target, effect.mode);
    const showing = effect.operation === 'show' || (effect.operation === 'toggle' && hidden);
    const keyframes = effect.transition === 'none' ? null : showing ? [hiddenLook(effect.transition), shownLook(effect.transition)] : [shownLook(effect.transition), hiddenLook(effect.transition)];
    return {
      showing,
      keyframes,
      start() {
        if (showing) setHidden(target, effect.mode, false);
      },
      end() {
        if (showing) return () => undefined;
        const undo = effect.mode === 'hidden' ? attribute(target, 'hidden') : inlineStyle(target, 'visibility');
        setHidden(target, effect.mode, true);
        return undo;
      },
      restore: before,
    };
  }

  // the syntax a custom property takes from the value it is tweened to, so it interpolates (an unregistered custom
  // property flips halfway); registering once per document, never twice
  const registered = new WeakMap<Document, Set<string>>();
  function register(document: Document, name: string, value: string): void {
    const css = (document.defaultView as (Window & { CSS?: { registerProperty?: (definition: object) => void } }) | null)?.CSS;
    if (css === undefined || typeof css.registerProperty !== 'function') return;
    const done = registered.get(document) ?? new Set<string>();
    registered.set(document, done);
    if (done.has(name)) return;
    done.add(name);
    const text = value.trim();
    const syntax = /^-?(\d+\.?\d*|\.\d+)$/.test(text)
      ? '<number>'
      : /^-?(\d+\.?\d*|\.\d+)(deg|rad|turn|grad)$/.test(text)
        ? '<angle>'
        : /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vw|vh|vmin|vmax|ch|ex|svh|dvh|lvh|cqw|cqh)$/.test(text)
          ? '<length-percentage>'
          : /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\()/i.test(text)
            ? '<color>'
            : null;
    if (syntax === null) return;
    try {
      css.registerProperty({ name, syntax, inherits: true, initialValue: syntax === '<color>' ? 'transparent' : syntax === '<number>' ? '0' : syntax === '<angle>' ? '0deg' : '0px' });
    } catch {
      // a page's own CSS registered it already (@property): it interpolates as the page says
    }
  }

  function variableKeyframes(effect: Extract<Effect, { kind: 'variable' }>, target: Element): Keyframe[] {
    register(target.ownerDocument, effect.name, effect.value);
    const now = win.getComputedStyle(target).getPropertyValue(effect.name).trim();
    return now === '' ? [{ [effect.name]: effect.value }] : [{ [effect.name]: now }, { [effect.name]: effect.value }];
  }

  // the theme the root carries now: its own class, else what the browser prefers
  function currentTheme(root: HTMLElement): 'light' | 'dark' {
    if (root.classList.contains(THEME_CLASSES.dark)) return 'dark';
    if (root.classList.contains(THEME_CLASSES.light)) return 'light';
    return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setTheme(root: HTMLElement, theme: 'light' | 'dark' | 'system'): void {
    root.classList.remove(THEME_CLASSES.light, THEME_CLASSES.dark);
    // color-scheme turns the page's light-dark() values and the browser's own colours with it
    if (theme === 'system') root.style.removeProperty('color-scheme');
    else {
      root.classList.add(THEME_CLASSES[theme]);
      root.style.setProperty('color-scheme', theme);
    }
  }
  function remember(theme: string): void {
    try {
      if (theme === 'system') win.localStorage.removeItem(THEME_KEY);
      else win.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage refused (a private window): the theme holds for this visit only
    }
  }

  // the address of a page of the site, from where the script was loaded: the exported js/ folder's parent is the site's
  // root (read now, while the script runs: currentScript is null once it has run); the preview's inline script has none
  const script = win.document.currentScript as HTMLScriptElement | null;
  const siteRoot = script !== null && script.src !== '' ? new URL('..', script.src).href : win.document.baseURI;
  const pageAddress = (file: string): string => new URL(file, siteRoot).href;

  function scroll(effect: Extract<Effect, { kind: 'scroll' }>, target: Element): void {
    const behavior: ScrollBehavior = effect.smooth && !kit.reducedMotion() ? 'smooth' : 'auto';
    const root = win.document.scrollingElement ?? win.document.documentElement;
    if (effect.to === 'top') return win.scrollTo({ top: Math.max(0, effect.offset), behavior });
    if (effect.to === 'bottom') return win.scrollTo({ top: root.scrollHeight - win.innerHeight + effect.offset, behavior });
    const box = target.getBoundingClientRect();
    const align = effect.block === 'center' ? (win.innerHeight - box.height) / 2 : effect.block === 'end' ? win.innerHeight - box.height : 0;
    win.scrollTo({ top: Math.max(0, box.top + win.scrollY - align + effect.offset), behavior });
  }

  // a carousel: the scroll-snap container's slides, the one nearest its scroll position the current
  function slide(effect: Extract<Effect, { kind: 'slide' }>, target: Element): void {
    const slides = Array.from(target.children).filter((child) => child.getAttribute('aria-hidden') !== 'true') as HTMLElement[];
    if (slides.length === 0) return;
    const container = html(target);
    const marked = slides.findIndex((one) => one.getAttribute('aria-current') === 'true');
    const scrollable = container.scrollWidth > container.clientWidth + 1 || container.scrollHeight > container.clientHeight + 1;
    const nearest = (): number => {
      let best = 0;
      let distance = Infinity;
      slides.forEach((one, index) => {
        const away = Math.abs(one.offsetLeft - container.offsetLeft - container.scrollLeft) + Math.abs(one.offsetTop - container.offsetTop - container.scrollTop);
        if (away < distance) {
          best = index;
          distance = away;
        }
      });
      return best;
    };
    const current = scrollable ? nearest() : Math.max(0, marked);
    const next = effect.operation === 'go' ? Math.min(slides.length - 1, effect.index ?? 0) : (current + (effect.operation === 'next' ? 1 : -1) + slides.length) % slides.length;
    const chosen = slides[next] as HTMLElement;
    slides.forEach((one) => one.removeAttribute('aria-current'));
    chosen.setAttribute('aria-current', 'true');
    if (scrollable) {
      const behavior: ScrollBehavior = kit.reducedMotion() ? 'auto' : 'smooth';
      container.scrollTo({ left: chosen.offsetLeft - container.offsetLeft, top: chosen.offsetTop - container.offsetTop, behavior });
    } else {
      // no scroller: the current slide alone is shown
      slides.forEach((one, index) => (one.hidden = index !== next));
    }
    target.dispatchEvent(new realm.CustomEvent('builder:slide-change', { bubbles: true, detail: { index: next } }));
  }

  function media(effect: Extract<Effect, { kind: 'media' }>, target: Element): void {
    const element = isMedia(target) ? target : (target.querySelector('video, audio') as HTMLMediaElement | null);
    if (element === null) return;
    const play = (): void => {
      // a browser refuses to play sound before the person interacts with the page: said, never swallowed
      void element.play().catch((error: unknown) => kit.report({ code: 'media-refused', detail: String(error) }));
    };
    if (effect.operation === 'play') play();
    else if (effect.operation === 'pause') element.pause();
    else if (effect.operation === 'toggle') {
      if (element.paused) play();
      else element.pause();
    } else if (effect.operation === 'restart') {
      element.currentTime = 0;
      play();
    } else if (effect.operation === 'mute') element.muted = true;
    else if (effect.operation === 'unmute') element.muted = false;
    else element.muted = !element.muted;
  }

  function cssAnimation(effect: Extract<Effect, { kind: 'css-animation' }>, target: Element): void {
    if (effect.animation === '') return;
    const running = target.getAnimations().filter((one) => (one as Animation & { animationName?: string }).animationName === effect.animation);
    const className = kit.config.cssAnimations[effect.animation];
    if (running.length === 0) {
      // an animation an event plays runs while its class is on: the class put back on restarts it
      if (className === undefined || (effect.operation !== 'play' && effect.operation !== 'restart' && effect.operation !== 'toggle')) return;
      target.classList.remove(className);
      void html(target).offsetWidth;
      target.classList.add(className);
      return;
    }
    for (const animation of running) {
      if (effect.operation === 'play') animation.play();
      else if (effect.operation === 'pause') animation.pause();
      else if (effect.operation === 'restart') {
        animation.currentTime = 0;
        animation.play();
      } else if (effect.operation === 'reverse') animation.reverse();
      else if (effect.operation === 'seek') animation.currentTime = effect.time ?? 0;
      else if (animation.playState === 'running') animation.pause();
      else animation.play();
    }
  }

  function run(effect: Effect, target: Element): Undo | null {
    switch (effect.kind) {
      case 'class': {
        const had = target.classList.contains(effect.className);
        if (effect.operation === 'add') target.classList.add(effect.className);
        else if (effect.operation === 'remove') target.classList.remove(effect.className);
        else target.classList.toggle(effect.className);
        return () => target.classList.toggle(effect.className, had);
      }
      case 'attribute': {
        const undo = attribute(target, effect.name);
        if (effect.value === null) target.removeAttribute(effect.name);
        else target.setAttribute(effect.name, effect.value);
        return undo;
      }
      case 'style': {
        const undo = inlineStyle(target, effect.property);
        if (effect.value === null) html(target).style.removeProperty(effect.property);
        else html(target).style.setProperty(effect.property, effect.value);
        return undo;
      }
      case 'variable': {
        const undo = inlineStyle(target, effect.name);
        html(target).style.setProperty(effect.name, effect.value);
        return undo;
      }
      case 'text': {
        const children = Array.from(target.childNodes);
        target.textContent = effect.value;
        return () => target.replaceChildren(...children);
      }
      case 'display': {
        const started = display(effect, target);
        started.start();
        started.end();
        return started.restore;
      }
      case 'dialog': {
        const dialog = within(target, 'dialog') as HTMLDialogElement | null;
        if (dialog === null) return null;
        const wasOpen = dialog.open;
        const modal = dialog.matches(':modal');
        const open = effect.operation === 'open' || effect.operation === 'open-modal' || (effect.operation === 'toggle' && !wasOpen);
        if (!open) dialog.close();
        else if (!wasOpen) {
          if (effect.operation === 'open') dialog.show();
          else dialog.showModal();
        }
        return () => {
          if (dialog.open === wasOpen) return;
          if (!wasOpen) dialog.close();
          else if (modal) dialog.showModal();
          else dialog.show();
        };
      }
      case 'details': {
        const details = within(target, 'details') as HTMLDetailsElement | null;
        if (details === null) return null;
        const wasOpen = details.open;
        details.open = effect.operation === 'open' ? true : effect.operation === 'close' ? false : !wasOpen;
        return () => {
          details.open = wasOpen;
        };
      }
      case 'theme': {
        const root = win.document.documentElement;
        const before = { classes: root.className, scheme: root.style.getPropertyValue('color-scheme') };
        const theme = effect.operation === 'toggle' ? (currentTheme(root) === 'dark' ? 'light' : 'dark') : effect.operation;
        setTheme(root, theme);
        if (effect.remember && kit.mode === 'page') remember(theme);
        return () => {
          root.className = before.classes;
          if (before.scheme === '') root.style.removeProperty('color-scheme');
          else root.style.setProperty('color-scheme', before.scheme);
        };
      }
      case 'tab': {
        // the tabs' own script selects a tab when it is clicked (core/events/script.ts tabsRuntime)
        const tabs = Array.from(target.querySelectorAll('[role="tab"]')) as HTMLElement[];
        const list = tabs.length > 0 ? tabs : (Array.from(target.querySelectorAll(':scope > nav > button')) as HTMLElement[]);
        list[effect.index]?.click();
        return null;
      }
      case 'slide':
        slide(effect, target);
        return null;
      case 'media':
        media(effect, target);
        return null;
      case 'focus':
        if (effect.operation === 'focus') html(target).focus({ preventScroll: false });
        else html(target).blur();
        return null;
      case 'form': {
        const form = (target.localName === 'form' ? target : target.closest('form')) as HTMLFormElement | null;
        if (form === null) return null;
        // the browser's own submission, validation and submit event included, so the forms script handles it
        if (effect.operation === 'submit') {
          if (kit.mode === 'page') form.requestSubmit();
        } else form.reset();
        return null;
      }
      case 'navigate': {
        // the canvas never leaves the editor
        if (kit.mode !== 'page') return null;
        if (effect.to === 'back') win.history.back();
        else if (effect.to === 'forward') win.history.forward();
        else {
          const address = effect.address ?? '';
          if (address === '') return null;
          const href = effect.to === 'page' ? pageAddress(address) : address;
          if (effect.newTab) win.open(href, '_blank', 'noopener,noreferrer');
          else win.location.assign(href);
        }
        return null;
      }
      case 'clipboard': {
        const text = effect.source === 'text' ? (effect.text ?? '') : (target.textContent ?? '').trim();
        const clipboard = win.navigator.clipboard as Clipboard | undefined;
        if (clipboard === undefined) kit.report({ code: 'clipboard-refused', detail: 'navigator.clipboard' });
        else void clipboard.writeText(text).catch((error: unknown) => kit.report({ code: 'clipboard-refused', detail: String(error) }));
        return null;
      }
      case 'event':
        target.dispatchEvent(new realm.CustomEvent(effect.name, { bubbles: true, detail: effect.detail ?? null }));
        return null;
      case 'scroll':
        scroll(effect, target);
        return null;
      case 'css-animation':
        cssAnimation(effect, target);
        return null;
      case 'timeline':
        if (effect.timeline !== '') kit.player.control(effect.timeline, effect.operation, [target], effect.time ?? 0);
        return null;
      case 'lottie':
        kit.lottie.control(effect, target);
        return () => kit.lottie.control({ ...effect, operation: 'stop' }, target);
      case 'wait':
      case 'animate':
      case 'split-text':
        // timed: the player plays them
        return null;
    }
  }

  return {
    reversible: (effect) => REVERSIBLE.has(effect.kind),
    run,
    display,
    variableKeyframes,
  };
}
