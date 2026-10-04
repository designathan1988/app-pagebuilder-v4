// The Layout tool's sidebar view (manifest/layout.json panel "layout-composer", region layout-composer-panel): the
// container composed and what the layout predicts it becomes (spec "Prediction"), how the gestures work, the selected
// regions' properties and the rules that make them equal (layout.configure, spec "Intent Inspector"), how the group is
// arranged (layout.interpret), what changes at the screen size the canvas shows (layout.respond), delete and Done.
// Every control is the door the manifest declares; nothing here changes state but through them.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { activeBreakpoint, BASE_BREAKPOINT, breakpointName, breakpointsOf, DoorControl, Icon, imageFiles, locate, manifest, markFieldKept, recordFieldInput, useDoor, useEditorState, useStore, useT } from '../../../editor/host.ts';
import type { CommandId, DispatchResult, DocumentJson, DoorEntry, MessageId, ProjectFile } from '../../../editor/host.ts';
import { predict, stress, stressWidths, type Suggestion } from '../intent/analysis.ts';
import { BUILT_IN_TEMPLATES } from '../intent/templates.ts';
import { luminanceOf } from '../interaction/luminance.ts';
import { ALIGNMENTS, DISTRIBUTIONS, SEMANTICS, SIZINGS, childrenOf, findRegion, preferenceKey, type LayoutIntent, type Region } from '../intent/model.ts';
import { recordOf } from '../host/record.ts';
import { laidOut, usefulSuggestions } from '../host/handlers.ts';
import { composerOf } from '../host/state.ts';
import { describeConstraint } from './scene.ts';
import './composer.css';

const control = (name: string): DoorEntry | undefined => manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'layout-composer' && d.door.control === name);
const DONE = control('layout-done');
const DELETE = control('layout-delete-button');
const MERGE = control('layout-merge-button');
const SPACING = control('layout-spacing');
const REPEAT = control('layout-repeat');

// The gestures, one line each: the keys held and what the drag does (interactions.json layout-stroke)
const LEGEND = ['draw', 'move', 'select', 'split', 'merge', 'edges'] as const;
const NAME = control('layout-name');
const SEMANTIC = control('layout-semantic');
const WIDTH = control('layout-width');
const HEIGHT = control('layout-height');
const PADDING = control('layout-padding');
const ALIGNMENT = control('layout-alignment');
const DISTRIBUTION = control('layout-distribution');
const EQUALIZE = ['layout-equal-widths', 'layout-equal-gaps'].map(control).filter((d): d is DoorEntry => d !== undefined);
const STRATEGY = control('layout-strategy');
const RESPONDS = ['layout-stack', 'layout-unstack', 'layout-hide', 'layout-show'].map(control).filter((d): d is DoorEntry => d !== undefined);
const COLUMNS = control('layout-columns');
const STRATEGIES = ['auto', 'grid', 'flex', 'fixed', 'proportional', 'masonry'] as const;
const UNRELATE = control('layout-unrelate');
const SUGGEST = control('layout-suggest');
const TEMPLATE = control('layout-template');
const REFERENCE = control('layout-reference');
const REFERENCE_OPACITY = control('layout-reference-opacity');
const REFERENCE_CLEAR = control('layout-reference-clear');
const TRACE = control('layout-trace');
// the argument the opacity field writes: the reference command's one argument besides its file
const OPACITY_ARG = Object.keys(REFERENCE_OPACITY?.command.args ?? {}).find((name) => name !== 'file') ?? '';
// the narrowest width the widths check measures down to: the narrowest phone a page is made for
const NARROWEST = 320;

