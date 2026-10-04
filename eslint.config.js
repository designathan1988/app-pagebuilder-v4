import css from '@eslint/css';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import builder, { builderCss } from './tools/lint/plugin.ts';

// The generated tokens (PRODUCT.md §5, Tokens): the one stylesheet that writes colours, spacing, sizes, radii,
// shadows and font values.
const TOKENS = 'src/ui/tokens.css';

export default defineConfig(
  // .cache holds the running Pager copy, .playwright-mcp the browser tool's scratch files and .claude the agents'
  // worktrees; none is project code. tests/support/folders holds the sample folders a scenario opens with File ›
  // Open folder (spec explorer-open-folder): those files are the person's own site, kept as they were written.
  globalIgnores(['dist', 'reference', '.cache', '.playwright-mcp', '.claude', 'node_modules', 'test-results', 'playwright-report', 'tests/support/folders']),
  // The audit journeys (jornada*/) hold the auditors' capture scripts and evidence, not project code.
  globalIgnores(['jornada01', 'jornada02', 'jornada03']),
  // Third-party code shipped as it was published (the Lottie player, minified, with its licence): never edited here.
  globalIgnores(['src/**/vendor/**']),
  // the browser extension as built (npm run extension:build): generated from companion/extension/src
  globalIgnores(['companion/extension/dist']),
  // worktrees; none is project code. The fixtures are the scenarios' own input (a page HTML, its stylesheet, its
  // script…), data and not source: they are never edited to suit a test.
  globalIgnores(['dist', 'reference', '.cache', '.playwright-mcp', '.claude', 'node_modules', 'test-results', 'playwright-report', 'manifest/features/fixtures']),
  {
    // The JavaScript and TypeScript rules. Stylesheets are linted by their own language below.
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strict],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // Source reads as source (the audit's AUD-32: minified-style files held several statements a line and lines past
    // 200 characters): one statement a line, a comment within 120 characters, a line of code within 250 (a ceiling
    // that later work lowers). Strings, templates, regular expressions, addresses and a test environment's options (a
    // JSON object that must stay on its line) are left as written. These are ESLint's own rules, deprecated in favour
    // of @stylistic's and kept until ESLint 11.
    files: ['src/**/*.{ts,tsx}', 'tools/**/*.ts'],
    rules: {
      'max-statements-per-line': ['error', { max: 1 }],
      'max-len': ['error', { code: 250, comments: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignorePattern: String.raw`^\s*// (\{|@vitest-environment-options)` }],
    },
  },
  {
    // the browser extension runs in Chrome's extension pages and service worker, with the chrome.* APIs
    files: ['companion/extension/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly' } },
  },
  {
    files: ['*.config.{js,ts}', '.dependency-cruiser.cjs', 'tests/**/*.ts', 'tools/**/*.ts', 'companion/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Every browser test comes through tests/support/test.ts, whose fixture records what the test depends on for the
    // limited validation (docs/PRODUCT.md, How to prove): a test built on '@playwright/test' directly would be invisible to it.
    files: ['tests/e2e/**/*.ts', 'tools/runner/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: '@playwright/test', importNames: ['test', 'expect'], message: 'Import test and expect from tests/support/test.ts.' }] }],
    },
  },
  {
    // The time is read only through the Clock port and ids come only from the IdGenerator port (PRODUCT.md §5).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/ports/clock.ts', 'src/core/ports/ids.ts'],
    plugins: { builder },
    rules: { 'builder/use-ports': 'error' },
  },
  {
    // Pointer, mouse and drag input belongs to the pointer owner (PRODUCT.md §5, Pointer input): the pointer
    // machine and the OS file drop it owns (input/file-drop.ts, split out of it).
    files: ['src/**/*.{ts,tsx}'],
    // the motion runtime is the page's own script (spec motion-runtime): its triggers listen to the page's pointer
    ignores: ['src/editor/input/pointer.ts', 'src/editor/input/pointer/**', 'src/editor/input/file-drop.ts', 'src/editor/motion/runtime/**'],
    plugins: { builder },
    rules: { 'builder/pointer-owner': 'error' },
  },
  {
    // A gesture's transaction is opened by the pointer owner's doors, never by a handler (the owner is pointer.ts and
    // its parts, pointer/*.ts); the store's own tests open gestures to prove them, and the editor's store wraps the
    // core store's gesture so that one never overlaps a command group (src/editor/store.ts, the audit's GB1).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/editor/input/pointer.ts', 'src/editor/input/pointer/**', 'src/editor/store.ts', 'src/**/*.test.ts'],
    plugins: { builder },
    rules: { 'builder/gesture-owner': 'error' },
  },
  {
    // Keys belong to the keymap, which runs the manifest's shortcut doors (PRODUCT.md §5, Keymap).
    files: ['src/**/*.{ts,tsx}'],
    // the motion runtime is the page's own script (spec motion-runtime): its key trigger listens to the page's keys
    ignores: ['src/editor/input/keymap.ts', 'src/editor/motion/runtime/**'],
    plugins: { builder },
    rules: { 'builder/keyboard-owner': 'error' },
  },
  {
    // Commands, doors and edited properties come from the manifest's data; the generated lists, the manifest's own
    // reader and checker, the command table and the tests name them.
    files: ['src/**/*.{ts,tsx}'],
    // (the motion runtime is the page's own script: the CSS properties it writes are the page's, not the editor's)
    ignores: ['src/generated/**', 'src/manifest/**', 'src/app/commands.ts', 'src/app/commands.typecheck.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/editor/motion/runtime/**'],
    plugins: { builder },
    rules: { 'builder/no-manifest-id': 'error' },
  },
  {
    // Only the renderer writes the canvas iframe's page (PRODUCT.md §5, Renderer); its tests build pages of their own.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/editor/canvas/render/render.ts', 'src/**/*.test.ts'],
    plugins: { builder },
    rules: { 'builder/frame-owner': 'error' },
  },
  {
    // UI text comes only from t() and the i18n catalogues, and style objects take their values from the tokens.
    files: ['src/**/*.tsx'],
    plugins: { builder },
    rules: {
      'builder/no-literal-ui-string': 'error',
      'builder/use-tokens': ['error', { tokens: TOKENS }],
    },
  },
  {
    // Every stylesheet but the generated tokens reads its colours, spacing, sizes, radii, shadows and font values
    // from the tokens.
    files: ['src/**/*.css'],
    ignores: [TOKENS],
    language: 'css/css',
    plugins: { css, 'builder-css': builderCss },
    rules: { 'builder-css/use-tokens': ['error', { tokens: TOKENS }] },
  },
  {
    // The document core stays plain TypeScript so it can run and be tested without React.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/core is plain TypeScript and must not import React.',
            },
          ],
        },
      ],
      // no DOM in the core (plan I.6; tsconfig.core.json compiles it without the DOM library): what it needs of the
      // browser comes through its ports (src/core/ports/browser.ts, the layout and CSS ports)
      'no-restricted-globals': [
        'error',
        ...['document', 'window', 'DOMParser', 'Image', 'Node', 'Element', 'HTMLElement', 'getComputedStyle', 'localStorage', 'sessionStorage', 'navigator', 'requestAnimationFrame'].map((name) => ({
          name,
          message: 'src/core holds no DOM: ask the browser through a port (src/core/ports).',
        })),
      ],
    },
  },
  {
    // The editor and the modules never import the wiring (plan I.9): the command table and the installed modules'
    // editor side come through the editor's port (src/editor/wiring.ts), the feature table through the core's registry.
    // Their tests build stores from the app's own tables.
    files: ['src/editor/**/*.{ts,tsx}', 'src/modules/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/app/*'], message: 'The editor receives the wiring through src/editor/wiring.ts; it never imports src/app.' }] }],
    },
  },
  {
    // A removable module reaches the editor, the core, the manifest and the generated lists through its host API only
    // (plan I.10: src/editor/host.ts; its tests also src/editor/host-testing.ts), never by a deep import.
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/**', '**/editor/**', '**/manifest/**', '**/generated/**', '**/app/**', '!**/editor/host.ts', '!**/editor/host-testing.ts'],
              message: 'A module imports src/editor/host.ts (its tests src/editor/host-testing.ts), never a deeper file.',
            },
          ],
        },
      ],
    },
  },
  {
    // only a module's tests use the test doubles
    files: ['src/modules/**/*.{ts,tsx}'],
    ignores: ['src/modules/**/*.test.ts', 'src/modules/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/**', '**/editor/**', '**/manifest/**', '**/generated/**', '**/app/**', '!**/editor/host.ts'],
              message: 'A module imports src/editor/host.ts, never a deeper file; the test doubles are for its tests.',
            },
          ],
        },
      ],
    },
  },
  {
    // the core's test helpers run in happy-dom with the tests
    files: ['src/core/testing/**/*.ts', 'src/core/**/*.test.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
