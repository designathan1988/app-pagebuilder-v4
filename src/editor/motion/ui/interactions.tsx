// The motion part of the inspector's Interactions tab (plan stage 10, the canonical card "Ao clicar → Reproduzir
// animação": Applies to, Trigger, Action, Target, Options; spec motion-interactions, motion-behaviours): the selected
// element's interactions, one card each — the trigger and its options, the timeline it plays (any timeline of the
// project, reusable by name) and how it plays it, the class it applies to, once, delay, breakpoints, reduced motion —
// then the element's behaviours. Every control is a door of manifest/commands/motion.json drawn by the panel controls
// (PanelField, PanelButton), so a door whose feature is not built is drawn unavailable, and what a field shows in words
// it hands to its command as the value itself.
import { useState } from 'react';
import type { DocNode } from '../../../core/document/model.ts';
import { TRIGGERS, applicableTriggers, type TriggerCategory } from '../../../core/motion/catalog.ts';
import { behavioursOf, motionsOf, timelinesOf } from '../../../core/motion/document.ts';
import type { MotionInteraction } from '../../../core/motion/model.ts';
import { RUNTIME_BEHAVIOURS, STYLE_BEHAVIOURS } from '../../../core/motion/model.ts';
import type { MessageId } from '../../../generated/ids.ts';
import { manifest } from '../../../manifest/runtime.ts';
import { Icon } from '../../doors/door.tsx';
import { PanelButton, PanelField } from '../../shell/panel-field.tsx';
import { useEditorState } from '../../store.ts';
import { useT } from '../../text.ts';
import { MOTION_DOORS, motionDoor } from './doors.ts';
import { camel, controlsFor, interactionFields, interactionValue } from './options.ts';
import { DIRECTION } from '../../../core/motion/words.ts';
import { behaviourAxis } from '../../../core/motion/commands.ts';

type Translate = ReturnType<typeof useT>;

// A typed text read as the value it names: the value itself, or its words, in any case (the card shows words).
const chosenOf =
  (offered: readonly string[], words: (value: string) => string) =>
  (typed: string): string => {
    const text = typed.trim().toLowerCase();
    return offered.find((value) => value.toLowerCase() === text || words(value).toLowerCase() === text) ?? typed.trim();
  };

const triggerWords = (t: Translate) => (kind: string): string => t(`motion.trigger.${camel(kind)}` as MessageId);
const CATEGORY_ORDER: readonly TriggerCategory[] = ['element', 'scroll', 'page', 'media', 'component'];

// the fields whose values are words of a list (the rest are typed)
function wordsOf(field: string, t: Translate): ((value: string) => string) | undefined {
  if (field === 'trigger') return triggerWords(t);
  if (field === 'control') return (value) => t(`motion.control.${value}` as MessageId);
  if (field === 'leave') return (value) => t(`motion.leave.${value}` as MessageId);
  if (field === 'reducedMotion') return (value) => t(`motion.reducedMotion.${value}` as MessageId);
  if (field === DIRECTION || field === 'axis' || field === 'state') return (value) => t(`motion.value.${camel(value)}` as MessageId);
  return undefined;
}

function offeredFor(field: string, node: DocNode, interaction: MotionInteraction, timelines: readonly string[]): readonly string[] | undefined {
  if (field === 'trigger') {
    // grouped as the catalogue groups them: element, scrolling, page, media, components
    const applicable = applicableTriggers(node);
    return CATEGORY_ORDER.flatMap((category) => applicable.filter((kind) => TRIGGERS[kind].category === category));
  }
  if (field === 'timeline') return timelines;
  if (field === 'control') return controlsFor(interaction.trigger.kind);
  if (field === 'leave') return ['none', 'reverse', 'pause', 'reset'];
  if (field === 'scope') return ['', ...node.classes];
  if (field === 'reducedMotion') return ['respect', 'ignore'];
  if (field === 'breakpoints' || field === 'breakpoint') return manifest.properties.breakpoints.map((breakpoint) => breakpoint.id);
  if (field === DIRECTION) return ['down', 'up'];
  if (field === 'axis') return ['x', 'y'];
  if (field === 'state') return ['hidden', 'visible'];
  return undefined;
}

// what a field shows: the trigger's kind, a choice left at its default by that default's name, the rest as stored
function shown(interaction: MotionInteraction, field: string): string {
  if (field === 'trigger') return interaction.trigger.kind;
  if (field === 'reducedMotion') return interaction.reducedMotion ?? 'respect';
  if (field === 'leave') return interaction.leave ?? 'none';
  return interactionValue(interaction, field);
}

