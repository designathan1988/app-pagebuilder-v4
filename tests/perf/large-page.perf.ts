import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, setSectionOpen } from '../e2e/door.ts';
import { walk, type DocumentJson } from '../../src/core/document/model.ts';
import { installPerformanceProbe, type ProbedWindow } from '../../tools/perf/probe.ts';
import type { PerformanceRun } from '../../tools/perf/metrics.ts';
import { migrateDocument } from '../../src/core/document/migrations.ts';

const budget = JSON.parse(fs.readFileSync('tests/perf/budget.json', 'utf8')) as { fixture: string; nodes: number; runs: number };
const output = path.resolve(process.env.PERF_OUTPUT ?? '.cache/logs/perf-manual');
const iterations = Number(process.env.PERF_RUNS ?? budget.runs);
const read = (page: Page) => page.evaluate(() => {
  const port = (window as unknown as { __builderTestPort: { document(): DocumentJson; history(): { undoSteps: number }; selection(): string[] } }).__builderTestPort;
  return { document: port.document(), history: port.history(), selection: port.selection() };
});
async function phase(page: Page, name: string | null) {
  await page.waitForFunction(() => (window as unknown as ProbedWindow).__builderPerformance.pending === 0);
  await page.evaluate(value => { (window as unknown as ProbedWindow).__builderPerformance.phase = value; }, name);
}

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  test(`641-node interaction sample ${iteration}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(installPerformanceProbe);
    await openEditor(page);
    const chooser = page.waitForEvent('filechooser');
    await runDoor(page, 'project.open#menu-file');
    const picker = await chooser;
    // Include the driver-to-browser handoff, file reading and rendering; do not claim native paint precision.
    const openingAt = await page.evaluate(() => performance.timeOrigin + performance.now());
    await picker.setFiles(budget.fixture);
    const fixture = JSON.parse(fs.readFileSync(budget.fixture, 'utf8')) as DocumentJson;
    const nodes = fixture.pages.flatMap(p => [...walk(p.tree)]);
    expect(nodes.length).toBe(budget.nodes);
    // the editor holds the file as the current format writes it: the study's probe is format 1, migrated on open
    // (document format 4, 2026-10-04), so the document is compared with the file's migration, never the raw file
    const migrated = migrateDocument(fixture);
    if (!migrated.ok) throw new Error(`the probe does not migrate: ${migrated.reason}`);
    await expect.poll(async () => (await read(page)).document).toEqual(migrated.document);
    await expect(page.frameLocator('.frame__page').locator('[data-node]')).toHaveCount(budget.nodes);
    // Attach parent-realm listeners after the script-disabled canvas exists.
    await page.evaluate(installPerformanceProbe);
    const openingMs = await page.evaluate(async start => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.timeOrigin + performance.now() - start;
    }, openingAt);
    fs.mkdirSync(output, { recursive: true });
    const screenshot = `large-page-${iteration}.png`;
    await page.screenshot({ path: path.join(output, screenshot) });
    const node = (name: string) => {
      const found = nodes.find(n => n.name === name);
      if (!found) throw new Error(`Missing fixture node ${name}`);
      return found.id;
    };
    await phase(page, 'selection');
    for (const name of ['Section 0', 'H 0', 'Intro 0', 'Grid 0', 'Card 0-0', 'T 0-0', 'P 0-0', 'Card 0-1', 'T 0-1', 'P 0-1']) {
      await control(page, 'selection.select#layers-row', { args: { target: node(name) } }).click();
      await expect.poll(async () => (await read(page)).selection).toEqual([node(name)]);
    }
    await phase(page, null);
    await control(page, 'selection.select#layers-row', { args: { target: node('H 0') } }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await phase(page, 'text');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Performance sample');
    await page.keyboard.press('Enter');
    await phase(page, null);
    await setSectionOpen(page, 'text', true);
    const size = control(page, 'style.set#inspector-font-size').locator('input').first();
    await size.click();
    await page.keyboard.press('Control+A');
    await phase(page, 'style');
    await page.keyboard.type('28px');
    await page.keyboard.press('Enter');
    await phase(page, null);
    expect((await read(page)).history.undoSteps).toBe(2);
    await phase(page, 'undo');
    await runDoor(page, 'history.undo#toolbar-top-bar');
    await runDoor(page, 'history.undo#toolbar-top-bar');
    await expect.poll(async () => (await read(page)).document).toEqual(migrated.document);
    await phase(page, null);
    await runDoor(page, 'history.redo#toolbar-top-bar');
    await runDoor(page, 'history.redo#toolbar-top-bar');
    expect((await read(page)).history.undoSteps).toBe(2);
    await phase(page, 'undoKeys');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await read(page)).document).toEqual(migrated.document);
    await phase(page, null);
    const probe = await page.evaluate(() => (window as unknown as ProbedWindow).__builderPerformance);
    fs.writeFileSync(path.join(output, `probe-${iteration}.json`), JSON.stringify(probe, null, 2));
    expect(probe.samples.length).toBeGreaterThan(25);
    expect(probe.samples.filter(sample => sample.phase === 'selection')).toHaveLength(10);
    expect(probe.samples.filter(sample => sample.phase === 'text').length).toBeGreaterThanOrEqual('Performance sample'.length);
    expect(probe.samples.filter(sample => sample.phase === 'style')).toHaveLength(5);
    expect(probe.samples.filter(sample => sample.phase === 'undo')).toHaveLength(2);
    expect(probe.samples.filter(sample => sample.phase === 'undoKeys')).toHaveLength(4);
    expect(probe.samples.filter(sample => !sample.trusted || sample.inputMs < sample.handlerMs || sample.handlerMs < 0)).toEqual([]);
    const record: PerformanceRun = { iteration, nodes: budget.nodes, openingMs, samples: probe.samples, eventTiming: probe.eventTiming, screenshot };
    fs.writeFileSync(path.join(output, `run-${iteration}.json`), JSON.stringify(record, null, 2));
    await page.screenshot({ path: path.join(output, `restored-${iteration}.png`) });
  });
}
