// The capture corpus's browser runs (the plan's stage 12, STG-12.6; npm run capture:corpus): each site of corpus.json
// recorded once into a HAR file and replayed from it, captured by the Companion's capture, imported into the editor
// with File › Import HTML, exported with File › Export, and the export's pictures compared with the original's at every
// breakpoint (tools/journey/fidelity.ts comparePictures). Against the e2e build, one site at a time, in the installed
// Chrome; the records go to .cache/corpus/records/, which tools/capture/report.ts turns into docs/CAPTURE-CORPUS.md.
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
