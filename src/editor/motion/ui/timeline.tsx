// The motion Timeline (plan stage 10, "Linha do tempo de verdade"; spec motion-timeline, motion-keyframes): the
// project's timelines on the left; on the right a seconds axis with zoom, a ruler, a playhead with its readout
// ("0.48 s / 1.20 s"), markers, and one lane per target with its actions as bars, each followed by one lane per
// property its animations key, with the keyframes as diamonds; below, the fields of the selected action and keyframe.
// Every control is a door of manifest/commands/motion.json. The drags — the playhead along the ruler, a bar, its two
// edges, a keyframe, a marker — are the pointer owner's (src/editor/input/pointer.ts, with
// src/editor/motion/pointer.ts): this panel draws them, with the door and the arguments each stands for, and the
// geometry the pointer owner reads (data-motion-track: where the track starts, how many px a second takes).
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { EFFECTS, EFFECT_KINDS, TARGET_KINDS } from '../../../core/motion/catalog.ts';
import { createEasing } from '../../../core/motion/easing.ts';
import { findTimeline, timelinesOf, timelineUses } from '../../../core/motion/document.ts';
import type { MotionTarget, MotionTimeline, TimelineAction } from '../../../core/motion/model.ts';
import { actionEnd, timelineDuration } from '../../../core/motion/timeline.ts';
import { lanes, readout, seconds, ticks, timeToX, type Lane } from '../../../core/motion/view.ts';
import type { MessageId } from '../../../generated/ids.ts';
import { numberConstant } from '../../../manifest/runtime.ts';
import { Icon, useDoor } from '../../doors/door.tsx';
import { PanelButton, PanelField } from '../../shell/panel-field.tsx';
import { useEditorState } from '../../store.ts';
import { useT } from '../../text.ts';
import { motionUiOf, shownTimeline, viewOf, type MotionUiState } from '../state.ts';
import { MOTION_DOORS, motionDoor } from './doors.ts';
import { camel, effectOptions, optionText, type OptionField } from './options.ts';
import './motion.css';

type Translate = ReturnType<typeof useT>;
const easing = createEasing();

// A typed text read as the value it names: the value itself, or its words, in any case.
const chosenOf =
  (offered: readonly string[], words: (value: string) => string) =>
  (typed: string): string => {
    const text = typed.trim().toLowerCase();
    return offered.find((value) => value.toLowerCase() === text || words(value).toLowerCase() === text) ?? typed.trim();
  };

// how a target is named on its lane: its kind in words, and the class, component or element it names
function targetName(target: MotionTarget, t: Translate, nodeName: (id: string) => string): string {
  const kind = t(`motion.target.${camel(target.kind)}` as MessageId);
  if (target.kind === 'element') return nodeName(target.node);
  if (target.kind === 'component') return `${kind}: ${target.component}`;
  if ('className' in target) return `${kind}: .${target.className}`;
  return kind;
}

// The track's length in ms: motion.trackLength at least, the timeline's own length and a second more when longer (its
// middle is 3 s for any timeline shorter than 5 s: where a press with no travel puts the playhead)
function trackLength(timeline: MotionTimeline | null): number {
  const least = numberConstant('motion.trackLength');
  return timeline === null ? least : Math.max(least, timelineDuration(timeline) + 1000);
}

// ---------------------------------------------------------------- the left column

