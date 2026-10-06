// The Interactions tab of the inspector (spec events-actions): the selected element,
// Add, then one card per interaction — Applies to, Trigger, Action (and its own value: a class, an animation, an
// address), the target it acts on and Options (once or every time, and a delay) — and Remove. Every
// control is a door the manifest places in the inspector-interactions region: Add (interactions.add), the card's
// fields (interactions.update, each fixing the `field` it edits), the target's picks (the canvas door and a Layers
// row's) and Remove. The target is not typed: the field starts picking (src/editor/inspector/pick-target.ts, DESIGN's
// data-local) and the next press on the canvas or on a Layers row gives it. The tab holds two lists, each under its
// title: these events (spec events-actions), then the element's motion (spec motion-interactions); one note at its end
// says which runs where (interactions.runNote).
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { useState } from 'react';
import { locate, type DocNode, type Interaction } from '../../core/document/model.ts';
import { actionLabel, applicableActions, applicableTriggers, firesOnce, interactionsOf, needsAddress, needsAnimation, needsClassName, needsTarget, primaryNodeOf, readOptions, triggerLabel } from '../../core/events/interactions.ts';
import { animationsOf } from '../../core/animation/animation.ts';
import { elementIcon, type DoorEntry, manifest } from '../../manifest/runtime.ts';
import { Icon } from '../doors/door.tsx';
import { PanelButton, PanelField } from './panel-field.tsx';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { pickingTarget } from '../inspector/pick-target.ts';
import { MotionInteractions } from '../motion/ui/interactions.tsx';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, MessageId } from '../../generated/ids.ts';

// The doors the tab draws, read from the manifest's own data: the panel-control doors of the inspector's region
// (manifest/layout.json: the region each is placed in), by their control names.
const doorOf = (name: string): DoorEntry | null =>
  manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'inspector' && d.door.control === name) ?? null;
const ADD = doorOf('interaction-add');
const TRIGGER_FIELD = doorOf('interaction-trigger');
const ACTION_FIELD = doorOf('interaction-action');
const TARGET_FIELD = doorOf('interaction-target');
const VALUE_FIELD = doorOf('interaction-value');
const OPTIONS_FIELD = doorOf('interaction-options');
const SCOPE_FIELD = doorOf('interaction-scope');
const NEW_TAB = doorOf('interaction-new-tab');
const REMOVE = doorOf('interaction-remove');

// the words of a trigger or an action, in the language the editor shows
const useOptionLabel = (): ((key: string) => string) => {
  const t = useT();
  return (key) => {
    const found = key.startsWith('trigger:') ? triggerLabel(key.slice('trigger:'.length)) : actionLabel(key.slice('action:'.length));
    return t(found);
  };
};

// the trigger or the action a typed text names: an offered value typed as it is, or in its words, in any case; any
// other text goes as typed (the command says it is not one)
const chosenOf =
  (offered: readonly string[], words: (value: string) => string) =>
  (typed: string): string => {
    const text = typed.trim().toLowerCase();
    return offered.find((value) => value.toLowerCase() === text || words(value).toLowerCase() === text) ?? typed.trim();
  };

// the words of an action's own value, by the action: the class it toggles, the animation it plays, the address it opens
const valueLabelKey = (action: string): MessageId | null =>
  needsClassName(action) ? 'interactions.field.className' : needsAnimation(action) ? 'interactions.field.animation' : needsAddress(action) ? 'interactions.field.address' : null;

