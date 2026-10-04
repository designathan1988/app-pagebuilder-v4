import { expect, it } from 'vitest';
import { rewriteSrcsetUrls } from './srcset.ts';

it('rewrites only candidate URLs while retaining width and density descriptors', () => {
  const actual = rewriteSrcsetUrls('img/narrow.svg 390w, img/wide.svg 1440w', (url) => `asset:${url}`);
  expect(actual).toBe('asset:img/narrow.svg 390w, asset:img/wide.svg 1440w');
});

it('does not split a data URL at its internal comma', () => {
  const actual = rewriteSrcsetUrls('data:image/svg+xml,%3Csvg%3E 1x, img/wide.svg 2x', (url) => url.startsWith('data:') ? url : `asset:${url}`);
  expect(actual).toBe('data:image/svg+xml,%3Csvg%3E 1x, asset:img/wide.svg 2x');
});
