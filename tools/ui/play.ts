// The flows' player (tools/ui/flows.ts): it plays one flow on an open editor page with real gestures — a click, a drag,
// typing, a key — reads what happened through the read-only test port, and answers the problems it met: an
// expectation the app did not meet, an error the page logged, an incident the app recorded. `npm run ui` plays a flow
// with a photo per step (drive.ts); the browser suite plays every flow as a test of its own (tests/e2e/flows.spec.ts,
// the audit's AUD-31: no gate ran the flows, and one had been broken for weeks).
import type { ConsoleMessage, Dialog, Download, Page } from '@playwright/test';
import fs from 'node:fs';
import type { Flow, Step } from './flows.ts';

export interface Port {
  readonly document: () => { readonly pages: readonly { readonly tree: Node }[]; readonly files?: readonly { path: string }[] };
  readonly selection: () => readonly string[];
  readonly history: () => { readonly undoSteps: number; readonly redoSteps: number };
  readonly incidents: () => readonly { readonly kind: string; readonly what: string; readonly detail: string }[];
  readonly explain: { readonly command: (id: string, args: unknown) => string; readonly node: (id: string) => { readonly about: string; readonly answer: string } };
}
interface Node {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly children: readonly Node[];
  readonly text: string | null;
}

// The app's own port, read-only, in the page: the same surface the browser checks use. The port's members are read
// inside the page: a function does not survive the trip to this process.
const readSelection = (page: Page): Promise<readonly string[]> => page.evaluate(() => (window as unknown as { __builderTestPort: Port }).__builderTestPort.selection());
export const readIncidents = (page: Page): Promise<readonly { kind: string; what: string; detail: string }[]> => page.evaluate(() => (window as unknown as { __builderTestPort: Port }).__builderTestPort.incidents());
const readDocument = (page: Page): Promise<{ pages: readonly { tree: Node }[]; files?: readonly { path: string }[] }> => page.evaluate(() => (window as unknown as { __builderTestPort: Port }).__builderTestPort.document());
export const readWhy = (page: Page, id: string, args: unknown): Promise<string> => page.evaluate(([one, a]) => (window as unknown as { __builderTestPort: Port }).__builderTestPort.explain.command(one as string, a), [id, args] as const);

// (the count is computed in the page, where the tree lives)
function allNodesCount(node: Node | undefined): number {
  return node === undefined ? 0 : 1 + node.children.reduce((sum, child) => sum + allNodesCount(child), 0);
}

async function pointFor(page: Page, at: string | { readonly x: number; readonly y: number }): Promise<{ x: number; y: number }> {
  if (typeof at !== 'string') {
    const mapped = await page.evaluate((pagePoint) => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      if (iframe === null) throw new Error('the canvas frame is missing');
      const zoom = iframe.currentCSSZoom;
      const box = iframe.getBoundingClientRect();
      const style = getComputedStyle(iframe);
      const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
      const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
      return { x: left + pagePoint.x * zoom, y: top + pagePoint.y * zoom };
    }, at);
    return mapped;
  }
  // a node's name, or a node id: the element the canvas draws for it, at its middle
  const mapped = await page.evaluate((wanted) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument ?? null;
    if (iframe === null || doc === null) throw new Error('the canvas frame is missing');
    const port = (window as unknown as { __builderTestPort: Port }).__builderTestPort;
    const tree = port.document().pages[0]?.tree;
    const named = tree === undefined ? [] : [tree, ...tree.children.flatMap(function walk(child: Node): readonly Node[] {
      return [child, ...child.children.flatMap(walk)];
    })];
    const wanted2 = String(wanted).trim().toLowerCase();
    const found = named.find((node) => node.id === wanted || node.name.trim().toLowerCase() === wanted2);
    const el = found === undefined ? null : doc.querySelector(`[data-node="${found.id}"]`);
    if (el === null) throw new Error(`the canvas draws no ${wanted}`);
    const r = el.getBoundingClientRect();
    const zoom = iframe.currentCSSZoom;
    const box = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    return { x: left + (r.left + r.width / 2) * zoom, y: top + (r.top + r.height / 2) * zoom };
  }, at);
  return mapped;
}

// what one play of a flow keeps: the downloads the page made (newest last), the key a held stroke keeps down until its
// release, the errors the page logged and the problems met
interface Play {
  readonly page: Page;
  readonly downloads: Download[];
  held: string | null;
  readonly consoleErrors: string[];
  readonly problems: string[];
}

