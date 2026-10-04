// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// HTML's ordinary text whitespace collapses; only an actual <br> is a line break in the imported page.
import { expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import { exportPage } from '../export/export.ts';
import { MODEL_RULES } from '../../editor/store.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

it('does not turn source indentation into line breaks while keeping a real br', () => {
  const html = '<!doctype html><html><body><h1>\n  Resources for Developers,<br> by Developers\n</h1><p>\n  Documenting <a href="/css">CSS</a>, and JavaScript.\n</p></body></html>';
  const file: PickedFile = { name: 'index.html', type: 'text/html', bytes: btoa(html) };
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  const exported = exportPage(ran.document, 0, MODEL_RULES).html;
  expect(exported).toContain('Resources for Developers,<br> by Developers');
  expect(exported).toContain('Documenting <a href="/css">CSS</a>, and JavaScript.');
  expect(exported).not.toContain('<h1><br>');
  expect(exported).not.toContain('<p><br>');
});
