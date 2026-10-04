// Opening a web address (the plan's stage 12; spec capture-url): File › Open a web address… asks for an address, and
// the Builder Companion (tools/companion, `npm run companion`), a local process the browser cannot be, opens it in the
// installed Chrome and hands back a static copy of the page as files; those go through File › Import HTML as if they
// had been picked (project.importHtml: its destinations dialog, then the page, its classes and its files). The one
// owner of:
//  - project.captureUrl: an http or https address becomes the editor's capture request (ui.capture), the dialog
//    closing; anything else is refused before any request;
//  - installCapture: each new request is sent to the Companion; its files are read as picked files and imported; a
//    Companion that does not answer, or a page it could not capture, is said in the status bar.
import { message, registerHandler } from '../../core/commands/registry.ts';
import { readPickedFiles } from '../../core/import/import.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId } from '../../generated/ids.ts';
import type { EditorUi } from '../state.ts';
import type { EditorStore } from '../store.ts';
import { manifest } from '../../manifest/runtime.ts';

// File › Import HTML's command, which the captured files go through (its picked files and its destinations)
const IMPORT = manifest.commands.find((c) => 'files' in c.args && 'destination' in c.args)?.id;

// where the Companion answers (tools/companion/server.ts: 127.0.0.1, COMPANION_PORT, 5410 by default)
export const COMPANION = 'http://127.0.0.1:5410';

export interface CaptureRequest {
  readonly url: string;
  readonly count: number;
  // how many pages of the site to follow from the address (1: the page alone)
  readonly pages?: number;
}
// the most pages one capture follows (tools/companion/capture.ts)
export const MOST_PAGES = 30;

// an address a person types: a bare host is read as https, but this machine's (localhost, an IP address) as http
export function captureAddress(typed: string): string | null {
  const text = typed.trim();
  if (text === '') return null;
  const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(text);
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${local ? 'http' : 'https'}://${text}`);
    const web = url.protocol === 'http:' || url.protocol === 'https:';
    const host = url.hostname.includes('.') || url.hostname === 'localhost';
    return web && host ? url.href : null;
  } catch {
    return null;
  }
}

export const captureUrlCommand = registerHandler<'project.captureUrl', EditorUi>('project.captureUrl', ({ state }, { url, pages = 1 }) => {
  const address = captureAddress(url);
  if (address === null) return { kind: 'refused', message: message('status.capture.invalidUrl', { url: url.trim() }) };
  if (!Number.isInteger(pages) || pages < 1 || pages > MOST_PAGES) return { kind: 'refused', message: message('status.capture.badPages', { pages: String(pages) }) };
  const { dialog: _dialog, ...ui } = state.ui;
  void _dialog;
  return { kind: 'change', ui: { ...ui, capture: { url: address, count: (state.ui.capture?.count ?? 0) + 1, pages } }, message: message('status.capture.running', { url: address }) };
});

interface Answer {
  readonly title?: string;
  readonly files?: readonly { readonly path: string; readonly type: string; readonly base64: string }[];
  readonly error?: string;
  readonly errorCode?: string;
}

const fileOf = (one: { readonly path: string; readonly type: string; readonly base64: string }): File => {
  const binary = atob(one.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // the path rides in the name, as a folder's files do when they are picked (import.ts pickedFilePath)
  return new File([bytes], one.path, { type: one.type });
};

export function installCapture(store: EditorStore, companion = COMPANION): () => void {
  let done = store.getState().ui.capture?.count ?? 0;
  let alive = true;
  const run = async (request: CaptureRequest) => {
    let answer: Answer;
    try {
      const response = await fetch(`${companion}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: request.url, pages: request.pages ?? 1 }) });
      answer = (await response.json()) as Answer;
    } catch {
      if (alive) store.notice(message('status.capture.noCompanion'));
      return;
    }
    if (!alive) return;
    if (answer.files === undefined || answer.files.length === 0) {
      if (answer.errorCode === 'challenge') {
        store.notice(message('status.capture.challenge'));
        return;
      }
      store.notice(message('status.capture.failed', { url: request.url, reason: answer.error ?? '' }));
      return;
    }
    const picked = await readPickedFiles(answer.files.map(fileOf));
    if (!alive) return;
    if (IMPORT !== undefined) (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(IMPORT as CommandId, { files: picked });
  };
  const stop = store.subscribe(() => {
    const request = store.getState().ui.capture;
    if (request === undefined || request.count === done) return;
    done = request.count;
    void run(request);
  });
  return () => {
    alive = false;
    stop();
  };
}
