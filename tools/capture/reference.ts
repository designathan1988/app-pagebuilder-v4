// A corpus reference is photographed from the live site during HAR recording, at a viewport set before each
// navigation. Replaying a HAR with an absent image produces a degraded page, so replay is never the target image.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { CaptureChallengeError, isChallengeResponse, markRuntime, readRuntimeSnapshot, settle, type InlineSnapshot, type SettleResult } from '../companion/capture.ts';
import { serializePage, type PageRead } from '../companion/serialize.ts';
import { completeOpaquePaint } from '../companion/paint.ts';
import { comparePictures } from '../journey/fidelity.ts';

export const REFERENCE_TIME = '2026-10-04T12:00:00.000Z';
const REFERENCE_SEED = 0x4b1d5e7a;

export async function seedSiteScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript((seed: number) => {
    let state = seed >>> 0;
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }, REFERENCE_SEED);
}

// The page's clock starts at the reference moment and runs. A fixed time (setFixedTime) freezes Date only while timers
// keep running, so a script that measures elapsed time with Date.now() never finishes: allbirds' entrance kept its hero
// at opacity 0 in every reference (Playwright, Clock: "timers depend on Date.now and are confused when the Date.now
// value does not change over time... install the clock"; https://playwright.dev/docs/clock).
export async function startSiteClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(REFERENCE_TIME) });
}

// Before another navigation: the clock runs again from the reference moment.
export async function restartSiteClock(page: Page): Promise<void> {
  await page.clock.resume();
  await page.clock.setSystemTime(new Date(REFERENCE_TIME));
}

// Time stops while the page is photographed and read. Playwright's pauseAt refuses a past moment, and the page's time
// has run since its reference moment: it pauses a second after the page's own now.
export async function pauseSiteClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1_000));
}

async function settledSnapshot(page: Page): Promise<{ readonly bytes: Buffer; readonly state: SettleResult }> {
  const state = await settle(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await pauseSiteClock(page);
  return { bytes: await page.screenshot({ fullPage: true }), state };
}

export interface RecordedObservation {
  readonly width: number;
  readonly read: PageRead;
  readonly inline: readonly InlineSnapshot[];
  readonly layout: readonly CapturedBox[];
  readonly settle?: SettleResult;
}

export interface CapturedBox {
  readonly path: string;
  readonly capturePath: string | null;
  readonly tag: string;
  readonly id: string | null;
  readonly classes: string;
  readonly directText: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly display: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly position: string;
  readonly computed?: Readonly<Record<string, string>>;
}

export async function readLayoutSnapshot(page: Page, includeAll = false): Promise<CapturedBox[]> {
  return page.evaluate((all) => {
    const elements = [document.documentElement, document.body, ...document.body.querySelectorAll<HTMLElement>(all ? '*' : '[data-capture-runtime]')];
    const domPath = (element: Element): string => {
      const parts: number[] = [];
      for (let current: Element | null = element; current !== null && current !== document.body; current = current.parentElement) {
        const parent: Element | null = current.parentElement;
        if (parent === null) break;
        parts.unshift([...parent.children].indexOf(current));
      }
      return parts.join('.');
    };
    return elements.map((element) => {
      const rectangle = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const names = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'width', 'height', 'min-width', 'max-width', 'object-fit', 'fill', 'stroke', 'opacity', 'transform', 'grid-template-columns', 'flex-direction'];
      const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.nodeValue ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      return {
        path: element === document.documentElement ? 'html' : element === document.body ? 'body' : element.getAttribute('data-capture-runtime') ?? domPath(element),
        capturePath: element.getAttribute('data-capture-runtime'),
        tag: element.localName, id: element.getAttribute('id'), classes: element.getAttribute('class') ?? '', directText,
        bounds: { x: rectangle.x + scrollX, y: rectangle.y + scrollY, width: rectangle.width, height: rectangle.height },
        display: style.display, overflowX: style.overflowX, overflowY: style.overflowY, position: style.position,
        computed: Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)])),
      };
    });
  }, includeAll);
}

