// Opening the editor for a browser test, in one place (docs/PRODUCT.md, How to prove): every test runs in a new browser
// context, a fresh profile with nothing stored, so the editor is loaded once. The tests used to load it, clear its
// storage and load it again (37 copies of the same three lines), which cost 11% of the scenario tests' CPU; the
// fresh profile is now proven instead of assumed: what the page had stored before any of its scripts ran is read.
import { expect, type Page } from '@playwright/test';

const STORED_AT_START = '__storedAtStart';

export async function openEditor(page: Page, options: { readonly reusedProfile?: boolean } = {}): Promise<void> {
  await page.addInitScript((key) => {
    // before the editor's own scripts: what a previous load of this profile would have left
    (window as unknown as Record<string, unknown>)[key] = { local: window.localStorage.length, session: window.sessionStorage.length };
  }, STORED_AT_START);
  await page.goto('/');
  const stored = await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], STORED_AT_START);
  // a second page shares its context's profile: what the first page wrote is expected there
  if (options.reusedProfile !== true) expect(stored, 'the editor opens in a fresh profile: nothing was stored before it loaded').toEqual({ local: 0, session: 0 });
  // the editor is drawn before the test reads or acts on it: under load a test that snapshots the editor at once took
  // its "before" from an empty page (panels.spec.ts)
  await expect(page.locator('.workbench')).toBeVisible();
}
