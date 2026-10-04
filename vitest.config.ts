import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'builder:glob-modules-uncached',
      // The persistent module cache hashes a file's own source, so a module that reads a folder through
      // import.meta.glob (the manifest's command files) would keep its old file list when a file is added there.
      // Such modules are transformed on every run (Vitest's cache key generator: false disables the cache).
      configureVitest(context) {
        context.defineCacheKeyGenerator(({ sourceCode }) => (sourceCode.includes('import.meta.glob') ? false : undefined));
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/**/*.test.ts'],
    // Never collect tests from the reference projects, the Pager copy or the browser tool's scratch files.
    exclude: [...configDefaults.exclude, 'reference/**', '.cache/**', '.playwright-mcp/**'],
    environment: 'node',
    // the language the tests run in, pinned (tools/test/setup-language.ts)
    setupFiles: ['tools/test/setup-language.ts', 'tools/test/setup-browser.ts', 'tools/test/setup-wiring.ts'],
    // the transformed modules are kept between runs: a run re-transforms only what changed
    fsModuleCache: true,
    // half the cores at most: the machine stays usable while the tests run
    maxWorkers: '50%',
    // What the unit tests and the fast scenario runner reach of the document core and the editor's modules, line by line
    // and branch by branch (.cache/coverage/index.html; the summary in the terminal). npm run unit measures it on every
    // check:fast and fails when it falls under the floors, which are raised as tests are added, never lowered.
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/editor/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/core/testing/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: '.cache/coverage',
      thresholds: { statements: 56, branches: 44, functions: 60, lines: 60 },
    },
  },
});