export interface ReferenceManifest {
  // format 7: the page observed as a tree of nodes, its clock running from the reference moment (DEC-61)
  readonly format: 7;
  readonly source: 'live-navigation';
  readonly url: string;
  readonly recordedAt: string;
  readonly harSha256: string;
  readonly widths: readonly {
    readonly width: number;
    readonly file: string;
    readonly sha256: string;
    readonly finalUrl: string;
    readonly snapshot: string;
    readonly snapshotSha256: string;
    readonly repeat: string;
    readonly repeatSha256: string;
    readonly repeatLayout: string;
    readonly repeatLayoutSha256: string;
    readonly stabilityMatch: number;
    readonly settle: SettleResult;
    readonly repeatSettle: SettleResult;
  }[];
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

// Record each initial viewport from a fresh navigation in one HAR-writing context. Service workers are blocked
// because Playwright cannot replay requests they intercept from a HAR (Playwright BrowserContext.routeFromHAR).
export async function recordReference(browser: Browser, url: string, har: string, reference: string, widths: readonly number[]): Promise<ReferenceManifest> {
  if (widths.length === 0 || widths.some((width) => !Number.isInteger(width) || width <= 0) || new Set(widths).size !== widths.length) {
    throw new Error('reference widths must be unique positive integers');
  }
  fs.mkdirSync(path.dirname(har), { recursive: true });
  fs.mkdirSync(reference, { recursive: true });
  const pending = fs.mkdtempSync(path.join(reference, '.recording-'));
  const pendingHar = path.join(pending, 'site.har');
  const context = await browser.newContext({ viewport: { width: widths[0] as number, height: 900 }, locale: 'en-US', bypassCSP: true, serviceWorkers: 'block', recordHar: { path: pendingHar, content: 'embed' } });
  await seedSiteScripts(context);
  const page = await context.newPage();
  await startSiteClock(page);
  // Both independent visits advance through the same width sequence. This preserves equivalent HTTP caches,
  // cookies and localStorage without sharing a page or copying only part of browser state between loads.
  const repeatContext = await browser.newContext({ viewport: { width: widths[0] as number, height: 900 }, locale: 'en-US', bypassCSP: true, serviceWorkers: 'block' });
  await seedSiteScripts(repeatContext);
  const repeatPage = await repeatContext.newPage();
  await startSiteClock(repeatPage);
  const photographed: ReferenceManifest['widths'][number][] = [];
  try {
    for (const [index, width] of widths.entries()) {
      if (index > 0) {
        await restartSiteClock(page);
        await restartSiteClock(repeatPage);
      }
      await page.setViewportSize({ width, height: 900 });
      await repeatPage.setViewportSize({ width, height: 900 });
      if (isChallengeResponse(await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }))) throw new CaptureChallengeError(url);
      const file = `original-${width}.png`;
      const { bytes, state } = await settledSnapshot(page);
      fs.writeFileSync(path.join(pending, file), bytes);
      // The clock remains paused while both the reference photograph and the captured DOM/runtime values are read.
      await markRuntime(page);
      const read = await completeOpaquePaint(page, await page.evaluate(serializePage, new URL(url).origin), bytes);
      const observation: RecordedObservation = { width, read, inline: await readRuntimeSnapshot(page), layout: await readLayoutSnapshot(page), settle: state };
      const snapshot = `snapshot-${width}.json`;
      const snapshotBytes = Buffer.from(JSON.stringify(observation));
      fs.writeFileSync(path.join(pending, snapshot), snapshotBytes);

      if (isChallengeResponse(await repeatPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }))) throw new CaptureChallengeError(url);
      const { bytes: repeatBytes, state: repeatSettle } = await settledSnapshot(repeatPage);
      const repeat = `repeat-${width}.png`;
      fs.writeFileSync(path.join(pending, repeat), repeatBytes);
      await markRuntime(repeatPage);
      const repeatLayout = `repeat-layout-${width}.json`;
      const repeatLayoutBytes = Buffer.from(JSON.stringify(await readLayoutSnapshot(repeatPage)));
      fs.writeFileSync(path.join(pending, repeatLayout), repeatLayoutBytes);
      const compared = await comparePictures(repeatPage, repeatBytes.toString('base64'), bytes.toString('base64'));
      photographed.push({
        width, file, sha256: sha256(bytes), finalUrl: page.url(), snapshot,
        snapshotSha256: sha256(snapshotBytes), repeat, repeatSha256: sha256(repeatBytes),
        repeatLayout, repeatLayoutSha256: sha256(repeatLayoutBytes),
        stabilityMatch: compared.match, settle: state, repeatSettle,
      });
    }
  } finally {
    await repeatContext.close();
    await context.close();
  }
  const harBytes = fs.readFileSync(pendingHar);
  const manifest: ReferenceManifest = { format: 7, source: 'live-navigation', url, recordedAt: new Date().toISOString(), harSha256: sha256(harBytes), widths: photographed };
  fs.copyFileSync(pendingHar, har);
  for (const one of photographed) for (const file of [one.file, one.snapshot, one.repeat, one.repeatLayout]) fs.copyFileSync(path.join(pending, file), path.join(reference, file));
  // Last write makes a partially refreshed reference unusable rather than silently pairing old PNGs with a new HAR.
  fs.writeFileSync(path.join(reference, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readReferenceManifest(url: string, har: string, reference: string): ReferenceManifest {
  const file = path.join(reference, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`No live reference manifest for ${url}; re-record the site before measuring`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as ReferenceManifest;
  if (manifest.format !== 7 || manifest.source !== 'live-navigation' || manifest.url !== url) throw new Error(`Reference metadata does not name ${url} with same-load layout and equivalent live history`);
  if (sha256(fs.readFileSync(har)) !== manifest.harSha256) throw new Error(`Reference HAR changed for ${url}; re-record before measuring`);
  return manifest;
}

export function readReference(url: string, har: string, reference: string, width: number): Buffer {
  const manifest = readReferenceManifest(url, har, reference);
  const one = manifest.widths.find((entry) => entry.width === width);
  if (one === undefined) throw new Error(`No live reference for ${url} at ${width}px`);
  const bytes = fs.readFileSync(path.join(reference, one.file));
  if (sha256(bytes) !== one.sha256) throw new Error(`Reference PNG changed for ${url} at ${width}px`);
  return bytes;
}

export function readReferenceSnapshot(url: string, har: string, reference: string, width: number): RecordedObservation {
  const manifest = readReferenceManifest(url, har, reference);
  const one = manifest.widths.find((entry) => entry.width === width);
  if (one === undefined) throw new Error(`No same-load snapshot for ${url} at ${width}px`);
  const bytes = fs.readFileSync(path.join(reference, one.snapshot));
  if (sha256(bytes) !== one.snapshotSha256) throw new Error(`Captured DOM changed for ${url} at ${width}px`);
  return JSON.parse(bytes.toString('utf8')) as RecordedObservation;
}
