// The import graph's rules (plan phase I, item 8; docs/PRODUCT.md section 6): no module reaches itself back through
// what it imports. Type-only imports are erased at compilation and are left out (tsPreCompilationDeps false).
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
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] },
  },
};
