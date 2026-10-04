// Family SV1 of the code audit (2026-10-04, second reading): the walkers of every value of the project missed some of
// its stores. Recording a motion keyframe keeps the CSS text written, var(--brand) included, but renaming or deleting a
// design token never read the timelines, so the keyframe kept a variable that no longer existed; and the site colours
// missed the colours of an element's animation keyframes.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { deleteToken, renameToken } from './tokens.ts';
import { siteColoursOf } from './site-colours.ts';

const timeline = { id: 't1', name: 'Intro', markers: [], actions: [{ id: 'a1', target: { kind: 'self' }, start: 0, duration: 500, effect: { kind: 'animate', tracks: [{ id: 'k1', property: 'color', keyframes: [{ id: 'f1', time: 0, value: 'var(--brand)' }, { id: 'f2', time: 500, value: '#000000' }] }] } }] };
const doc = () =>
  documentOf({
    tokens: [{ name: 'brand', kind: 'color', value: '#ff0000' }] as never,
    motionTimelines: [timeline] as never,
    pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div', { animations: [{ name: 'pulse', settings: {}, keyframes: [{ offset: 0, easing: '', declarations: { color: '#00ff00' } }] }] } as never)] }) }],
  });

describe('every store of values is read (SV1)', () => {
  it('follows a token renamed into the motion keyframes, and refuses to delete one they use', () => {
    const renamed = runHandler(renameToken, doc(), { token: 'brand', name: 'accent' });
    expect(renamed.problems).toEqual([]);
    expect(JSON.stringify(renamed.document.motionTimelines)).toContain('var(--accent)');
    expect(runHandler(deleteToken, doc(), { token: 'brand' }).outcome.kind).toBe('refused');
  });
  it('lists the colours of an element\'s animation keyframes among the site colours', () => {
    expect(siteColoursOf(doc()).map((one) => one.colour)).toContain('#00ff00');
  });
});
