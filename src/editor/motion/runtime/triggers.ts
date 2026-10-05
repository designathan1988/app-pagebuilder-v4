// The triggers of the motion runtime (plan stage 10, the whole catalogue; spec motion-runtime, Triggers): each binds
// to its source element — or to the page, for a page trigger — and calls back when it fires, when its paired half
// happens (hover's leave, leaving the viewport, the other scroll direction), or with its progress (a continuous one).
// Component triggers read the state the page's markup carries, which any script of the page writes: aria-expanded for
// a dropdown and a mobile menu, aria-selected for a tab, aria-current or a scroll-snap position for a slide, the open
// attribute of a dialog. Every binding returns its removal; nothing is left listening once the runtime is disposed.
//
// Self-contained: embedded as text in the page's motion script (self-contained.test.ts).
import type { Trigger } from '../../../core/motion/model.ts';
import type { MotionKit } from './kit.ts';

interface TriggerHandlers {
  fire(): void;
  leave(): void;
  progress(fraction: number): void;
  // the run's length, for a page leave that waits for its animation before it navigates
  duration(): number;
}

export interface TriggerKit {
  bind(trigger: Trigger, source: Element, handlers: TriggerHandlers, range: { readonly start: number; readonly end: number }): () => void;
}

export function createTriggers(win: Window, kit: MotionKit): TriggerKit {
  // the window's own constructors: an observer of the canvas's page is of that page's realm
  const realm = win as Window & typeof globalThis;
  // the distance a pointer may travel during a long press before it is a drag instead
  const PRESS_SLOP = 10;
  // the least scroll that says a direction, so a trackpad's jitter says none
  const DIRECTION_SLOP = 4;
  const RESIZE_SETTLE = 150;
  // the longest a page leave waits for its animation before the browser leaves
  const LEAVE_WAIT = 1500;
  const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];

  function bind(trigger: Trigger, source: Element, handlers: TriggerHandlers, range: { readonly start: number; readonly end: number }): () => void {
    const removals: (() => void)[] = [];
    const listen = (target: EventTarget, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void => {
      target.addEventListener(type, listener, options);
      removals.push(() => target.removeEventListener(type, listener, options));
    };
    const observe = (target: Node, options: MutationObserverInit, react: (records: MutationRecord[]) => void): void => {
      const observer = new realm.MutationObserver(react);
      observer.observe(target, options);
      removals.push(() => observer.disconnect());
    };
    const timeout = (milliseconds: number, run: () => void): void => {
      const id = win.setTimeout(run, milliseconds);
      removals.push(() => win.clearTimeout(id));
    };
    const document = source.ownerDocument;
    // a trigger of the page's root listens to the whole document (a key pressed anywhere)
    const isRoot = source === document.body || source === document.documentElement;
    const on = (type: string, react: () => void): void => listen(source, type, react);
    const media = (): HTMLMediaElement | null => (source.localName === 'video' || source.localName === 'audio' ? (source as HTMLMediaElement) : (source.querySelector('video, audio') as HTMLMediaElement | null));

    switch (trigger.kind) {
      case 'click':
        on('click', handlers.fire);
        break;
      case 'double-click':
        on('dblclick', handlers.fire);
        break;
      case 'pointer-down':
        on('pointerdown', handlers.fire);
        break;
      case 'pointer-up':
        on('pointerup', handlers.fire);
        break;
      case 'pointer-enter':
        on('pointerenter', handlers.fire);
        break;
      case 'pointer-leave':
        on('pointerleave', handlers.fire);
        break;
      case 'hover':
        on('pointerenter', handlers.fire);
        on('pointerleave', handlers.leave);
        break;
      case 'pointer-move':
        listen(source, 'pointermove', (event) => {
          const box = source.getBoundingClientRect();
          const pointer = event as PointerEvent;
          const fraction = trigger.axis === 'y' ? (pointer.clientY - box.top) / Math.max(1, box.height) : (pointer.clientX - box.left) / Math.max(1, box.width);
          handlers.progress(Math.min(1, Math.max(0, fraction)));
        });
        break;
      case 'focus':
        on('focus', handlers.fire);
        break;
      case 'blur':
        on('blur', handlers.fire);
        break;
      case 'focus-within': {
        let within = false;
        listen(source, 'focusin', () => {
          if (within) return;
          within = true;
          handlers.fire();
        });
        listen(source, 'focusout', (event) => {
          const next = (event as FocusEvent).relatedTarget as Node | null;
          if (next !== null && source.contains(next)) return;
          within = false;
          handlers.leave();
        });
        break;
      }
      case 'key': {
        const wanted = (trigger.key ?? '').toLowerCase();
        listen(isRoot ? document : source, 'keydown', (event) => {
          const key = event as KeyboardEvent;
          if (key.repeat || (wanted !== '' && key.key.toLowerCase() !== wanted)) return;
          // a key typed into a field belongs to the field, unless the field itself holds the interaction
          const typing = key.target as Element | null;
          if (isRoot && typing !== null && typing !== source && typing.matches('input, textarea, select, [contenteditable]')) return;
          handlers.fire();
        });
        break;
      }
      case 'input':
        on('input', handlers.fire);
        break;
      case 'change':
        on('change', handlers.fire);
        break;
      case 'form-submit':
        // the submission itself is the form's (the forms script, or the browser): the interaction plays beside it
        on('submit', handlers.fire);
        break;
      case 'form-invalid': {
        // one invalid event per invalid field: one firing per attempt
        let queued = false;
        listen(
          source,
          'invalid',
          () => {
            if (queued) return;
            queued = true;
            win.setTimeout(() => {
              queued = false;
              handlers.fire();
            }, 0);
          },
          { capture: true },
        );
        break;
      }
      case 'long-press': {
        let timer = 0;
        let start: { x: number; y: number } | null = null;
        const cancel = (): void => {
          win.clearTimeout(timer);
          start = null;
        };
        listen(source, 'pointerdown', (event) => {
          const pointer = event as PointerEvent;
          start = { x: pointer.clientX, y: pointer.clientY };
          timer = win.setTimeout(() => {
            start = null;
            handlers.fire();
          }, trigger.milliseconds ?? 500);
        });
        listen(source, 'pointermove', (event) => {
          const pointer = event as PointerEvent;
          if (start !== null && Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) > PRESS_SLOP) cancel();
        });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) listen(source, type, cancel);
        removals.push(cancel);
        break;
      }
      case 'scroll-into-view':
      case 'scroll-out-of-view': {
        const threshold = trigger.threshold ?? 0.5;
        let inside = false;
        const observer = new realm.IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const visible = entry.isIntersecting && entry.intersectionRatio >= threshold - 0.001;
              if (visible && !inside) {
                inside = true;
                if (trigger.kind === 'scroll-into-view') handlers.fire();
              } else if (!visible && inside && (!entry.isIntersecting || entry.intersectionRatio < threshold)) {
                inside = false;
                if (trigger.kind === 'scroll-into-view') handlers.leave();
                else handlers.fire();
              }
            }
          },
          { threshold: [0, threshold, 1].filter((value, index, all) => all.indexOf(value) === index) },
        );
        observer.observe(source);
        removals.push(() => observer.disconnect());
        break;
      }
      case 'while-visible':
      case 'page-scroll':
        removals.push(kit.scroll.follow(trigger.kind, source, range.start, range.end, handlers.progress));
        break;
      case 'scroll-direction': {
        let last = win.scrollY;
        let going: 'up' | 'down' | null = null;
        listen(
          win,
          'scroll',
          () => {
            const delta = win.scrollY - last;
            if (Math.abs(delta) < DIRECTION_SLOP) return;
            last = win.scrollY;
            const now = delta > 0 ? 'down' : 'up';
            if (now === going) return;
            going = now;
            if (now === (trigger.direction ?? 'down')) handlers.fire();
            else handlers.leave();
          },
          { passive: true },
        );
        break;
      }
      case 'page-load':
        // every binding is made before any fires, so a page-load timeline may control another one
        timeout(0, handlers.fire);
        break;
      case 'page-leave': {
        listen(win, 'pagehide', handlers.fire);
        if (kit.mode !== 'page') break;
        // a link to another page of the site plays the leave first, then goes
        listen(
          document,
          'click',
          (event) => {
            const click = event as MouseEvent;
            if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
            const link = (click.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
            if (link === null || link.target === '_blank' || link.hasAttribute('download')) return;
            const to = new URL(link.href, document.baseURI);
            const here = new URL(win.location.href);
            if (to.origin !== here.origin || (to.pathname === here.pathname && to.hash !== '')) return;
            click.preventDefault();
            handlers.fire();
            win.setTimeout(() => win.location.assign(to.href), kit.reducedMotion() ? 0 : Math.min(LEAVE_WAIT, handlers.duration()));
          },
          { capture: true },
        );
        break;
      }
      case 'visibility':
        listen(document, 'visibilitychange', () => {
          if (document.visibilityState === (trigger.state ?? 'hidden')) handlers.fire();
        });
        break;
      case 'resize': {
        let settle = 0;
        listen(win, 'resize', () => {
          win.clearTimeout(settle);
          settle = win.setTimeout(handlers.fire, RESIZE_SETTLE);
        });
        removals.push(() => win.clearTimeout(settle));
        break;
      }
      case 'breakpoint': {
        let at = kit.activeBreakpoint();
        listen(win, 'resize', () => {
          const now = kit.activeBreakpoint();
          if (now === at) return;
          at = now;
          if (now === trigger.breakpoint) handlers.fire();
          else handlers.leave();
        });
        break;
      }
      case 'timer':
        timeout(trigger.milliseconds ?? 1000, handlers.fire);
        break;
      case 'interval': {
        const id = win.setInterval(handlers.fire, Math.max(16, trigger.milliseconds ?? 1000));
        removals.push(() => win.clearInterval(id));
        break;
      }
      case 'idle': {
        let timer = 0;
        let armed = true;
        const wait = (): void => {
          win.clearTimeout(timer);
          armed = true;
          timer = win.setTimeout(() => {
            if (!armed) return;
            // idle once until the person comes back
            armed = false;
            handlers.fire();
          }, trigger.milliseconds ?? 1000);
        };
        for (const type of INPUT_EVENTS) listen(win, type, wait, { passive: true });
        wait();
        removals.push(() => win.clearTimeout(timer));
        break;
      }
      case 'media-play':
      case 'media-pause':
      case 'media-end': {
        const element = media();
        if (element !== null) listen(element, trigger.kind === 'media-play' ? 'play' : trigger.kind === 'media-pause' ? 'pause' : 'ended', handlers.fire);
        break;
      }
      case 'media-time': {
        const element = media();
        if (element === null) break;
        const at = trigger.seconds ?? 0;
        let before = element.currentTime;
        listen(element, 'timeupdate', () => {
          const now = element.currentTime;
          if (before < at && now >= at) handlers.fire();
          before = now;
        });
        listen(element, 'seeked', () => {
          before = element.currentTime;
        });
        break;
      }
      case 'dropdown-open':
      case 'dropdown-close': {
        const opening = trigger.kind === 'dropdown-open';
        observe(source, { attributes: true, subtree: true, attributeFilter: ['aria-expanded'] }, (records) => {
          for (const record of records) {
            const control = record.target as Element;
            if (control !== source && !control.hasAttribute('aria-haspopup')) continue;
            if ((control.getAttribute('aria-expanded') === 'true') === opening) {
              handlers.fire();
              return;
            }
          }
        });
        // a popover opening or closing (its own toggle event)
        listen(
          source,
          'toggle',
          (event) => {
            const state = (event as Event & { newState?: string }).newState;
            if (state !== undefined && (state === 'open') === opening && (event.target as Element).hasAttribute('popover')) handlers.fire();
          },
          { capture: true },
        );
        break;
      }
      case 'tab-change':
        observe(source, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] }, (records) => {
          if (records.some((record) => (record.target as Element).getAttribute('role') === 'tab' && (record.target as Element).getAttribute('aria-selected') === 'true')) handlers.fire();
        });
        break;
      case 'slide-change': {
        on('builder:slide-change', handlers.fire);
        observe(source, { attributes: true, subtree: true, attributeFilter: ['aria-current'] }, (records) => {
          // the slide action marks the slide itself and says so with its event: one firing, not two
          if (records.some((record) => (record.target as Element).getAttribute('aria-current') === 'true' && (record.target as Element).getAttribute('aria-roledescription') === 'slide')) handlers.fire();
        });
        // a scroll-snap carousel scrolled by the person: the slide nearest its scroll position changed
        let shown = -1;
        listen(source, 'scrollend', () => {
          const container = source as HTMLElement;
          const slides = Array.from(container.children) as HTMLElement[];
          let best = -1;
          let distance = Infinity;
          slides.forEach((one, index) => {
            const away = Math.abs(one.offsetLeft - container.offsetLeft - container.scrollLeft) + Math.abs(one.offsetTop - container.offsetTop - container.scrollTop);
            if (away < distance) {
              best = index;
              distance = away;
            }
          });
          if (best !== shown && shown !== -1) handlers.fire();
          shown = best;
        });
        break;
      }
      case 'dialog-open':
      case 'dialog-close': {
        const opening = trigger.kind === 'dialog-open';
        observe(source, { attributes: true, attributeFilter: ['open'] }, () => {
          if (source.hasAttribute('open') === opening) handlers.fire();
        });
        break;
      }
      case 'details-open':
        on('toggle', () => {
          if ((source as HTMLDetailsElement).open) handlers.fire();
        });
        break;
      case 'mobile-menu-open':
        observe(source, { attributes: true, subtree: true, attributeFilter: ['aria-expanded'] }, (records) => {
          for (const record of records) {
            const control = record.target as Element;
            if (control.getAttribute('aria-expanded') !== 'true') continue;
            const controlled = (control.getAttribute('aria-controls') ?? '').split(/\s+/).map((id) => (id === '' ? null : document.getElementById(id)));
            if (controlled.some((menu) => menu !== null && (menu.localName === 'nav' || menu.querySelector('nav') !== null))) {
              handlers.fire();
              return;
            }
          }
        });
        break;
      case 'custom':
        if (trigger.event !== undefined && trigger.event !== '') on(trigger.event, handlers.fire);
        break;
    }
    return () => {
      for (const remove of removals.splice(0).reverse()) remove();
    };
  }

  return { bind };
}
