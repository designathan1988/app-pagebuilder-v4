// The preview (preview-bar; spec preview-mode): while the editor previews
// (view/preview.ts), the preview bar replaces the top bar (its doors: the breakpoints, Exit preview, Export) and the
// page is shown as it is exported (core/export/export.ts previewPage), at the active breakpoint's width and at 100 %,
// in a frame of its own that runs it as a browser would (its scripts and embeds, its hover and details) and opens its
// links in a new tab:
// sandboxed, never the editing canvas. No selection, guides, handles, docks or rulers are drawn.
import { useEffect, useMemo, useRef } from 'react';
import { previewPage } from '../../core/export/export.ts';
import { siteScripts } from '../forms/script.ts';
import { openedPage } from '../../core/project/pages.ts';
import { viewportWidth } from '../view/breakpoints.ts';
import { MODEL_RULES, useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { Slots } from './slots.tsx';
import { breakpointTabSlot, PreviewBreakpointTab } from './breakpoint-tabs.tsx';

export function PreviewBar() {
  return (
    <header className="preview-bar" data-region="preview-bar" data-key-context="preview">
      <Slots region="preview-bar" render={(slot) => breakpointTabSlot('preview-bar', slot, (entry, breakpoint, args) => <PreviewBreakpointTab key={`${entry.ref}:${breakpoint.id}`} entry={entry} breakpoint={breakpoint} args={args} />)} />
    </header>
  );
}

export function PreviewPage() {
  const t = useT();
  const document = useEditorState((s) => s.document);
  const width = useEditorState((s) => viewportWidth(s));
  // the page the editor has open, never the project's first: previewing a second page must show that page (the
  // interface audit F03), and the memo re-runs when the open page changes
  const page = useEditorState((s) => openedPage(s));
  const html = useMemo(() => withKeyRelay(previewPage(document, MODEL_RULES, page, siteScripts)), [document, page]);
  const frame = useRef<HTMLIFrameElement>(null);
  // a key the page relays (KEY_RELAY) is pressed again on the preview bar, in the preview's key context, so the keymap
  // runs its door as if the editor had the focus
  useEffect(() => {
    const relay = (event: MessageEvent) => {
      // only the preview frame's own window is heard (the audit's AUD-10: every sandboxed frame reads the opaque origin
      // "null", an embed sandboxed inside the page as well, so the origin alone named no one; MDN, postMessage: check
      // the sender), and only the two keys it relays
      // eslint-disable-next-line builder/frame-owner -- the preview's own frame: its window is compared, never read
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const key = relayedKey((event.data as { builderPreviewKey?: unknown } | null)?.builderPreviewKey);
      const bar = window.document.querySelector('[data-region="preview-bar"]');
      if (key === null || bar === null) return;
      bar.dispatchEvent(new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true }));
    };
    window.addEventListener('message', relay);
    return () => window.removeEventListener('message', relay);
  }, []);
  return (
    <main className="preview-stage">
      <iframe ref={frame} className="preview__page" data-region="preview-page" title={t('preview.pageLabel')} srcDoc={html} sandbox="allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox" style={{ width }} />
    </main>
  );
}

// The page runs sandboxed in its own origin, so the editor hears none of its keys: once a visitor clicked in it, Escape
// (and Ctrl+Enter) no longer left the preview (the dogfooding pass). The preview's page alone — never the export —
// relays those two to the editor, unless the page uses Escape itself (a modal dialog open in it closes first).
const KEY_RELAY = `<script>addEventListener('keydown', function (e) {
  var leave = e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey));
  if (!leave || (e.key === 'Escape' && document.querySelector('dialog:modal'))) return;
  parent.postMessage({ builderPreviewKey: { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey } }, '*');
}, true);</script>`;
// the key a message relays, read field by field: Escape, or Enter with Ctrl or Cmd, as KEY_RELAY sends them
function relayedKey(sent: unknown): KeyboardEventInit | null {
  if (sent === null || typeof sent !== 'object') return null;
  const { key, code, ctrlKey, metaKey, shiftKey, altKey } = sent as Record<string, unknown>;
  if (key !== 'Escape' && key !== 'Enter') return null;
  const flag = (value: unknown): boolean => value === true;
  return { key, code: typeof code === 'string' ? code : '', ctrlKey: flag(ctrlKey), metaKey: flag(metaKey), shiftKey: flag(shiftKey), altKey: flag(altKey) };
}

const withKeyRelay = (html: string): string => (html.includes('</body>') ? html.replace('</body>', `${KEY_RELAY}</body>`) : html + KEY_RELAY);
