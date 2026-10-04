// Family CP1 of the code audit (2026-10-04): a copy keeps every field of what it copies. A captured page's content is
// its snapshots and its residual stylesheet; Duplicate built the copy from its tree alone, an empty page.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { duplicatePageCommand } from './pages.ts';

describe('a copy keeps what it copies (CP1)', () => {
  it('a duplicated captured page holds the snapshots and its own residual stylesheet', () => {
    const root = { kind: 'element' as const, id: 'h', namespace: 'http://www.w3.org/1999/xhtml', tag: 'html', attributes: [], children: [] };
    const document = documentOf({
      pages: [{ id: 'shot', name: 'Shot', file: 'shot.html', tree: node('Shot-root', 'page', 'body'), capture: { viewports: [{ width: 1440, root }] } }],
      files: [{ path: 'shot.capture.css', type: 'text/css', bytes: btoa('body{color:red}') }],
    });
    const ran = runHandler(duplicatePageCommand, document, { page: 'shot' });
    expect(ran.problems).toEqual([]);
    const copy = ran.document.pages[1];
    expect(copy?.capture?.viewports[0]?.root.tag).toBe('html');
    expect(ran.document.files?.map((one) => one.path)).toContain(`${copy?.file.replace(/\.html$/, '')}.capture.css`);
  });
});
