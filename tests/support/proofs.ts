// The test-support entry (playwright.config.ts, vite.proofs.config.ts): the app's own modules the browser-side
// proofs run against the built app, re-exported so a test can load them from the served build (`/proofs.js`) the way
// it used to load them from the dev server's source URLs. It carries no behaviour of its own: every name below is
// the app's. Built only for the e2e run (`npm run build:proofs`), never part of the app's entry.
export * from '../../src/editor/canvas/coordinates.ts';
export { PageRenderer, renderModelFromManifest } from '../../src/editor/canvas/render/render.ts';
export { applyPatches } from '../../src/core/history/transaction.ts';
export { translate } from '../../src/i18n/index.ts';
