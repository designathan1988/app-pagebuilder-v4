// @vitest-environment happy-dom
// A page may set layout variables on <html> at runtime; the static copy must carry them to the exporter.
import { expect, it } from 'vitest';
import { serializePage } from './serialize.ts';

it('keeps the root element\'s runtime custom property as a stylesheet rule', () => {
  document.documentElement.setAttribute('style', '--vp-layout-top-height: 72px;');
  document.body.innerHTML = '<header style="top:var(--vp-layout-top-height)">Navigation</header>';
  const read = serializePage('https://site.test');
  expect(read.sheets.at(-1)?.text ?? '').toContain('html:root{--vp-layout-top-height: 72px;}');
});

it('ranks a root runtime style above a stylesheet root default', () => {
  document.documentElement.setAttribute('style', '--sk-banner-height: 4.2rem;');
  document.body.innerHTML = '<div class="banner">Summit</div>';
  const read = serializePage('https://site.test');
  expect(read.sheets.at(-1)?.text ?? '').toContain('html:root{--sk-banner-height: 4.2rem;}');
});

it('keeps capturing when a site has a malformed srcset candidate', () => {
  document.body.innerHTML = '<img src="https://site.test/good.svg" srcset="http://[::1 1x, https://site.test/good.svg 2x">';
  const read = serializePage('https://site.test');
  expect(read.html).toContain('srcset=');
  expect(read.images.some((image) => image.src === 'https://site.test/good.svg')).toBe(true);
});