// The Options as the command reads them (core/events/interactions.ts readOptions: once or always, and a delay in ms),
// the ones the field offers (every time and once, with no delay, 0.2 s, 0.5 s and 1 s), and their words: "Once · no
// delay", as the canonical card writes them. A text typed in the person's words (Uma vez · 200 ms) is put into the
// command's before it runs.
const OPTION_PRESETS: readonly string[] = ['always 0ms', 'once 0ms', 'always 200ms', 'once 200ms', 'always 500ms', 'once 500ms', 'always 1000ms', 'once 1000ms'];
const optionsText = (interaction: Interaction): string => `${firesOnce(interaction) ? 'once' : 'always'} ${String(interaction.delay ?? 0)}ms`;
const useOptionWords = (): { readonly display: (value: string) => string; readonly accept: (typed: string) => string } => {
  const t = useT();
  const display = (value: string): string => {
    const read = readOptions(value);
    if (read === null) return value;
    const delay = read.delay ?? 0;
    return `${t(read.once === true ? 'interactions.options.onlyOnce' : 'interactions.options.everyTime')} · ${delay === 0 ? t('interactions.options.noDelay') : t('interactions.options.waits', { ms: delay })}`;
  };
  const accept = (typed: string): string => {
    let text = ` ${typed.toLowerCase()} `;
    const words: readonly (readonly [string, string])[] = [
      [t('interactions.options.onlyOnce'), 'once'],
      [t('interactions.options.everyTime'), 'always'],
      [t('interactions.options.noDelay'), '0ms'],
    ];
    for (const [word, token] of words) text = text.split(word.toLowerCase()).join(` ${token} `);
    // a number and its unit written apart (200 ms) read as one duration
    return text.replaceAll('·', ' ').replace(/(\d)\s+(ms|s)(?![a-z])/gu, '$1$2').trim();
  };
  return { display, accept };
};

// what an interaction's value field holds, by its action
function optionValue(interaction: Interaction): string {
  if (needsClassName(interaction.action)) return interaction.className ?? '';
  if (needsAnimation(interaction.action)) return interaction.animation ?? '';
  if (needsAddress(interaction.action)) return interaction.address ?? '';
  return '';
}

function Card({ node, interaction, index }: { readonly node: DocNode; readonly interaction: Interaction; readonly index: number }) {
  const t = useT();
  const label = useOptionLabel();
  const store = useStore();
  const picking = pickingTarget(useEditorState((s) => s.ui)) === index;
  const target = interaction.target === undefined ? null : (locate(store.getState().document, interaction.target)?.node ?? null);
  const animations = animationsOf(node).map((animation) => animation.name);
  const classes = [...node.classes];
  const [expanded, setExpanded] = useState(index === 0);
  const options = useOptionWords();
  const valueKey = valueLabelKey(interaction.action);
  return (
    <article className={`interaction-card${expanded ? ' is-expanded' : ''}`}>
      <header className="interaction-card__head">
        <button className="interaction-card__summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((was) => !was)}>
          <Icon name="sparkles" size="sm" />
          <span className="interaction-card__name">{label(`trigger:${interaction.trigger}`)}</span>
          <span className="interaction-card__action">→ {label(`action:${interaction.action}`)}</span>
        </button>
        {REMOVE !== null ? <PanelButton entry={REMOVE} args={{ interaction: index }} label={t('command.interactions.remove')} icon={<Icon name="trash" size="sm" />} /> : null}
      </header>
      {expanded ? <div className="interaction-card__fields">
        {SCOPE_FIELD !== null ? (
          <PanelField entry={SCOPE_FIELD} args={{ interaction: index }} value={interaction.scope ?? ''} label={t('inspector.interactionScope')} offered={['', ...classes]} placeholder={t('interactions.scope.element')} />
        ) : null}
        {TRIGGER_FIELD !== null ? (
          <PanelField entry={TRIGGER_FIELD} args={{ interaction: index }} value={interaction.trigger} label={t('interactions.field.trigger')} offered={applicableTriggers(node)} display={(v) => label(`trigger:${v}`)} accept={chosenOf(applicableTriggers(node), (v) => label(`trigger:${v}`))} />
        ) : null}
        {ACTION_FIELD !== null ? (
          <PanelField entry={ACTION_FIELD} args={{ interaction: index }} value={interaction.action} label={t('interactions.field.action')} offered={applicableActions(node)} display={(v) => label(`action:${v}`)} accept={chosenOf(applicableActions(node), (v) => label(`action:${v}`))} />
        ) : null}
        {VALUE_FIELD !== null && valueKey !== null ? (
          <PanelField
            entry={VALUE_FIELD}
            args={{ interaction: index }}
            value={optionValue(interaction)}
            label={t(valueKey)}
            offered={needsClassName(interaction.action) ? classes : needsAnimation(interaction.action) ? animations : undefined}
          />
        ) : null}
        {NEW_TAB !== null && needsAddress(interaction.action) ? (
          <div className="field-row">
            <span className="field-row__label">{t('inspector.interactionNewTab')}</span>
            <PanelButton
              entry={NEW_TAB}
              args={{ interaction: index, changes: { newTab: interaction.newTab !== true } }}
              label={t('inspector.interactionNewTab')}
              pressed={interaction.newTab === true}
            />
          </div>
        ) : null}
        <div className="field-row interaction-card__target" data-interaction-target={index}>
          <span className="field-row__label">{t('interactions.field.target')}</span>
          {TARGET_FIELD !== null ? (
            <PanelButton entry={TARGET_FIELD} args={{ interaction: index }} pressed={picking} icon={<Icon name="locate-fixed" size="sm" />}>
              {picking ? t('interactions.picking') : (target?.name ?? t('interactions.target.none'))}
            </PanelButton>
          ) : null}
        </div>
        {/* the options in the default ink while the event keeps its trigger's own way (the canonical card's o-def) */}
        {OPTIONS_FIELD !== null ? (
          <span className={interaction.once === undefined && interaction.delay === undefined ? 'interaction-card__default' : 'interaction-card__set'}>
            <PanelField entry={OPTIONS_FIELD} args={{ interaction: index }} value={optionsText(interaction)} label={t('interactions.field.options')} offered={OPTION_PRESETS} display={options.display} accept={options.accept} />
          </span>
        ) : null}
      </div> : null}
      {!expanded ? <p className="interaction-card__note">
        {interaction.scope === undefined ? t('interactions.scope.element') : t('interactions.scope.classCount', { class: interaction.scope, count: countWithClass(store.getState().document, interaction.scope) })}
        {needsTarget(interaction.action) && interaction.target === undefined ? ` · ${t('interactions.target.none')}` : ''}
      </p> : null}
    </article>
  );
}

