// What the core asks of the browser it runs in (plan I.6: the core holds no DOM, its ports are injected): reading an
// HTML text into the core's own tree of tags, attributes and texts, and an image's intrinsic size. The app installs the
// browser's own readers (src/editor/browser-ports.ts) before the editor starts; the unit tests install the same over
// happy-dom (tools/test/setup-browser.ts). A reader asked for before one is installed is a defect of the wiring.
import type { MarkupChild, MarkupPage, PageHead } from '../import/markup.ts';
import type { CapturedElement } from '../document/captured.ts';
import type { IdGenerator } from './ids.ts';

export interface BrowserPorts {
  // the markup's own elements and texts, as a browser parses a fragment
  readonly fragment: (markup: string) => readonly MarkupChild[];
  // a whole page's head, title, html and body attributes, and body
  readonly page: (markup: string) => MarkupPage;
  // what a page's head says of it (its language, direction, title, stylesheets and scripts)
  readonly head: (markup: string) => PageHead;
  // a full parsed DOM snapshot for a captured page, retaining text order and namespaces
  readonly capturedTree: (markup: string, ids: IdGenerator) => CapturedElement;
  // an image's intrinsic size, or null when the browser cannot draw it
  readonly imageSize: (bytes: string, type: string) => Promise<{ readonly width: number; readonly height: number } | null>;
}

let installed: BrowserPorts | null = null;

export function installBrowserPorts(ports: BrowserPorts): void {
  installed = ports;
}

export function browserPorts(): BrowserPorts {
  if (installed === null) throw new Error('the browser ports are not installed (src/editor/browser-ports.ts)');
  return installed;
}