// A suggestion in words (spec "Structural Suggestions").
function suggestionWords(t: ReturnType<typeof useT>, graph: LayoutIntent, s: Suggestion): string {
  if (s.kind === 'repeat') return t('layout.suggestion.repeat', { count: s.regions.length });
  if (s.kind === 'equal-gap') return t('layout.suggestion.equal-gap', { gap: Math.round(s.evidence.reduce((a, g) => a + g, 0) / Math.max(1, s.evidence.length)) });
  return t('layout.suggestion.remove-wrapper', { name: findRegion(graph, s.regions[0] ?? '')?.name ?? '' });
}

// Trace regions from the image: the panel reads the reference's luminance (interaction/luminance.ts), then runs the
// door with it; an image the browser cannot decode is handed as nothing, and the command says so.
function TraceButton({ entry, file }: { readonly entry: DoorEntry; readonly file: ProjectFile | null }) {
  const store = useStore();
  const door = useDoor(entry, {});
  const dispatch = (luminance: unknown) => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { ...entry.door.args, luminance });
  const run = () => {
    if (!door.available || file === null) {
      door.run();
      return;
    }
    void luminanceOf(file).then(dispatch, () => dispatch(null));
  };
  return (
    <button type="button" className={`door door--button${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} title={door.title} aria-disabled={door.available ? undefined : true} onClick={run}>
      {entry.door.icon === null ? null : <Icon name={entry.door.icon} size="sm" />}
      <span className="door__label">{door.face}</span>
    </button>
  );
}


// A text field of a door: what it holds is kept on Enter or when the focus leaves it, as its command's `value`.
function DoorField({ entry, value, type = 'text', arg = 'value' }: { readonly entry: DoorEntry; readonly value: string; readonly type?: 'text' | 'number'; readonly arg?: string }) {
  const store = useStore();
  const t = useT();
  const field = useRef<HTMLInputElement>(null);
  const label = t(entry.door.labelKey as MessageId);
  const door = useDoor(entry, {}, label);
  useEffect(() => {
    if (field.current === null || document.activeElement === field.current) return;
    field.current.value = value;
    markFieldKept(field.current, value);
  }, [value]);
  // what is typed is a draft until it is kept (input/drafts.ts): Ctrl+Z undoes the typing first, then the document
  const keep = () => {
    const input = field.current;
    if (input === null || !door.available || input.value === (input.dataset.shown ?? value)) return;
    const outcome = (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { ...entry.door.args, [arg]: input.value });
    // a value the command refused is not kept: the field shows the document's value again (the audit's FD2)
    if (outcome.status !== 'done') input.value = value;
    markFieldKept(input, input.value);
  };
  return (
    <form className="layout-panel__field" data-door={entry.ref} data-args={JSON.stringify(entry.door.args)} title={door.title} onSubmit={(event) => { event.preventDefault();
      keep();
    }}>
      <label className="layout-panel__label">{label}</label>
      <input ref={field} className="input" type={type} min={type === 'number' ? 1 : undefined} defaultValue={value} aria-label={label} disabled={!door.available} spellCheck={false} onBlur={keep} onInput={(event) => recordFieldInput(event.currentTarget, event.nativeEvent)} data-key-context="command-field" />
    </form>
  );
}

// A row of segments, one per value, each the door with that value; the one the regions hold is current.
function Segments({ entry, values, current, words, arg = 'value' }: { readonly entry: DoorEntry; readonly values: readonly string[]; readonly current: string | null; readonly words: (value: string) => string; readonly arg?: string }) {
  const t = useT();
  return (
    <div className="layout-panel__group">
      <span className="layout-panel__label">{t(entry.door.labelKey as MessageId)}</span>
      <div className="segmented" role="group" aria-label={t(entry.door.labelKey as MessageId)}>
        {values.map((value) => (
          <DoorControl key={value} entry={entry} args={{ [arg]: value }} current={current === value} label={words(value)}>
            <span className="door__label">{words(value)}</span>
          </DoorControl>
        ))}
      </div>
    </div>
  );
}

// The selected regions' properties. Sizes, spacing and alignment belong to the width the layout is drawn at: at a
// narrower one the section says so instead of offering them (layout.configure refuses them there).
function RegionSection({ regions, base }: { readonly regions: readonly Region[]; readonly base: boolean }) {
  const t = useT();
  const first = regions[0] as Region;
  const same = <T,>(read: (r: Region) => T): T | null => (regions.every((r) => read(r) === read(first)) ? read(first) : null);
  return (
    <section className="layout-panel__section" aria-label={t('layout.panel.region')}>
      <span className="layout-panel__heading">{t('layout.panel.region')}</span>
      {NAME === undefined || regions.length !== 1 ? null : <DoorField entry={NAME} value={first.name} />}
      {SEMANTIC === undefined || regions.some((r) => r.kind === 'content') ? null : <Segments entry={SEMANTIC} values={SEMANTICS} current={same((r) => r.semantic)} words={(v) => t(`layout.word.${v}` as MessageId)} />}
      {base ? <BaseProperties regions={regions} /> : <p className="layout-panel__text">{t('layout.respond.configureAtBase', { breakpoint: breakpointName(BASE_BREAKPOINT, t) })}</p>}
      {base && regions.length > 1 ? (
        <>
          {SPACING === undefined ? null : <DoorField entry={SPACING} value="" type="number" />}
          <div className="layout-panel__actions">
            {EQUALIZE.map((entry) => (
              <DoorControl key={entry.ref} entry={entry} />
            ))}
          </div>
        </>
      ) : null}
      {base && regions.length === 1 && REPEAT !== undefined ? <DoorField entry={REPEAT} value="" type="number" /> : null}
    </section>
  );
}

function BaseProperties({ regions }: { readonly regions: readonly Region[] }) {
  const t = useT();
  const first = regions[0] as Region;
  const same = <T,>(read: (r: Region) => T): T | null => (regions.every((r) => read(r) === read(first)) ? read(first) : null);
  return (
    <>
      {WIDTH === undefined ? null : <Segments entry={WIDTH} values={SIZINGS} current={same((r) => r.width.mode)} words={(v) => t(`layout.word.${v}` as MessageId)} />}
      {HEIGHT === undefined ? null : <Segments entry={HEIGHT} values={SIZINGS} current={same((r) => r.height.mode)} words={(v) => t(`layout.word.${v}` as MessageId)} />}
      {PADDING === undefined || regions.some((r) => r.kind === 'content') ? null : <DoorField entry={PADDING} value={String(same((r) => r.layout?.padding ?? null) ?? '')} type="number" />}
      {ALIGNMENT === undefined ? null : <Segments entry={ALIGNMENT} values={ALIGNMENTS} current={same((r) => r.layout?.alignment ?? null)} words={(v) => t(`layout.alignment.${v}` as MessageId)} />}
      {DISTRIBUTION === undefined ? null : <Segments entry={DISTRIBUTION} values={DISTRIBUTIONS} current={same((r) => r.layout?.distribution ?? null)} words={(v) => t(`layout.distribution.${v}` as MessageId)} />}
    </>
  );
}

export function LayoutPanel(): ReactNode {
  const t = useT();
  const composer = useEditorState((s) => composerOf(s.ui));
  const container = useEditorState((s) => (composer === null ? null : (locate(s.document, composer.target)?.node ?? null)));
  const breakpoint = useEditorState((s) => activeBreakpoint(s));
  const table = useEditorState((s) => breakpointsOf(s.document));
  const project = useEditorState((s) => s.document);
  // the project's images: read from the files list the document holds, so the panel redraws only when it changes
  const files = useEditorState((s) => s.document.files);
  const images = useMemo(() => imageFiles({ files } as DocumentJson), [files]);
  const record = container === null ? null : recordOf(container);
  if (composer === null || container === null || record === null) {
    return (
      <section className="view layout-panel" data-region="layout-composer-panel" aria-label={t('panel.layoutComposer')}>
        <div className="view__title">{t('panel.layoutComposer')}</div>
        <p className="layout-panel__text">{t('layout.panel.idle')}</p>
      </section>
    );
  }
  const regions = composer.selection.map((id) => findRegion(record.intent, id)).filter((r): r is Region => r !== undefined);
  const names = regions.map((r) => r.name);
  // the group the arrangement is about: the one selected region's children, else the selection's group, else the top
  const one = regions.length === 1 ? (regions[0] as Region) : undefined;
  const group = one !== undefined && childrenOf(record.intent, one.id).length > 0 ? one.id : (regions[0]?.parent ?? null);
  const groupName = group === null ? container.name : (findRegion(record.intent, group)?.name ?? container.name);
  const prediction = predict(record.intent, group);
  const strategy = record.intent.preferences?.[preferenceKey(group)] ?? 'auto';
  const offered = usefulSuggestions(record.intent, project);
  const reference = record.intent.reference;
  // the widths check (spec "Layout Stress Testing"): the widest width at which a region no longer fits or no longer
  // reads, measured on the layout as the page lays it out (with its automatic reflow)
  const widths = stressWidths(record.intent.viewport.width, table.map((b) => b.width), NARROWEST);
  const issues = stress(laidOut(record.intent, project), widths.map((width) => ({ width, scale: 1, content: {} })));
  const breaking = issues.length === 0 ? null : issues.reduce((a, b) => (b.viewport > a.viewport ? b : a));
  return (
    <section className="view layout-panel" data-region="layout-composer-panel" aria-label={t('panel.layoutComposer')}>
      <div className="view__title">{t('layout.panel.container', { name: container.name })}</div>
      <p className="layout-panel__prediction" data-layout-prediction={prediction.key}>
        {t(prediction.key as MessageId, Object.fromEntries(Object.entries(prediction.params).map(([name, value]) => [name, name === 'sizing' && typeof value === 'string' && !value.endsWith('px') ? t(`layout.word.${value}` as MessageId) : value])))}
      </p>
      <dl className="layout-panel__legend" aria-label={t('layout.panel.gestures')}>
        {LEGEND.map((id) => (
          <div key={id} className="layout-panel__gesture" data-layout-gesture={id}>
            <dt className="layout-panel__keys">{t(`layout.legend.${id}.keys` as MessageId)}</dt>
            <dd className="layout-panel__does">{t(`layout.legend.${id}.does` as MessageId)}</dd>
          </div>
        ))}
      </dl>
      <p className="layout-panel__text" data-layout-selection={composer.selection.join(' ')}>
        {names.length === 0 ? t('layout.panel.noSelection') : t('layout.panel.selection', { names: names.join(', ') })}
      </p>
      {/* two regions or more selected: one press makes them one */}
      {MERGE === undefined || regions.length < 2 ? null : (
        <div className="layout-panel__actions">
          <DoorControl entry={MERGE} />
        </div>
      )}
      {regions.length === 0 ? null : <RegionSection regions={regions} base={breakpoint.base} />}
      {STRATEGY === undefined ? null : (
        <section className="layout-panel__section" aria-label={t('layout.panel.arrangement', { name: groupName })}>
          <span className="layout-panel__heading">{t('layout.panel.arrangement', { name: groupName })}</span>
          <Segments entry={STRATEGY} values={STRATEGIES} current={strategy} words={(v) => t(`layout.strategy.${v}` as MessageId)} arg="strategy" />
        </section>
      )}
      {/* what changes at a narrower screen: only while one is chosen in the frame's tabs */}
      {breakpoint.base ? null : (
      <section className="layout-panel__section" aria-label={t('layout.panel.screen')}>
        <span className="layout-panel__heading">{t('layout.panel.screen')}</span>
          <>
            <p className="layout-panel__text">{t('layout.respond.at', { breakpoint: breakpointName(breakpoint, t), width: breakpoint.width })}</p>
            <p className="layout-panel__text">{t('layout.respond.auto')}</p>
            <div className="layout-panel__actions">
              {RESPONDS.map((entry) => (
                <DoorControl key={entry.ref} entry={entry} />
              ))}
            </div>
            {COLUMNS === undefined ? null : <DoorField entry={COLUMNS} value="" type="number" />}
          </>
      </section>
      )}
      {/* the rules the layout keeps (equal widths, one gap): only once there is one */}
      {record.intent.constraints.length === 0 ? null : (
      <section className="layout-panel__section" aria-label={t('layout.panel.rules')}>
        <span className="layout-panel__heading">{t('layout.panel.rules')}</span>
        {record.intent.constraints.map((c) => {
          const words = describeConstraint(record.intent, c);
          return (
            <div key={c.id} className="layout-panel__item" data-layout-constraint={c.id}>
              <span className="layout-panel__text">{t(words.key as MessageId, words.params)}</span>
              {UNRELATE === undefined ? null : <DoorControl entry={UNRELATE} args={{ constraint: c.id }} />}
            </div>
          );
        })}
      </section>
      )}
      {offered.length === 0 || SUGGEST === undefined ? null : (
        <section className="layout-panel__section" aria-label={t('layout.panel.suggestions')}>
          <span className="layout-panel__heading">{t('layout.panel.suggestions')}</span>
          {offered.map((s) => (
            <div key={s.id} className="layout-panel__item" data-layout-suggestion={s.id}>
              <span className="layout-panel__text">{suggestionWords(t, record.intent, s)}</span>
              <DoorControl entry={SUGGEST} args={{ suggestion: s.id }} />
            </div>
          ))}
        </section>
      )}
      {TEMPLATE === undefined ? null : (
        <section className="layout-panel__section" aria-label={t('layout.panel.templates')}>
          <Segments entry={TEMPLATE} values={BUILT_IN_TEMPLATES} current={null} words={(v) => t(`layout.template.${v}` as MessageId)} arg="template" />
        </section>
      )}
      {/* a reference image to trace: only once the project holds an image */}
      {REFERENCE === undefined || images.length === 0 ? null : (
        <section className="layout-panel__section" aria-label={t('layout.panel.reference')}>
          <Segments entry={REFERENCE} values={images.map((f) => f.path)} current={reference?.file ?? null} words={(v) => v.slice(v.lastIndexOf('/') + 1)} arg="file" />
          {reference === undefined ? null : (
            <>
              {REFERENCE_OPACITY === undefined ? null : <DoorField entry={REFERENCE_OPACITY} value={String(Math.round(reference.opacity * 100))} type="number" arg={OPACITY_ARG} />}
              <div className="layout-panel__actions">
                {TRACE === undefined ? null : <TraceButton entry={TRACE} file={images.find((f) => f.path === reference.file) ?? null} />}
                {REFERENCE_CLEAR === undefined ? null : <DoorControl entry={REFERENCE_CLEAR} />}
              </div>
            </>
          )}
        </section>
      )}
      {/* the widths check: a warning only when a region stops fitting at some width */}
      {breaking === null ? null : (
        <section className="layout-panel__section" aria-label={t('layout.panel.widths')}>
          <span className="layout-panel__heading">{t('layout.panel.widths')}</span>
          <p className="layout-panel__text" data-layout-widths="breaks">
            {t(breaking.kind === 'squeezed' ? 'layout.panel.squeezed' : 'layout.panel.breaks', { width: breaking.viewport, region: findRegion(record.intent, breaking.region)?.name ?? breaking.region, required: Math.round(breaking.required), available: Math.round(breaking.available) })}
          </p>
        </section>
      )}

      <div className="layout-panel__actions">
        {DELETE === undefined ? null : <DoorControl entry={DELETE} />}
        {DONE === undefined ? null : <DoorControl entry={DONE} />}
      </div>
    </section>
  );
}
