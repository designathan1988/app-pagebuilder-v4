// The code pane : the generated HTML, CSS or JS of the page the canvas shows,
// in the centre column beside or instead of the canvas (view/editor-view.ts). Its tabs, its copy and download buttons
// and its apply buttons are the code-view region's doors (manifest/commands); the lines are
// src/editor/code-panel/code-panel.ts's, each carrying the node it was written for, so the pane marks the selected
// element's lines and scrolls them into view, and a click on a line of the markup selects that element
// (spec code-panel-selection-sync).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useEditorState, MODEL_RULES } from '../store.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useT } from '../text.ts';
import { elementLines, paneKind, paneLines, ruleText, shownPane, type PaneKind } from '../code-panel/code-panel.ts';
import type { CodeLine } from '../../core/export/export.ts';
import { highlight, type Token } from '../code-panel/highlight.ts';

const PARTS = doorSlots('code-view');
// the key context the pane's editing surface owns (interactions.json): the editor's keys do not fire there
const CODE_EDITOR_CONTEXT = 'code-editor';

const PART = (control: string): DoorEntry | undefined => PARTS.find((p) => p.door.kind === 'panel-control' && p.door.control === control);
// the pane's editing surface: the field door a project's own file is edited through (files.saveContent)
const EDITOR_DOOR = PART('editor');
// The pane's tabs: the code-view region's pane-tab doors, in their placement order (their door stands for the part it
// shows, so the tab in force is marked).
// the kinds of file the pane's three tabs stand for; another file (a text file) is its own tab, named by its extension
const PANE_KINDS: ReadonlySet<string> = new Set(['html', 'css', 'js']);
const extensionOf = (path: string): string => (path.includes('.') ? (path.split('.').at(-1) ?? '') : path).toUpperCase();
const TABS = PARTS.filter((p) => p.door.kind === 'panel-control' && p.door.control === 'pane-tab');

function Line({ text, kind, node, selected, number, plain = false }: { readonly text: string; readonly kind: PaneKind; readonly node: string | null; readonly selected: boolean; readonly number: number; readonly plain?: boolean }) {
  const t = useT();
  const tokens: readonly Token[] = useMemo(() => highlight(text, kind), [text, kind]);
  const line = PART('html-line');
  // the line's tokens, and nothing else: the line's own text is what the file says, so the pane's lines joined are
  // the file's text (a trailing newline in the line box would double every line)
  const body = (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={`tok tok--${token.kind}`}>
          {token.text}
        </span>
      ))}
    </>
  );
  // A line of the element the pane edits is plain text: a caret must be able to stand in it, and a control inside an
  // editing surface cannot take one. Every other line is the door that selects the element it belongs to.
  if (plain || line === undefined || node === null) return <span className={selected ? 'code-line is-selected' : 'code-line'}>{body}</span>;
  return (
    // each line names itself (the audit's U-023: all 91 lines were named "Select")
    <DoorControl entry={line} args={{ target: node }} className={`code-line${selected ? ' is-selected' : ''}`} tabbable={false} label={t('codePanel.selectLine', { line: number })}>
      {body}
    </DoorControl>
  );
}

// The coloured lines, memoized: while the person types into the body, React must not render them again over what the
// browser put there (the pane reads the typed text back from the DOM when Apply hands it on).
const Drawn = memo(function Drawn({ lines, kind, marked, digits, mine }: { readonly lines: readonly CodeLine[]; readonly kind: PaneKind; readonly marked: readonly boolean[]; readonly digits: number; readonly mine: ReadonlySet<string> }) {
  return (
    <pre className="code-pane__code">
      {lines.map((line, i) => (
        <span className="code-row" key={i}>
          <span className="code-row__number" aria-hidden="true">
            {String(i + 1).padStart(digits, ' ')}
          </span>
          <Line text={line.text} kind={kind} node={line.node} selected={marked[i] === true} number={i + 1} plain={mine.size > 0 && line.node !== null && mine.has(line.node)} />
        </span>
      ))}
    </pre>
  );
});

