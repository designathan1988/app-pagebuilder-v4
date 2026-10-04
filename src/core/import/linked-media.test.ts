// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// A linked image is an element of the imported page, not a text run of its anchor.
import { expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import { walk } from '../document/model.ts';
import { exportPage } from '../export/export.ts';
import { MODEL_RULES } from '../../editor/store.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

it('keeps an image inside a link in the tree and in the exported HTML', () => {
  const html = '<!doctype html><html><body><section><a href="/offer"><img src="img/ad.jpg" alt="Offer"></a></section></body></html>';
  const file: PickedFile = { name: 'index.html', type: 'text/html', bytes: btoa(html) };
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  const nodes = [...walk(ran.document.pages[0]?.tree as DocNode)];
  const link = nodes.find((node) => node.tag === 'a');
  expect(link?.type).toBe('linkBlock');
  expect(link?.children.map((node) => node.tag)).toEqual(['img']);
  expect(exportPage(ran.document, 0, MODEL_RULES).html).toContain('<img src="img/ad.jpg" alt="Offer"');
});
