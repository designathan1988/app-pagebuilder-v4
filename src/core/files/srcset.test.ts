import { describe, expect, it } from 'vitest';
import { keptSrcset, rewriteSrcsetUrls } from './srcset.ts';

it('rewrites only candidate URLs while retaining width and density descriptors', () => {
  const actual = rewriteSrcsetUrls('img/narrow.svg 390w, img/wide.svg 1440w', (url) => `asset:${url}`);
  expect(actual).toBe('asset:img/narrow.svg 390w, asset:img/wide.svg 1440w');
});

it('does not split a data URL at its internal comma', () => {
  const actual = rewriteSrcsetUrls('data:image/svg+xml,%3Csvg%3E 1x, img/wide.svg 2x', (url) => url.startsWith('data:') ? url : `asset:${url}`);
  expect(actual).toBe('data:image/svg+xml,%3Csvg%3E 1x, asset:img/wide.svg 2x');
});

describe('the candidates a srcset keeps', () => {
  it('drops the candidates refused, descriptors kept with the others', () => {
    const value = 'https://cdn.test/a-360.jpg 360w, img/a-920.jpg 920w, https://cdn.test/a-1520.jpg 1520w';
    expect(keptSrcset(value, (url) => !url.startsWith('http'))).toBe('img/a-920.jpg 920w');
    expect(keptSrcset('a.png 1x, data:image/png;base64,AAA= 2x', (url) => url.startsWith('data:'))).toBe('data:image/png;base64,AAA= 2x');
  });
  it('keeps the value as it is when nothing or everything would remain', () => {
    expect(keptSrcset('https://cdn.test/a.jpg 1x, https://cdn.test/b.jpg 2x', () => false)).toBe('https://cdn.test/a.jpg 1x, https://cdn.test/b.jpg 2x');
    expect(keptSrcset('img/a.jpg 1x,img/b.jpg 2x', () => true)).toBe('img/a.jpg 1x,img/b.jpg 2x');
  });
});
