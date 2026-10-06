// The one entry point of every browser test: specs and the scenario runner import `test` and `expect` from here,
// never from '@playwright/test' directly (lint: a spec that imports them anywhere else fails). tests/support/editor.ts
// opens the editor once per test, in a fresh profile.
import { test as base, expect } from '@playwright/test';
import { COVERAGE, startCoverage, stopCoverage } from './coverage.ts';
import { guardScreen } from './screen-guard.ts';

// Every test ends by reading the incident feed of its page (src/core/incidents.ts, through the test port): a command
// that left a document the model refuses, one that claimed a structural change it did not make, or an error the page
// threw, fails the test that caused it — whatever the test itself asserted. A page the test closed or never opened
// the editor in has no feed to read.
// Every test also ends by reading the screen it leaves (tests/support/screen-guard.ts, DEC-74): a text cut, a one-line
// name on two lines, a control out of the window or under another part of the editor fails the test that drew it.
export const test = base.extend<{ incidentGuard: undefined; coverage: undefined; screenGuard: undefined }>({
  screenGuard: [
    async ({ page }, use, info) => {
      await use(undefined);
      const found = await guardScreen(page, info);
      expect(found, 'what the screen shows wrong at the end of the test (tests/support/screen-guard.ts)').toEqual([]);
    },
    { auto: true },
  ],
  // with E2E_COVERAGE=1, what the test executed of the editor, for npm run e2e:affected (tests/support/coverage.ts)
  coverage: [
    async ({ page }, use, info) => {
      if (!COVERAGE) {
        await use(undefined);
        return;
      }
      await startCoverage(page);
      await use(undefined);
      if (!page.isClosed()) await stopCoverage(page, info).catch(() => undefined);
    },
    { auto: true },
  ],
  incidentGuard: [
    async ({ page }, use) => {
      await use(undefined);
      if (page.isClosed()) return;
      const found = await page
        .evaluate(() => (window as unknown as { __builderTestPort?: { incidents: () => unknown[] } }).__builderTestPort?.incidents() ?? [])
        .catch(() => []);
      expect(found, 'the incident feed of the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Download, Locator, Page, TestInfo } from '@playwright/test';
