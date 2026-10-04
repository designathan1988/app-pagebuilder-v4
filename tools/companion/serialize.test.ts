// @vitest-environment happy-dom
// A page may set layout variables on <html> at runtime; the static copy must carry them to the exporter.
import { expect, it } from 'vitest';
import { serializePage } from './serialize.ts';

it('keeps the root element\'s runtime custom property as a stylesheet rule', () => {
  document.documentElement.setAttribute('style', '--vp-layout-top-height: 72px;');
  document.body.innerHTML = '<header style="top:var(--vp-layout-top-height)">Navigation</header>';
  const read = serializePage('https://site.test');
  expect(read.sheets.at(-1)?.text ?? '').toContain('html{--vp-layout-top-height: 72px;}');
});
