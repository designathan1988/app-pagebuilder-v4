// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// A piece of a text the page does not draw is no part of the text (the capture corpus: MDN's menu read "JavaScriptJS",
// its short label, hidden, run into the wide one): a hidden element inside a text element is dropped, and the report
// names its line.
import { expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import { walk } from '../document/model.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

const file = (name: string, text: string): PickedFile => ({ name, type: 'text/html', bytes: btoa(text) });

it('drops a hidden piece of a text, and keeps the rest of the line', () => {
  const html = '<!doctype html><html><body><button type="button"><span>JavaScript</span><span hidden>JS</span></button></body></html>';
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', html)] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  const button = [...walk(ran.document.pages[0]?.tree as DocNode)].find((node) => node.tag === 'button');
  expect(button?.text).toBe('JavaScript');
});
