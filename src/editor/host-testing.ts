// What a removable module's tests may use beyond the host API (src/editor/host.ts): the editor's store as the app makes
// it, and the test doubles of the core's ports. Only tests import it (eslint.config.js).
export { createEditorStore } from './store.ts';
export type { EditorStore } from './store.ts';
export type { PreferenceStorage } from './preferences/preferences.ts';
export { manualClock } from '../core/ports/clock.ts';
export { anyCss } from '../core/ports/css.ts';
export { sequentialIds } from '../core/ports/ids.ts';
export { noLayout } from '../core/ports/layout.ts';
export type { Layout } from '../core/ports/layout.ts';
export type { Rect } from '../generated/commands.ts';