// how many elements of the project list a class (the scope's own count; core/design/classes.ts usesOfClass does the
// same for the class bar)
function countWithClass(document: DocumentJsonLike, name: string): number {
  let count = 0;
  for (const page of document.pages) {
    const walk = (node: DocNode): void => {
      if (node.classes.includes(name)) count += 1;
      for (const child of node.children) walk(child);
    };
    walk(page.tree);
  }
  return count;
}
type DocumentJsonLike = { readonly pages: readonly { readonly tree: DocNode }[] };

export function InteractionsTab() {
  const t = useT();
  const state = useEditorState((s) => s);
  const node = primaryNodeOf(state.document, state.selection);
  const interactions = node === null ? [] : interactionsOf(node);
  const store = useStore();
  const single = state.selection.length === 1;
  const add = () => {
    if (ADD === null) return;
    (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(ADD.command.id as CommandId, { ...ADD.door.args });
  };
  return (
    <div className="inspector-tab inspector-tab--interactions" data-region="inspector-interactions">
      <div className="interactions__head">
        {/* the element, as the canonical head draws it: its icon, its name and its tag */}
        <span className="interactions__element">
          {node === null ? (
            t('inspector.nothingSelected')
          ) : (
            <>
              <Icon name={elementIcon(node.type) ?? 'box'} size="sm" />
              <span className="interactions__name">{node.name}</span>
              {node.tag === null ? null : <span className="interactions__tag">{node.tag}</span>}
            </>
          )}
        </span>
        <button
          type="button"
          className={`door door--button${single && ADD !== null && isFeatureBuilt('events-actions' as FeatureId) ? '' : ' is-unavailable'}`}
          data-door={ADD?.ref}
          data-args={JSON.stringify(ADD?.door.args ?? {})}
          aria-disabled={single && ADD !== null ? undefined : true}
          title={t('command.interactions.add')}
          onClick={() => {
            if (single) add();
          }}
        >
          <Icon name="plus" size="sm" />
          <span className="door__label">{t('inspector.addInteraction')}</span>
        </button>
      </div>
      {node === null ? null : <p className="interactions__title">{t('interactions.section.events')}</p>}
      {node === null ? null : interactions.length === 0 ? <p className="interactions__none">{t('interactions.none')}</p> : null}
      {node === null ? null : interactions.map((interaction, index) => <Card key={index} node={node} interaction={interaction} index={index} />)}
      <MotionInteractions node={node} />
      <p className="interactions__note">{t('interactions.runNote')}</p>
    </div>
  );
}

// the Layers row's pick control (the door the manifest places on a Layers row): while an interaction's target is being
// picked, every row offers to give it (spec events-actions)
export const LAYERS_PICK: DoorEntry | null =
  manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'layers' && d.door.control === 'row-pick-target') ?? null;