export function CodePane() {
  const t = useT();
  // the store's own state parts, so the selectors stay referentially stable (a new array every read would loop)
  const ui = useEditorState((s) => s.ui);
  const document = useEditorState((s) => s.document);
  const selection = useEditorState((s) => s.selection);
  const kind = paneKind(ui);
  const info = useMemo(() => shownPane(ui, document, MODEL_RULES), [ui, document]);
  // the rule the CSS pane edits while one element is selected (code-panel-edit-css): the declarations the element holds
  // at the active breakpoint and state
  const rule = useMemo(() => ruleText({ document, selection }, MODEL_RULES), [document, selection]);
  // The pane's lines: the whole file, every line carrying the node it was written for — so the selected element's
  // lines are marked and scrolled to, and a click on any line selects its element (spec code-panel-selection-sync).
  // The CSS pane shows the element's own rule while one element is selected: its lines are those declarations.
  const file = useMemo(() => paneLines(ui, document, MODEL_RULES), [ui, document]);
  const lines = useMemo(() => (kind === 'css' && rule !== null ? rule.split('\n').map((text) => ({ text, node: null })) : file), [kind, rule, file]);
  // the element the pane edits while the whole file is shown: its own lines are the range Apply hands the command
  const own = useMemo(() => elementLines({ document, selection }, MODEL_RULES), [document, selection]);
  const body = useRef<HTMLDivElement>(null);

  // the selected element's lines: the pane scrolls the first of them into view (spec code-panel-selection-sync)
  const first = selection[0] ?? null;
  const marked = useMemo(() => lines.map((line) => line.node !== null && first !== null && line.node === first), [lines, first]);
  const firstMarked = marked.indexOf(true);
  useEffect(() => {
    if (firstMarked < 0) return;
    const at = body.current?.querySelectorAll('.code-line')[firstMarked];
    at?.scrollIntoView({ block: 'nearest' });
  }, [firstMarked, kind, info?.path]);

  const numbers = lines.length;
  const digits = String(numbers).length;
  // what Apply hands its command: the element's rule (CSS) or its own lines (HTML), read from the document — a draft
  // belongs to the text it was typed over, so another selection starts from the document again
  const [draft, setDraft] = useState<{ readonly over: string; readonly text: string } | null>(null);
  const ownText = own === null ? null : own.map((line) => line.text).join('\n');
  // a project file the person opened (a script, a stylesheet of their own) is edited whole: its own text is what Save
  // writes back (files.saveContent); an element's rule (CSS) or its markup (HTML) while one element is selected
  const fileText = info === null || info.generated ? null : info.text;
  const edited = fileText ?? (kind === 'css' ? rule : kind === 'html' ? ownText : null);
  const shown = draft !== null && draft.over === edited ? draft.text : edited;
  const editable = edited !== null;
  // the nodes of the element the pane edits: their lines are plain (a caret stands in them), every other line selects
  const mine = useMemo(() => new Set((own ?? []).map((line) => line.node).filter((id): id is string => id !== null)), [own]);
  return (
    <section className="code-pane" data-region="code-view" aria-label={t('panel.code')}>
      <header className="code-pane__head">
        <div className="code-pane__tabs" role="tablist" data-key-context="tab-strip">
          {/* a file that is none of the page's three parts (a text file) shows its own tab, its extension, selected:
              HTML, CSS and JS with none selected said nothing of it (the audit's U-053) */}
          {info !== null && !PANE_KINDS.has(info.kind) ? (
            <span className="door door--tab code-pane__tab is-current" role="tab" aria-selected="true">
              {extensionOf(info.path)}
            </span>
          ) : (
            TABS.map((entry) => <DoorControl key={entry.ref} entry={entry} className="code-pane__tab" />)
          )}
        </div>
        <div className="code-pane__file">
          <span className="code-pane__name">{info?.path ?? ''}</span>
          {info?.generated === true ? <span className="code-pane__badge">{t('files.generated')}</span> : null}
          {PART('copy') !== undefined ? <DoorControl entry={PART('copy') as DoorEntry} /> : null}
          {PART('download') !== undefined ? <DoorControl entry={PART('download') as DoorEntry} /> : null}
        </div>
      </header>
      {info?.text === null || info?.text === undefined ? (
        <p className="code-pane__empty">{t('codePanel.empty')}</p>
      ) : editable ? (
        // the element's own part of the code (its rule, its markup): the editable text Apply writes back on it
        <div className="code-pane__body" ref={body}>
          <textarea
            className="code-pane__editor"
            data-door={EDITOR_DOOR?.ref}
            data-args={JSON.stringify({ path: info?.path ?? '' })}
            data-key-context={CODE_EDITOR_CONTEXT}
            data-code-editor
            aria-label={fileText !== null && info !== null ? t('codePanel.fileAria', { name: info.path }) : kind === 'css' ? t('codePanel.ruleAria') : t('codePanel.markupAria')}
            spellCheck={false}
            value={shown ?? ''}
            onChange={(event) => setDraft({ over: edited ?? '', text: event.target.value })}
          />
        </div>
      ) : (
        // The whole file, coloured, every line the door that selects the element it belongs to — and the selected
        // element's lines marked and scrolled to (spec code-panel-selection-sync). While one element is selected the
        // pane shows that element's own part instead, which is what its Apply writes back (code-panel-edit-*).
        <div className="code-pane__body" ref={body} data-code-pane tabIndex={0}>
          <Drawn lines={lines} kind={kind} marked={marked} digits={digits} mine={mine} />
        </div>
      )}
      <footer className="code-pane__foot">
        {info?.generated === true ? <span className="code-pane__note">{t('codePanel.locked')}</span> : null}
        {kind === 'css' && shown !== null && PART('css-apply') !== undefined ? <DoorControl entry={PART('css-apply') as DoorEntry} args={{ css: shown }} className="code-pane__apply" /> : null}
        {kind === 'html' && ownText !== null && PART('html-apply') !== undefined ? <DoorControl entry={PART('html-apply') as DoorEntry} args={{ html: shown ?? ownText }} className="code-pane__apply" /> : null}
        {info === null || info.generated || PART('save') === undefined ? null : <DoorControl entry={PART('save') as DoorEntry} args={{ path: info.path, content: shown ?? info.text ?? '' }} className="code-pane__apply" />}
      </footer>
    </section>
  );
}

