// Family CA1 of the code audit (2026-10-04): a captured page keeps its content in its snapshots and its root holds no
// element (validate.ts), so no command places an element there: it is refused with words, before any patch. The
// invariant probe (seeds 4101 to 4606, fixture captured-mixed) found element.insert with nothing selected on a captured
// page refused as an invalid document instead.
import { describe, expect, it } from 'vitest';
import type { DocumentJson } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { insertCommand } from '../structure/insert.ts';
import { pasteCommand } from '../clipboard/clipboard.ts';

const captured = (): DocumentJson =>
  documentOf({
    pages: [
      { id: 'home', name: 'Home', file: 'index.html', tree: node('Home-root', 'page', 'body') },
      {
        id: 'shot',
        name: 'Shot',
        file: 'shot.html',
        tree: node('Shot-root', 'page', 'body'),
        capture: { widths: [1440], root: { kind: 'element', id: 'h', namespace: 'http://www.w3.org/1999/xhtml', tag: 'html', attributes: [], children: [] } },
      },
    ],
  });

describe('a captured page takes no element (CA1)', () => {
  it('an insert with the captured page open is refused with words', () => {
    const ran = runHandler(insertCommand, captured(), { entry: 'paragraph' }, { ui: { page: 'shot' } });
    expect(ran.outcome).toMatchObject({ kind: 'refused', message: { key: 'status.capture.noElements' } });
  });

  it('a paste with the captured page open is refused with words', () => {
    const ran = runHandler(pasteCommand, captured(), { clipboard: { status: 'read', text: 'hello', html: null, markup: null } }, { ui: { page: 'shot' } });
    expect(ran.outcome).toMatchObject({ kind: 'refused', message: { key: 'status.capture.noElements' } });
  });
});
