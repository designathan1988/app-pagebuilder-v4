// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// HTML image dimensions are presentation hints below the site's CSS, not attributes to discard.
import { expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import { walk } from '../document/model.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

const file = (name: string, type: string, text: string): PickedFile => ({ name, type, bytes: btoa(text) });
const imageOf = (css: string): DocNode => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="css/site.css"></head><body><a href="/offer"><img class="ad" width="970" height="250" src="img/ad.jpg" alt="Offer"></a></body></html>';
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', html), file('css/site.css', 'text/css', css)] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  const image = [...walk(ran.document.pages[0]?.tree as DocNode)].find((node) => node.tag === 'img');
  if (image === undefined) throw new Error('no image imported');
  return image;
};

it('keeps an image’s HTML dimensions and intrinsic ratio', () => {
  const image = imageOf('');
  expect(image.styles.desktop?.base).toMatchObject({ width: '970px', height: '250px', 'aspect-ratio': 'auto 970 / 250' });
});

it('lets the site’s CSS width win over the HTML width hint', () => {
  const image = imageOf('.ad { width: 50%; }');
  expect(image.styles.desktop?.base?.width).toBe('50%');
  expect(image.styles.desktop?.base?.height).toBe('250px');
});
