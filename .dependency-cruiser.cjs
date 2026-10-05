// The import graph's rules (plan phase I, item 8; docs/PRODUCT.md section 6): no module reaches itself back through
// what it imports, and no module imports a package that package.json does not list (dependency-cruiser's
// no-non-package-json, doc/rules-reference.md). Type-only imports are erased at compilation and are left out
// (tsPreCompilationDeps false).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A module imports, through others, a module that imports it back: one of them belongs lower.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'A package imported but not listed in package.json works only while another package happens to bring it in.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] },
  },
};