function Card({ node, interaction, index, timelines }: { readonly node: DocNode; readonly interaction: MotionInteraction; readonly index: number; readonly timelines: readonly string[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(index === 0);
  const args = { interaction: index };
  const field = (name: string) => {
    const words = wordsOf(name, t);
    const offered = offeredFor(name, node, interaction, timelines);
    return (
      <PanelField
        key={name}
        entry={motionDoor(MOTION_DOORS.field(name))}
        args={args}
        value={shown(interaction, name)}
        label={t(`motion.field.${name}` as MessageId)}
        offered={offered}
        {...(words === undefined ? {} : { display: words, accept: chosenOf(offered ?? [], words) })}
        {...(name === 'scope' ? { placeholder: t('motion.scope.element') } : name === 'breakpoints' ? { placeholder: t('motion.breakpoints.all') } : {})}
      />
    );
  };
  return (
    // drawn as the events' cards are (src/editor/shell/interactions.tsx; design/final .ix): one card anatomy in the tab
    <article className={`interaction-card motion-card${expanded ? ' is-expanded' : ''}`} data-motion-interaction={index}>
      <header className="interaction-card__head">
        <button className="interaction-card__summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((was) => !was)}>
          <Icon name="sparkles" size="sm" />
          <span className="interaction-card__name">{triggerWords(t)(interaction.trigger.kind)}</span>
          <span className="interaction-card__action">→ {t('motion.card.plays', { timeline: interaction.timeline })}</span>
        </button>
        <PanelButton entry={motionDoor(MOTION_DOORS.remove)} args={args} label={t('command.motion.remove')} icon={<Icon name="trash" size="sm" />} />
      </header>
      {expanded ? (
        <div className="interaction-card__fields">
          {field('scope')}
          {field('trigger')}
          {interactionFields(interaction).map(field)}
          {field('timeline')}
          {field('control')}
          <div className="field-row">
            <span className="field-row__label">{t('motion.field.once')}</span>
            <PanelButton entry={motionDoor(MOTION_DOORS.once)} args={{ ...args, value: interaction.once !== true }} label={t('motion.field.once')} pressed={interaction.once === true} />
          </div>
          {field('delay')}
          {field('breakpoints')}
          {field('reducedMotion')}
        </div>
      ) : (
        <p className="interaction-card__note">{interaction.scope === undefined ? t('motion.scope.element') : t('motion.scope.classCount', { class: `.${interaction.scope}` })}</p>
      )}
    </article>
  );
}

// The behaviours of the element: one button per behaviour, and each runtime behaviour it holds with its amount, its
// axis and its removal (sticky and scroll snap are plain CSS: their result shows in the Style tab).
function Behaviours({ node }: { readonly node: DocNode }) {
  const t = useT();
  const held = behavioursOf(node);
  return (
    <section className="motion-behaviours" aria-label={t('motion.behaviours.title')}>
      <p className="motion-behaviours__title">{t('motion.behaviours.title')}</p>
      <div className="motion-behaviours__add" role="group" aria-label={t('motion.behaviours.add')}>
        {[...STYLE_BEHAVIOURS, ...RUNTIME_BEHAVIOURS].map((kind) => (
          <PanelButton key={kind} entry={motionDoor(MOTION_DOORS.behaviour(kind))} args={{ behaviour: kind }} label={t(`motion.behaviour.${camel(kind)}` as MessageId)} />
        ))}
      </div>
      {held.map((behaviour) => (
        <div key={behaviour.kind} className="motion-behaviours__item" data-motion-behaviour={behaviour.kind}>
          <span className="motion-behaviours__name">{t(`motion.behaviour.${camel(behaviour.kind)}` as MessageId)}</span>
          {behaviour.kind === 'smooth-scroll' ? null : (
            <PanelField
              entry={motionDoor(MOTION_DOORS.behaviourAmount)}
              args={{ behaviour: behaviour.kind, axis: behaviourAxis(behaviour) }}
              value={String(behaviour.amount)}
              label={t(`motion.behaviour.amount.${camel(behaviour.kind)}` as MessageId)}
            />
          )}
          {behaviour.kind === 'parallax' || behaviour.kind === 'marquee' ? (
            <div className="motion-behaviours__axis" role="group" aria-label={t('motion.field.axis')}>
              {(['x', 'y'] as const).map((axis) => (
                <PanelButton key={axis} entry={motionDoor(MOTION_DOORS.behaviourAxis(axis))} args={{ behaviour: behaviour.kind, axis }} label={t(`motion.axis.${axis}` as MessageId)} pressed={behaviourAxis(behaviour) === axis} />
              ))}
            </div>
          ) : null}
          <PanelButton entry={motionDoor(MOTION_DOORS.behaviourRemove)} args={{ behaviour: behaviour.kind }} label={t('command.motion.removeBehaviour')} icon={<Icon name="trash" size="sm" />} />
        </div>
      ))}
    </section>
  );
}

// The section the Interactions tab draws for motion, under the element it shows (src/editor/shell/interactions.tsx
// mounts it with the primary selected element).
export function MotionInteractions({ node }: { readonly node: DocNode | null }) {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const single = useEditorState((state) => state.selection.length === 1);
  const interactions = node === null ? [] : motionsOf(node);
  const timelines = timelinesOf(document).map((timeline) => timeline.name);
  return (
    <div className="motion-interactions">
      <div className="motion-interactions__head">
        <p className="interactions__title">{t('motion.section.title')}</p>
        <PanelButton entry={motionDoor(MOTION_DOORS.add)} label={t('command.motion.add')} icon={<Icon name="plus" size="sm" />} disabled={!single}>
          {t('inspector.addMotion')}
        </PanelButton>
      </div>
      {node !== null && interactions.length === 0 ? <p className="motion-interactions__none">{t('motion.card.none')}</p> : null}
      {node === null ? null : interactions.map((interaction, index) => <Card key={interaction.id} node={node} interaction={interaction} index={index} timelines={timelines} />)}
      {node !== null ? <Behaviours node={node} /> : null}
    </div>
  );
}
