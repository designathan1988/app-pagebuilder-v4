// A tile of the selected element's own kind puts the new element beside it: Grid, then Card three times, is a grid of
// three cards, never three cards each inside the one before (the audit of 2026-10-05).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const INSERT = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
type Node = { type: string; name: string; children: Node[] };

test('Card clicked three times after Grid fills the grid with three cards', runs(INSERT, TILE), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'template-grid' } });
  for (let i = 0; i < 3; i += 1) await runDoor(page, TILE, { args: { entry: 'template-card' } });
  const grid = await page.evaluate(() => {
    const doc = (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document();
    const find = (n: Node): Node | null => (n.children.some((c) => c.type === 'article') ? n : n.children.map(find).find((x) => x !== null) ?? null);
    return doc.pages[0] ? find(doc.pages[0].tree) : null;
  });
  expect(grid?.children.map((c) => c.type), 'three cards side by side in the grid').toEqual(['article', 'article', 'article']);
  expect(grid?.children.every((card) => card.children.every((c) => c.type !== 'article')), 'no card inside a card').toBe(true);
});