async function runStep(play: Play, step: Step): Promise<string> {
  const { page } = play;
  const label = 'photo' in step ? step.photo : Object.keys(step)[0] ?? 'step';
  if ('door' in step) {
    const selector = `[data-door="${step.door}"]`;
    const control = step.labelled === undefined ? page.locator(selector).first() : page.locator(selector, { hasText: step.labelled }).first();
    await control.waitFor({ state: 'visible', timeout: 5_000 });
    await control.click();
  } else if ('click' in step) {
    await page.locator(step.click).first().click(step.modifier === undefined ? undefined : { modifiers: [step.modifier] });
  } else if ('type' in step) {
    const field = page.locator(step.type.at).first();
    await field.waitFor({ state: 'visible', timeout: 5_000 });
    await field.click();
    if (step.type.clear !== false) await page.keyboard.press('Control+a');
    await page.keyboard.type(step.type.text);
    if (step.type.enter !== false) await page.keyboard.press('Enter');
  } else if ('key' in step) {
    await page.keyboard.press(step.key);
  } else if ('text' in step) {
    await page.keyboard.type(step.text);
  } else if ('reload' in step) {
    const accept = (dialog: Dialog) => {
      void dialog.accept();
    };
    page.on('dialog', accept);
    await page.reload();
    await page.locator('.workbench').waitFor();
    page.off('dialog', accept);
  } else if ('files' in step) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(step.files.at).first().click();
    await (await chooser).setFiles([...step.files.paths]);
  } else if ('move' in step) {
    const box = await page.locator(step.move.at).first().boundingBox();
    if (box === null) throw new Error(`the pointer target is not drawn: ${step.move.at}`);
    const { from, to, steps, interval } = step.move;
    await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
    for (let i = 1; i <= steps; i += 1) {
      await page.waitForTimeout(interval);
      await page.mouse.move(box.x + box.width * (from[0] + ((to[0] - from[0]) * i) / steps), box.y + box.height * (from[1] + ((to[1] - from[1]) * i) / steps));
    }
  } else if ('drag' in step) {
    const from = await pointFor(page, step.drag.from);
    const to = await pointFor(page, step.drag.to);
    if (step.drag.modifier !== undefined) await page.keyboard.down(step.drag.modifier);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    if (step.drag.modifier !== undefined) await page.keyboard.up(step.drag.modifier);
  } else if ('stroke' in step) {
    const box = await page.locator(step.stroke.at).first().boundingBox();
    if (box === null) throw new Error(`the stroke's surface is not drawn: ${step.stroke.at}`);
    const at = ([fx, fy]: readonly [number, number]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    const points = step.stroke.points.map(at);
    if (step.stroke.from !== undefined) {
      const handle = await page.locator(step.stroke.from).first().boundingBox();
      if (handle === null) throw new Error(`the stroke's handle is not drawn: ${step.stroke.from}`);
      points.unshift({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });
    }
    const [first, ...rest] = points;
    if (first === undefined) throw new Error('a stroke needs points');
    if (step.stroke.modifier !== undefined) await page.keyboard.down(step.stroke.modifier);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 8 });
    if (step.stroke.hold === true) {
      play.held = step.stroke.modifier ?? null;
      return label;
    }
    await page.mouse.up();
    if (step.stroke.modifier !== undefined) await page.keyboard.up(step.stroke.modifier);
  } else if ('release' in step) {
    await page.mouse.up();
    if (play.held !== null) await page.keyboard.up(play.held);
    play.held = null;
  } else if ('wheel' in step) {
    const box = await page.locator(step.wheel.at).first().boundingBox();
    if (box === null) throw new Error(`the wheel's target is not drawn: ${step.wheel.at}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, step.wheel.dy);
  } else if ('wait' in step) {
    await page.waitForTimeout(step.wait ?? 200);
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return label;
}

// Every file of the last download, by its path in the ZIP.
async function lastExport(play: Play): Promise<ReadonlyMap<string, Uint8Array>> {
  const download = play.downloads.at(-1);
  const at = download === undefined ? null : await download.path();
  if (at === null) return new Map();
  const { unzip } = await import('../runner/unzip.ts');
  return unzip(fs.readFileSync(at)) as ReadonlyMap<string, Uint8Array>;
}

async function check(play: Play, step: Step, index: number): Promise<void> {
  if (!('expect' in step)) return;
  const { page, problems } = play;
  const selection = await readSelection(page);
  const document = await readDocument(page);
  const tree = document.pages[0]?.tree;
  const nodes = allNodesCount(tree);
  const message = await page.locator('[data-region="status-bar"]').innerText().catch(() => '');
  const expected = step.expect;
  if (expected.selection !== undefined && JSON.stringify(selection) !== JSON.stringify(expected.selection)) {
    problems.push(`step ${index}: the selection is ${JSON.stringify(selection)}, expected ${JSON.stringify(expected.selection)}`);
  }
  if (expected.selectedCount !== undefined && selection.length !== expected.selectedCount) {
    problems.push(`step ${index}: ${selection.length} selected, expected ${expected.selectedCount}`);
  }
  if (expected.nodes !== undefined && nodes !== expected.nodes) problems.push(`step ${index}: the page holds ${nodes} elements, expected ${expected.nodes}`);
  if (expected.message !== undefined && expected.message !== '' && !message.includes(expected.message)) {
    problems.push(`step ${index}: the status bar says ${JSON.stringify(message.split('\n')[0])}, expected it to contain ${JSON.stringify(expected.message)}`);
  }
  if (expected.files !== undefined) {
    const files = (document.files ?? []).map((file) => file.path);
    if (JSON.stringify(files) !== JSON.stringify(expected.files)) problems.push(`step ${index}: the project holds ${JSON.stringify(files)}, expected ${JSON.stringify(expected.files)}`);
  }
  if (expected.exportedFiles !== undefined) {
    const exported = [...(await lastExport(play)).keys()];
    for (const wanted of expected.exportedFiles) if (!exported.includes(wanted)) problems.push(`step ${index}: the export has no ${wanted} (it has ${exported.join(', ')})`);
  }
  if (expected.exportHas !== undefined || expected.exportLacks !== undefined) {
    const text = [...(await lastExport(play)).values()].map((bytes) => Buffer.from(bytes).toString('utf8')).join('\n');
    for (const wanted of expected.exportHas ?? []) if (!text.includes(wanted)) problems.push(`step ${index}: no exported file holds ${wanted}`);
    for (const unwanted of expected.exportLacks ?? []) if (text.includes(unwanted)) problems.push(`step ${index}: an exported file holds ${unwanted}`);
  }
}

export interface PlayOptions {
  // after each step: its number, its label (a photo step's name, else its kind) and the page, to photograph it
  readonly afterStep?: (index: number, label: string, page: Page) => Promise<void>;
  // a line of the play's own account (the step, the status bar's first line, an incident)
  readonly log?: (line: string) => void;
}

// Plays a flow on an editor page already open on a fresh profile; answers the problems met, none for a clean play.
export async function playFlow(page: Page, flow: Flow, options: PlayOptions = {}): Promise<readonly string[]> {
  const play: Play = { page, downloads: [], held: null, consoleErrors: [], problems: [] };
  const log = options.log ?? (() => undefined);
  const onDownload = (download: Download) => play.downloads.push(download);
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') play.consoleErrors.push(message.text().slice(0, 300));
  };
  const onError = (error: Error) => play.consoleErrors.push(`page error: ${String(error).slice(0, 300)}`);
  page.on('download', onDownload);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  log(`\nflow "${flow.name}": ${flow.about}`);
  let index = 0;
  let told = false;
  try {
    for (const step of flow.steps) {
      index += 1;
      const label = await runStep(play, step);
      await check(play, step, index);
      await options.afterStep?.(index, label, page);
      const incidents = await readIncidents(page);
      const first = (await page.locator('[data-region="status-bar"]').innerText().then((text) => text.split('\n')[0]).catch(() => '')) ?? '';
      log(`  ${String(index).padStart(2, '0')} ${label.padEnd(18)} ${first.slice(0, 60)}${incidents.length > 0 ? `  [${incidents.length} incident(s)]` : ''}`);
      // the first incident is told where it happened, whole: a later step that fails because of it hides the cause
      if (incidents.length > 0 && !told) {
        told = true;
        for (const one of incidents) log(`     incident (${one.kind}): ${one.what} — ${one.detail.split(String.fromCharCode(10)).slice(0, 3).join(' | ')}`);
      }
    }
    const incidents = await readIncidents(page);
    for (const one of incidents) play.problems.push(`incident (${one.kind}): ${one.what} — ${one.detail.split('\n')[0] ?? ''}`);
  } finally {
    page.off('download', onDownload);
    page.off('console', onConsole);
    page.off('pageerror', onError);
  }
  for (const error of play.consoleErrors) play.problems.push(`console error: ${error}`);
  return play.problems;
}
