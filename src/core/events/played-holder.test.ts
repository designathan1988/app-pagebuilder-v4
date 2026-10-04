// Family EV3 of the code audit (2026-10-04, second reading): an animation an event plays is the animation of the
// element that holds the interaction (interactions.add checks that element's own animations), but the export looked for
// it among the animations of the element the action acts on: with another element picked as the target, the holder
// played its animation at page load and the target never moved, no class rule written for it.
import { describe, expect, it } from 'vitest';
import { manifest } from '../../manifest/runtime.ts';
import { rulesFromManifest } from '../document/validate.ts';
import type { DocNode, DocumentJson, NodeId } from '../document/model.ts';
import { siteFiles } from '../export/export.ts';
import { playedAnimations } from './interactions.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const fade = { name: 'fade', settings: { duration: '1s' }, keyframes: [{ offset: 0, easing: '', declarations: { opacity: '0' } }, { offset: 100, easing: '', declarations: { opacity: '1' } }] };
const doc = (): DocumentJson => ({ version: 4, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body', { children: [
  node('Button', 'button', 'button', { text: 'Go', animations: [fade], interactions: [{ trigger: 'click', action: 'play-animation', animation: 'fade', target: 'Heading' as NodeId }] } as never),
  node('Heading', 'heading', 'h2', { text: 'Hi' }),
] }) }] });

describe('an animation an event plays belongs to the element that holds it (EV3)', () => {
  it('keys the played animation by its holder, so the export writes its class rule and never plays it at load', () => {
    expect(playedAnimations(doc()).get('Button' as NodeId)?.has('fade')).toBe(true);
    const css = siteFiles(doc(), RULES).css;
    expect(css).toContain('.anim-fade');
  });
});
