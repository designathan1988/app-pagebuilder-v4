// The exported script runs the interactions' Options (the canonical card's "Once · no delay"; spec export-events-js):
// read here by running the script the export writes against a small stand-in for the page, so what is proven is what
// it does, not how it is written.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { DocNode, DocumentJson, Interaction } from '../document/model.ts';
import { readOptions } from './interactions.ts';
import { interactionsJs } from './script.ts';

const node = (id: string, interactions: readonly Interaction[]): DocNode => ({ id: id as NodeId, type: 'button' as DocNode['type'], name: id, tag: 'button', attributes: {}, classes: [], styles: {}, text: null, children: [], interactions });
const page = (children: DocNode[]): DocumentJson => ({ version: 2, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: { ...node('root', []), type: 'page' as DocNode['type'], tag: 'body', children } }] });

// an element of the stand-in page: its listeners, its classes and its hidden flag
class Element {
  readonly listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>();
  readonly classes = new Set<string>();
  hidden = false;
  offsetWidth = 0;
  readonly classList = {
    toggle: (name: string) => (this.classes.has(name) ? this.classes.delete(name) : this.classes.add(name)),
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault: () => undefined });
  }
  scrollIntoView(): void {}
}

class Observer {
  static all: Observer[] = [];
  off = false;
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    Observer.all.push(this);
  }
  observe(): void {}
  disconnect(): void {
    this.off = true;
  }
  // the element entering (true) or leaving (false) the screen
  see(inside: boolean): void {
    if (!this.off) this.callback([{ isIntersecting: inside }]);
  }
}

// The script of a document, run: its elements by class (each node's class is its id), its observers and its timers.
function run(document: DocumentJson) {
  const script = interactionsJs(document, (id) => `.${id}`);
  if (script === null) throw new Error('no script');
  const elements = new Map<string, Element>();
  const element = (selector: string): Element => {
    const found = elements.get(selector) ?? new Element();
    elements.set(selector, found);
    return found;
  };
  Observer.all = [];
  const timers: { run: () => void; ms: number }[] = [];
  const page = { querySelectorAll: (selector: string) => [element(selector)], querySelector: (selector: string) => element(selector) };
  new Function('document', 'IntersectionObserver', 'setTimeout', 'window', script)(page, Observer, (callback: () => void, ms: number) => timers.push({ run: callback, ms }), {});
  return { element, timers, observers: Observer.all };
}

describe('readOptions', () => {
  it('reads once or always and a delay in ms or s, in any order', () => {
    expect(readOptions('once 200ms')).toEqual({ once: true, delay: 200 });
    expect(readOptions('0.5s, once')).toEqual({ once: true, delay: 500 });
    expect(readOptions('always · 0')).toEqual({ once: false, delay: 0 });
    expect(readOptions('300')).toEqual({ delay: 300 });
    expect(readOptions('ALWAYS')).toEqual({ once: false });
  });

  it('refuses any other word, a second word of a kind and a delay over 10 s', () => {
    for (const text of ['', 'soon', 'once always', '100ms 200ms', '20s', '-5ms']) expect(readOptions(text)).toBeNull();
  });
});

describe('the Options in the exported script', () => {
  it('a click set to once waits its delay, then acts the first time only', () => {
    const page = run(page1([{ trigger: 'click', action: 'toggle-class', className: 'is-open', once: true, delay: 200 }]));
    const button = page.element('.button');
    button.fire('click');
    button.fire('click');
    expect(page.timers.map((timer) => timer.ms)).toEqual([200]);
    expect(button.classes.has('is-open')).toBe(false);
    page.timers[0]?.run();
    expect(button.classes.has('is-open')).toBe(true);
  });

  it('a click fires every time, at once, without Options', () => {
    const page = run(page1([{ trigger: 'click', action: 'toggle-class', className: 'is-open' }]));
    const button = page.element('.button');
    button.fire('click');
    button.fire('click');
    button.fire('click');
    expect(page.timers).toEqual([]);
    expect(button.classes.has('is-open')).toBe(true);
  });

  it('entering the screen fires once of its own, and every time it comes back when set to always', () => {
    const once = run(page1([{ trigger: 'scroll-into-view', action: 'toggle-class', className: 'seen' }]));
    once.observers[0]?.see(true);
    once.observers[0]?.see(false);
    once.observers[0]?.see(true);
    expect(once.element('.button').classes.has('seen')).toBe(true);
    const always = run(page1([{ trigger: 'scroll-into-view', action: 'toggle-class', className: 'seen', once: false }]));
    for (const inside of [true, true, false, true]) always.observers[0]?.see(inside);
    // in, still in (no second firing), out, in again: toggled twice
    expect(always.element('.button').classes.has('seen')).toBe(false);
  });

  it('an animation an element plays on itself plays: the action acts on the element itself', () => {
    const page = run(page1([{ trigger: 'click', action: 'play-animation', animation: 'fade-in' }]));
    expect(() => page.element('.button').fire('click')).not.toThrow();
    expect(page.element('.button').classes.has('anim-fade-in')).toBe(true);
  });
});

// a page of one button holding these interactions
function page1(interactions: readonly Interaction[]): DocumentJson {
  return page([node('button', interactions)]);
}
