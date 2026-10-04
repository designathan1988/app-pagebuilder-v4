// Read-only diagnosis: npm run capture:diagnose -- <site-id> <1440|1180|834|390> [export|stability].
// Uses live reference geometry, then either the measured export or an independent second live load.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { WIDTHS } from '../journey/fidelity.ts';
import { readReferenceManifest, readReferenceSnapshot } from './reference.ts';
import { diagnosePictures } from './diagnose.ts';

const [id, typedWidth, mode = 'export'] = process.argv.slice(2);
const sites = (JSON.parse(fs.readFileSync('tools/capture/corpus.json', 'utf8')) as { sites: { id: string; url: string }[] }).sites;
const site = sites.find((one) => one.id === id);
const width = Number(typedWidth);
if (site === undefined || !WIDTHS.includes(width as typeof WIDTHS[number]) || !['export', 'stability'].includes(mode)) throw new Error('usage: npm run capture:diagnose -- <corpus-site-id> <1440|1180|834|390> [export|stability]');
const out = path.join('.cache', 'corpus', site.id);
const har = path.join('.cache', 'corpus', 'har', `${site.id}.har`);
const reference = path.join('.cache', 'corpus', 'references', site.id);
const original = fs.readFileSync(path.join(reference, `original-${width}.png`));
const manifest = readReferenceManifest(site.url, har, reference);
const entry = manifest.widths.find((one) => one.width === width);
if (entry === undefined) throw new Error(`No live reference for ${site.id} at ${width}px`);
const exported = fs.readFileSync(mode === 'stability' ? path.join(reference, entry.repeat) : path.join(out, `export-${width}.png`));
const originalLayout = readReferenceSnapshot(site.url, har, reference, width).layout;
const exportLayout = JSON.parse(fs.readFileSync(mode === 'stability' ? path.join(reference, entry.repeatLayout) : path.join(out, `export-layout-${width}.json`), 'utf8')) as typeof originalLayout;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const result = await diagnosePictures(page, original, exported, originalLayout, exportLayout, path.join(mode === 'stability' ? reference : out, `${mode === 'stability' ? 'stability-diff' : 'diff'}-${width}`), width);
  console.log(JSON.stringify({ site: site.id, width, mode, firstDifferentRow: result.firstDifferentRow, firstBand: result.firstBand,
    originalElement: result.originalElement, exportElement: result.exportElement, horizontalOverflow: result.horizontalOverflow.slice(0, 3) }, null, 2));
} finally {
  await browser.close();
}
