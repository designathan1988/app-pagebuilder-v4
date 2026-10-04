// The capture corpus's browser runs (STG-12.6): each width uses a same-load live screenshot and
// DOM snapshot. The HAR supplies resource bytes and is replayed only as a separate diagnostic.
// The captured package is imported, exported and compared with the live source at each width.
// One installed Chrome worker writes records, DOM/layout observations and the automatic boundary audit.
import { defineConfig } from '@playwright/test';
import { CHANNEL } from '../runner/environment.ts';

const port = process.env.CORPUS_PORT ?? '5344';

export default defineConfig({
  testDir: '.',
  testMatch: /corpus\.capture\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [['list']],
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    channel: CHANNEL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: Number(port),
    env: { PORT: port, E2E_BUILD: '1' },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
