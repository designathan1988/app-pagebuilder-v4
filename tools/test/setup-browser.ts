// The unit tests read markup and images through the core's browser port as the app does (src/core/ports/browser.ts):
// the browser's own readers, over happy-dom in the tests that ask for it (a test in Node that reads markup without
// happy-dom fails as it did when the core called the parser itself).
import { installBrowserPorts } from '../../src/core/ports/browser.ts';
import { browserPorts } from '../../src/editor/browser-ports.ts';

installBrowserPorts(browserPorts);