// The button that asks for a new timeline's name: its door's control opens a field, the person types the name and
// Enter runs motion.createTimeline with it (as the CSS animations' New animation does, src/editor/timeline/panel.tsx).
function NewTimeline() {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const entry = motionDoor(MOTION_DOORS.newTimeline);
  const door = useDoor(entry, {}, t('command.motion.createTimeline'));
  if (!asking) {
    return (
      <button
        type="button"
        className={`door door--button${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        data-args={JSON.stringify(entry.door.args)}
        aria-disabled={door.available ? undefined : true}
        aria-haspopup="dialog"
        title={door.title}
        onClick={() => {
          if (door.available) setAsking(true);
        }}
      >
        <Icon name="plus" size="sm" />
        <span className="door__label">{t('command.motion.createTimeline')}</span>
      </button>
    );
  }
  return <PanelField entry={entry} value="" label={t('motion.timeline.name')} autoFocus onDone={() => setAsking(false)} />;
}

function TimelineList({ shown }: { readonly shown: string | null }) {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const timelines = timelinesOf(document);
  return (
    <aside className="motion-timeline__side">
      <p className="motion-timeline__title">{t('motion.timeline.title')}</p>
      {timelines.length === 0 ? <p className="motion-timeline__none">{t('motion.timeline.empty')}</p> : null}
      <ul className="motion-timeline__rows">
        {timelines.map((timeline) => {
          const uses = timelineUses(document, timeline.name);
          return (
            <li key={timeline.id} className="motion-timeline__row">
              <PanelButton entry={motionDoor(MOTION_DOORS.timelineRow)} args={{ timeline: timeline.name }} pressed={timeline.name === shown}>
                {timeline.name}
              </PanelButton>
              <span className="motion-timeline__uses">{t('motion.timeline.uses', { count: uses.interactions + uses.actions })}</span>
              <PanelButton entry={motionDoor(MOTION_DOORS.timelineDelete)} args={{ timeline: timeline.name }} label={t('command.motion.deleteTimeline')} icon={<Icon name="trash" size="sm" />} />
            </li>
          );
        })}
      </ul>
      <NewTimeline />
      {shown !== null ? <PanelField entry={motionDoor(MOTION_DOORS.timelineName)} args={{ timeline: shown }} value={shown} label={t('motion.timeline.name')} /> : null}
    </aside>
  );
}

// ---------------------------------------------------------------- the track

// A control that selects what it stands for, adding to the selection with Shift (the two doors of motion.select), and
// holds the drag handle the pointer owner presses.
function Selectable({ refs, args, selected, className, style, children, title }: {
  readonly refs: readonly [string, string];
  readonly args: Readonly<Record<string,
  unknown>>;
  readonly selected: boolean;
  readonly className: string;
  readonly style: CSSProperties;
  readonly children: React.ReactNode;
  readonly title: string
}) {
  const plain = useDoor(motionDoor(refs[0]), args, title);
  const adding = useDoor(motionDoor(refs[1]), args, title);
  return (
    <button
      type="button"
      className={`${className}${selected ? ' is-selected' : ''}${plain.available ? '' : ' is-unavailable'}`}
      style={style}
      title={plain.title}
      aria-label={title}
      aria-pressed={selected}
      data-door={motionDoor(refs[0]).ref}
      data-args={JSON.stringify({ ...motionDoor(refs[0]).door.args, ...args })}
      onClick={(event: MouseEvent) => (event.shiftKey ? adding.run() : plain.run())}
    >
      {children}
    </button>
  );
}

function Bar({ timeline, action, at, motion, t }: { readonly timeline: MotionTimeline; readonly action: TimelineAction; readonly at: number; readonly motion: MotionUiState; readonly t: Translate }) {
  const view = viewOf(motion);
  const left = timeToX(view, action.start);
  const instant = !EFFECTS[action.effect.kind].timed;
  const width = Math.max(0, timeToX(view, actionEnd(action)) - left);
  const label = t('motion.timeline.actionAt', { action: t(`motion.action.${camel(action.effect.kind)}` as MessageId), start: seconds(action.start), duration: seconds(action.duration) });
  const args = { timeline: timeline.name, at };
  const handle = (ref: string, part: string) => <span className={`motion-bar__${part}`} data-door={motionDoor(ref).ref} data-args={JSON.stringify({ ...motionDoor(ref).door.args, ...args, action: action.id })} />;
  return (
    <Selectable
      refs={[MOTION_DOORS.barSelect, MOTION_DOORS.barSelectAdd]}
      args={args}
      selected={motion.selectedActions?.includes(action.id) === true}
      className={`motion-bar motion-bar--${action.effect.kind}${instant ? ' is-instant' : ''}${action.repeat === 'infinite' ? ' is-infinite' : ''}`}
      style={{ left, width } as CSSProperties}
      title={label}
    >
      {instant ? null : handle(MOTION_DOORS.barStart, 'start')}
      <span className="motion-bar__body" data-door={motionDoor(MOTION_DOORS.barDrag).ref} data-args={JSON.stringify({ ...args, action: action.id })}>
        <span className="motion-bar__label">{t(`motion.action.${camel(action.effect.kind)}` as MessageId)}</span>
      </span>
      {instant ? null : handle(MOTION_DOORS.barEnd, 'end')}
    </Selectable>
  );
}

function PropertyLane({ timeline, lane, motion }: { readonly timeline: MotionTimeline; readonly lane: Extract<Lane, { kind: 'property' }>; readonly motion: MotionUiState }) {
  const t = useT();
  const view = viewOf(motion);
  // the action a keyframe added from the lane lands on: the one of its actions the playhead is in, else its first
  const actions = [...new Set(lane.keyframes.map((keyframe) => keyframe.action))].map((id) => timeline.actions.find((action) => action.id === id)).filter((action): action is TimelineAction => action !== undefined);
  const covering = actions.find((action) => action.start <= motion.time && motion.time <= actionEnd(action)) ?? actions[0];
  const coveringAt = covering === undefined ? -1 : timeline.actions.indexOf(covering);
  return (
    <div className="motion-lane motion-lane--property" data-motion-property={lane.property}>
      <span className="motion-lane__label">
        {lane.property}
        {covering === undefined ? null : (
          <PanelButton entry={motionDoor(MOTION_DOORS.addKeyframe)} args={{ timeline: timeline.name, action: covering.id, at: coveringAt, property: lane.property, value: '' }} label={t('command.motion.setKeyframe')} icon={<Icon name="diamond-plus" size="sm" />} />
        )}
      </span>
      <div className="motion-lane__body">
        {lane.keyframes.map((keyframe) => {
          const at = timeline.actions.findIndex((action) => action.id === keyframe.action);
          const action = timeline.actions[at];
          const track = action !== undefined && (action.effect.kind === 'animate' || action.effect.kind === 'split-text') ? action.effect.tracks.find((one) => one.id === keyframe.track) : undefined;
          const keyframeAt = track?.keyframes.findIndex((one) => one.id === keyframe.id) ?? 0;
          const args = { timeline: timeline.name, at, property: lane.property, keyframeAt };
          const selected = motion.selectedKeyframes?.some((ref) => ref.keyframe === keyframe.id) === true;
          return (
            <Selectable
              key={keyframe.id}
              refs={[MOTION_DOORS.keyframeSelect, MOTION_DOORS.keyframeSelectAdd]}
              args={args}
              selected={selected}
              className={`motion-keyframe${keyframe.easing === null ? '' : ' has-easing'}`}
              style={{ left: timeToX(view, keyframe.time) } as CSSProperties}
              title={t('motion.timeline.keyframe', { time: seconds(keyframe.time) })}
            >
              <span className="motion-keyframe__handle" data-door={motionDoor(MOTION_DOORS.keyframeDrag).ref} data-args={JSON.stringify({ ...args, keyframe: { action: keyframe.action, track: keyframe.track, keyframe: keyframe.id } })}>
                <Icon name="diamond" size="xs" />
              </span>
            </Selectable>
          );
        })}
      </div>
    </div>
  );
}

function Track({ timeline, motion }: { readonly timeline: MotionTimeline; readonly motion: MotionUiState }) {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const view = viewOf(motion);
  const width = timeToX({ ...view, scroll: 0 }, trackLength(timeline));
  const nodeName = (id: string): string => {
    for (const page of document.pages) {
      const stack = [page.tree];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined) break;
        if (node.id === id) return node.name;
        stack.push(...node.children);
      }
    }
    return id;
  };
  return (
    <div className="motion-track" style={{ width } as CSSProperties} data-motion-track="" data-pixels-per-second={motion.pixelsPerSecond} data-scroll={motion.scroll}>
      <div className="motion-ruler" data-door={motionDoor(MOTION_DOORS.playhead).ref} data-args="{}" title={t('command.motion.setPlayhead')}>
        {ticks(view, width, numberConstant('motion.rulerSpacing')).map((tick) => (
          <span key={tick.time} className={`motion-ruler__tick${tick.major ? ' is-major' : ''}`} style={{ left: tick.x } as CSSProperties}>
            {tick.label === null ? null : <span className="motion-ruler__label">{tick.label}</span>}
          </span>
        ))}
      </div>
      <div className="motion-lane motion-lane--markers">
        <span className="motion-lane__label">{t('motion.timeline.markers')}</span>
        <div className="motion-lane__body">
          {timeline.markers.map((marker, markerAt) => (
            <span key={marker.id} className="motion-marker" style={{ left: timeToX(view, marker.time) } as CSSProperties} data-door={motionDoor(MOTION_DOORS.markerDrag).ref} data-args={JSON.stringify({ timeline: timeline.name, markerAt, marker: marker.id })} title={t('motion.timeline.marker', { name: marker.name, time: seconds(marker.time) })}>
              <Icon name="flag" size="xs" />
              <span className="motion-marker__name">{marker.name}</span>
            </span>
          ))}
        </div>
      </div>
      {lanes(timeline).map((lane) =>
        lane.kind === 'target' ? (
          <div key={lane.key} className="motion-lane motion-lane--target">
            <span className="motion-lane__label">{targetName(lane.target, t, nodeName)}</span>
            <div className="motion-lane__body">
              {lane.actions.map((action) => (
                <Bar key={action.id} timeline={timeline} action={action} at={timeline.actions.indexOf(action)} motion={motion} t={t} />
              ))}
            </div>
          </div>
        ) : (
          <PropertyLane key={lane.key} timeline={timeline} lane={lane} motion={motion} />
        ),
      )}
      <span className="motion-playhead" style={{ left: timeToX(view, motion.time) } as CSSProperties} aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------- the fields of the selection

function optionField(t: Translate, name: string, field: OptionField): { readonly offered?: readonly string[]; readonly display?: (value: string) => string; readonly accept?: (typed: string) => string } {
  if (field.kind === 'choice') {
    const words = (value: string) => t(`motion.value.${camel(value)}` as MessageId);
    return { offered: field.values, display: words, accept: chosenOf(field.values, words) };
  }
  if (field.kind === 'switch') {
    const words = (value: string) => t(`motion.value.${value}` as MessageId);
    return { offered: ['true', 'false'], display: words, accept: chosenOf(['true', 'false'], words) };
  }
  if (field.kind === 'text' && field.suggestions !== undefined) return { offered: field.suggestions };
  void name;
  return {};
}

function ActionFields({ timeline, action, at }: { readonly timeline: MotionTimeline; readonly action: TimelineAction; readonly at: number }) {
  const t = useT();
  const document = useEditorState((state) => state.document);
  const picking = useEditorState((state) => state.ui.motion?.picking?.action === action.id);
  const args = { timeline: timeline.name, action: action.id, at };
  const timed = EFFECTS[action.effect.kind].timed;
  const effectWords = (kind: string) => t(`motion.action.${camel(kind)}` as MessageId);
  const targetWords = (kind: string) => t(`motion.target.${camel(kind)}` as MessageId);
  const pickable = TARGET_KINDS.filter((kind) => kind !== 'element');
  const field = (name: string, value: string, extra: { readonly offered?: readonly string[]; readonly display?: (value: string) => string; readonly accept?: (typed: string) => string; readonly curve?: boolean } = {}) => (
    <PanelField key={name} entry={motionDoor(MOTION_DOORS.actionField(name))} args={args} value={value} label={t(`motion.field.${name}` as MessageId)} {...extra} />
  );
  const targetValue = 'className' in action.target ? action.target.className : 'component' in action.target ? action.target.component : null;
  return (
    <div className="motion-fields" data-motion-action={action.id}>
      {field('kind', action.effect.kind, { offered: EFFECT_KINDS, display: effectWords, accept: chosenOf(EFFECT_KINDS, effectWords) })}
      {field('target', action.target.kind, { offered: pickable, display: targetWords, accept: chosenOf(pickable, targetWords) })}
      {targetValue === null ? null : field('targetValue', targetValue)}
      <div className="field-row">
        <span className="field-row__label">{t('motion.pickTarget')}</span>
        <PanelButton entry={motionDoor(MOTION_DOORS.actionPick)} args={args} pressed={picking} icon={<Icon name="locate-fixed" size="sm" />}>
          {picking ? t('motion.picking') : t('motion.pickTarget')}
        </PanelButton>
      </div>
      {field('start', seconds(action.start))}
      {timed ? field('duration', seconds(action.duration)) : null}
      {timed ? field('easing', action.easing ?? '', { offered: easing.presets, curve: true }) : null}
      {timed ? field('repeat', String(action.repeat ?? 1), { offered: ['1', '2', '3', 'infinite'], display: (value) => (value === 'infinite' ? t('motion.value.infinite') : value) }) : null}
      {timed ? (
        <div className="field-row">
          <span className="field-row__label">{t('motion.field.yoyo')}</span>
          <PanelButton entry={motionDoor(MOTION_DOORS.actionYoyo)} args={{ ...args, value: action.yoyo !== true }} label={t('motion.field.yoyo')} pressed={action.yoyo === true} />
        </div>
      ) : null}
      {field('staggerEach', seconds(action.stagger?.each ?? 0))}
      {field('staggerFrom', action.stagger?.from ?? 'start', { offered: ['start', 'center', 'end', 'random'], display: (value) => t(`motion.value.${value}` as MessageId) })}
      {effectOptions(action.effect, document).map(([option, kind]) => (
        <PanelField key={option} entry={motionDoor(MOTION_DOORS.effectOption)} args={{ ...args, option }} value={optionText(action.effect, option)} label={t(`motion.option.${option}` as MessageId)} {...optionField(t, option, kind)} />
      ))}
      {action.effect.kind === 'animate' || action.effect.kind === 'split-text' ? (
        <PanelField entry={motionDoor(MOTION_DOORS.addProperty)} args={{ ...args, value: '' }} value="" label={t('motion.timeline.addProperty')} />
      ) : null}
      <PanelButton entry={motionDoor(MOTION_DOORS.actionsDelete)} args={{ timeline: timeline.name, actions: [action.id], at }} label={t('command.motion.removeActions')} icon={<Icon name="trash" size="sm" />} />
    </div>
  );
}

function KeyframeFields({ timeline, motion }: { readonly timeline: MotionTimeline; readonly motion: MotionUiState }) {
  const t = useT();
  const selected = motion.selectedKeyframes ?? [];
  const only = selected.length === 1 ? selected[0] : undefined;
  const action = only === undefined ? undefined : timeline.actions.find((one) => one.id === only.action);
  const track = action !== undefined && (action.effect.kind === 'animate' || action.effect.kind === 'split-text') ? action.effect.tracks.find((one) => one.id === only?.track) : undefined;
  const keyframe = track?.keyframes.find((one) => one.id === only?.keyframe);
  // the selected keyframe by its place too (the action's place, its property, its place in the track), as a scenario
  // names it
  const placed = action === undefined || track === undefined || keyframe === undefined ? {} : { at: timeline.actions.indexOf(action), property: track.property, keyframeAt: track.keyframes.indexOf(keyframe) };
  // keyframes paste into the selected action, else into the action of the selected keyframes
  const pasteInto = motion.selectedActions?.[0] ?? selected[0]?.action;
  const pasteAt = pasteInto === undefined ? -1 : timeline.actions.findIndex((one) => one.id === pasteInto);
  return (
    <div className="motion-fields motion-fields--keyframes">
      {only !== undefined && action !== undefined && track !== undefined && keyframe !== undefined ? (
        <>
          {(['value', 'easing', 'time', 'property'] as const).map((field) => (
            <PanelField
              key={field}
              entry={motionDoor(MOTION_DOORS.keyframeField(field))}
              args={{ timeline: timeline.name, keyframe: only, ...placed }}
              value={field === 'value' ? keyframe.value : field === 'easing' ? (keyframe.easing ?? '') : field === 'time' ? seconds(action.start + keyframe.time) : track.property}
              label={t(`motion.field.${field}` as MessageId)}
              {...(field === 'easing' ? { offered: easing.presets, curve: true } : {})}
            />
          ))}
        </>
      ) : null}
      {selected.length > 0 ? (
        <>
          <PanelButton entry={motionDoor(MOTION_DOORS.keyframesCopy)} label={t('command.motion.copyKeyframes')} icon={<Icon name="copy" size="sm" />} />
          <PanelButton entry={motionDoor(MOTION_DOORS.keyframesDelete)} args={{ timeline: timeline.name, keyframes: selected, ...placed }} label={t('command.motion.deleteKeyframes')} icon={<Icon name="trash" size="sm" />} />
        </>
      ) : null}
      {(motion.clipboard ?? []).length > 0 && pasteInto !== undefined && pasteAt >= 0 ? (
        <PanelButton entry={motionDoor(MOTION_DOORS.keyframesPaste)} args={{ timeline: timeline.name, action: pasteInto, at: pasteAt, keyframes: motion.clipboard }} label={t('command.motion.pasteKeyframes')} icon={<Icon name="clipboard-paste" size="sm" />} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the panel

export function MotionTimelinePanel() {
  const t = useT();
  const state = useEditorState((s) => s);
  const motion = motionUiOf(state.ui);
  const shown = shownTimeline(state);
  const found = shown === null ? null : findTimeline(state.document, shown);
  const timeline = found?.timeline ?? null;
  const said = readout(motion.time, timeline);
  const selectedAction = timeline !== null && motion.selectedActions?.length === 1 ? timeline.actions.findIndex((one) => one.id === motion.selectedActions?.[0]) : -1;
  return (
    <div className="motion-timeline" data-region="dock-motion" data-key-context="timeline">
      <TimelineList shown={shown} />
      <div className="motion-timeline__main">
        <div className="motion-timeline__toolbar" role="toolbar" aria-label={t('motion.timeline.title')}>
          {(['play', 'pause', 'stop'] as const).map((operation) => (
            <PanelButton key={operation} entry={motionDoor(MOTION_DOORS.preview(operation))} args={{ operation }} label={t(`motion.timeline.${operation}`)} icon={<Icon name={operation === 'stop' ? 'square' : operation} size="sm" />} pressed={operation === 'play' ? motion.playing === true : null} disabled={timeline === null} />
          ))}
          <PanelButton entry={motionDoor(MOTION_DOORS.record)} label={t('motion.timeline.record')} icon={<Icon name="circle-dot" size="sm" />} pressed={motion.recording === true} disabled={timeline === null} />
          <PanelButton entry={motionDoor(MOTION_DOORS.snap)} label={t('motion.timeline.snap')} icon={<Icon name="magnet" size="sm" />} pressed={motion.snapOff !== true} />
          <PanelButton entry={motionDoor(MOTION_DOORS.zoomOut)} label={t('motion.timeline.zoomOut')} icon={<Icon name="zoom-out" size="sm" />} />
          <PanelButton entry={motionDoor(MOTION_DOORS.zoomIn)} label={t('motion.timeline.zoomIn')} icon={<Icon name="zoom-in" size="sm" />} />
          {timeline === null ? null : <PanelButton entry={motionDoor(MOTION_DOORS.addMarker)} args={{ timeline: timeline.name }} label={t('command.motion.addMarker')} icon={<Icon name="flag" size="sm" />} />}
          {/* a readout, not a status: the status bar is the editor's one status region */}
          <span className="motion-timeline__readout">{t('motion.timeline.readout', { time: said.time, duration: said.duration })}</span>
          {motion.recording === true ? <span className="motion-timeline__recording">{t('motion.timeline.recording')}</span> : null}
        </div>
        {/* no timeline: the list beside says so once, its New timeline under it (the user's review of 2026-10-05) */}
        {timeline === null ? null : (
          <>
            <div className="motion-timeline__add">
              {(['after', 'with', 'at'] as const).map((placement) => {
                const words = (kind: string) => t(`motion.action.${camel(kind)}` as MessageId);
                return (
                  <PanelField key={placement} entry={motionDoor(MOTION_DOORS.addAction(placement))} args={{ timeline: timeline.name }} value="" label={t(`motion.timeline.add${placement === 'after' ? 'After' : placement === 'with' ? 'With' : 'At'}` as MessageId)} offered={EFFECT_KINDS} display={words} accept={chosenOf(EFFECT_KINDS, words)} />
                );
              })}
            </div>
            <div className="motion-timeline__scroller">
              <Track timeline={timeline} motion={motion} />
            </div>
            <div className="motion-timeline__selection">
              {selectedAction >= 0 ? <ActionFields timeline={timeline} action={timeline.actions[selectedAction] as TimelineAction} at={selectedAction} /> : null}
              <KeyframeFields timeline={timeline} motion={motion} />
              {timeline.markers.map((marker, markerAt) => (
                <div key={marker.id} className="motion-fields motion-fields--marker">
                  <PanelField entry={motionDoor(MOTION_DOORS.markerName)} args={{ timeline: timeline.name, marker: marker.id, markerAt }} value={marker.name} label={t('command.motion.renameMarker')} />
                  <PanelButton entry={motionDoor(MOTION_DOORS.markerRemove)} args={{ timeline: timeline.name, marker: marker.id, markerAt }} label={t('command.motion.removeMarker')} icon={<Icon name="x" size="sm" />} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
