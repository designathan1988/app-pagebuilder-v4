// The unit tests run the editor with the app's wiring, as the app does (src/editor/wiring.ts, src/main.tsx).
import { EDITOR_WIRING } from '../../src/app/wiring.ts';
import { installWiring } from '../../src/editor/wiring.ts';

installWiring(EDITOR_WIRING);
