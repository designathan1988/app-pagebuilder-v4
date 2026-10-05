// The Timeline panel (archive/DESIGN.md "Dock and status bar": the dock-timeline region; group 18): the animations of
// the selected element, one row each, the settings of the one the timeline shows, and the track with its ruler,
// playhead and keyframes. Every control is a door of the manifest placed in the region (the rows of timeline.show,
// animation .create's button and its name field, animation.rename's field, animation.delete, the seven settings of
// animation.setSettings, the play controls, the ruler of timeline.setPlayhead and the keyframes of
// animation.moveKeyframe, addKeyframe, setKeyframeEasing and deleteKeyframe). The two drags (the playhead along the
// ruler, a keyframe along the track) are the pointer owner's; this panel only draws them and runs their doors' clicks.
import { useState, type CSSProperties } from 'react';
import { animationsOf, defaultSetting, SETTINGS, settingLabel } from '../../core/animation/animation.ts';
import { locate, type Animation } from '../../core/document/model.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { manifest } from '../../manifest/runtime.ts';
import { Icon } from '../doors/door.tsx';
import { PanelButton, PanelField, offeredValues } from '../shell/panel-field.tsx';
import { useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { keyframeMarks, playheadPercent, shownAnimation, timelineOf, trackWidth } from './playhead.ts';

// The panel's doors, read from the manifest's own data: the panel-control doors the timeline panel draws (its panel is
// `timeline`, its control names are the drawing's), and the two panel drags of the timeline's gestures.
const control = (name: string): DoorEntry | null =>
  manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'timeline' && d.door.control === name) ?? null;
const dragDoor = (source: string): DoorEntry | null => manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === source) ?? null;

const NEW_ANIMATION = control('new-animation');
const NAME_FIELD = control('animation-name-field');
const DELETE_ANIMATION = control('animation-delete');
const ANIMATION_ROW = control('animation-row');
const RULER = dragDoor('playhead');
const KEYFRAME = dragDoor('keyframe');
const ADD_KEYFRAME = control('add-keyframe');
const KEYFRAME_EASING = control('keyframe-easing');
const DELETE_KEYFRAME = control('keyframe-delete');
const PLAY = control('play');
const PAUSE = control('pause');
const STOP = control('stop');
const LOOP = control('loop');
// the playback controls, by the setting each stands for (the manifest's own list of the settings)
const SETTING_DOORS: readonly { readonly setting: string; readonly entry: DoorEntry }[] = SETTINGS.flatMap((setting) => {
  const entry = control(`setting-${setting}`);
  return entry === null ? [] : [{ setting, entry }];
});

// the value a setting's field shows: what the animation stores under it (the settings are the manifest's own list)
const settingValue = (animation: Animation, setting: string): string => animation.settings[setting] ?? '';

// The button that asks for an animation's name (spec timeline-animations): the door's control opens a field, the
// person types the name and Enter runs animation.create with it (a control that opens a field, as Save the styles as a
// class does).
function NewAnimation({ ready }: { readonly ready: boolean }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (NEW_ANIMATION === null) return null;
  if (!asking) {
    return (
      <button
        type="button"
        className={`door door--icon-button door--sm${ready ? '' : ' is-unavailable'}`}
        data-door={NEW_ANIMATION.ref}
        data-args={JSON.stringify(NEW_ANIMATION.door.args)}
        aria-disabled={ready ? undefined : true}
        aria-haspopup="dialog"
        aria-label={t('timeline.newAnimation')}
        title={t('timeline.newAnimation')}
        onClick={() => {
          if (ready) setAsking(true);
        }}
      >
        {/* the small icon button, its name its tooltip and its accessible name (the canonical Animations' + ) */}
        <Icon name="plus" size="sm" />
      </button>
    );
  }
  return <PanelField entry={NEW_ANIMATION} value="" label={t('timeline.name')} disabled={!ready} autoFocus onDone={() => setAsking(false)} />;
}

export function TimelinePanel() {
  const t = useT();
  const state = useEditorState((s) => s);
  const primary = state.selection[0];
  const node = primary === undefined ? null : (locate(state.document, primary)?.node ?? null);
  const animations = node === null ? [] : animationsOf(node);
  const shown = shownAnimation(state);
  const names = animations.map((animation) => animation.name);
  const timeline = timelineOf(state.ui);
  const percent = playheadPercent(state);
  const keyframeUnder = shown !== null && shown.animation.keyframes.some((k) => k.offset === Math.round(percent)) ? Math.round(percent) : null;
  const selected = state.selection.length === 1;
  const width = trackWidth();
  const playhead = keyframeUnder;
  const shownName = shown?.animation.name ?? null;

  return (
    <div className="timeline" data-region="dock-timeline" data-key-context="timeline">
      <div className="timeline__side">
        <p className="timeline__title">{t('timeline.animations')}</p>
        {/* one empty state, saying what to do next: an element to select (none, or several, selected), else that the
            element holds none, the + under it adding one (the user's review of 2026-10-05) */}
        {names.length === 0 ? (
          <p className="timeline__none">{t(node === null || !selected ? 'timeline.empty' : 'timeline.noAnimations')}</p>
        ) : (
          <ul className="timeline__rows">
            {names.map((name) => (
              <li key={name} className="timeline__row">
                <PanelButton entry={ANIMATION_ROW as DoorEntry} args={{ animation: name }} pressed={name === shownName} disabled={false}>
                  {name}
                </PanelButton>
                {DELETE_ANIMATION !== null ? <PanelButton entry={DELETE_ANIMATION} args={{ animation: name }} icon={<Icon name="trash" size="sm" />} /> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="timeline__row">
          <NewAnimation ready={selected} />
        </div>
        {shown !== null && shownName !== null ? (
          <>
            <div className="timeline__row">
              {/* the name reads as the row's words until it is edited (the canonical Animations' row) */}
              {NAME_FIELD !== null ? <span className="timeline__name"><PanelField entry={NAME_FIELD} args={{ animation: shownName }} value={shownName} label={t('timeline.name')} /></span> : null}
            </div>
            <p className="timeline__title">{t('timeline.settings')}</p>
            <div className="timeline__settings">
              {/* a setting the animation holds in the Here ink, one left at its default in the default ink (the canonical
                  timeline's o-here and o-def) */}
              {SETTING_DOORS.map(({ setting, entry }) => (
                <span key={setting} className={`timeline__setting ${shown.animation.settings[setting] === defaultSetting(setting) ? 'is-default' : 'is-set'}`}>
                  <PanelField
                    entry={entry}
                    args={{ animation: shownName }}
                    value={settingValue(shown.animation, setting)}
                    label={t(settingLabel(setting))}
                    offered={offeredValues(entry)}
                  />
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="timeline__track-area" style={{ width: width + 40 } as CSSProperties}>
        <div className="timeline__controls">
          {PLAY !== null ? (
            <PanelButton entry={PLAY} args={{ animation: shownName ?? '' }} pressed={timeline.playing === true} disabled={shown === null}>
              <Icon name="play" size="sm" />
            </PanelButton>
          ) : null}
          {PAUSE !== null ? (
            <PanelButton entry={PAUSE} args={{ animation: shownName ?? '' }} disabled={shown === null}>
              <Icon name="pause" size="sm" />
            </PanelButton>
          ) : null}
          {STOP !== null ? (
            <PanelButton entry={STOP} args={{ animation: shownName ?? '' }} disabled={shown === null}>
              <Icon name="square" size="sm" />
            </PanelButton>
          ) : null}
          {LOOP !== null ? (
            <PanelButton entry={LOOP} args={{ animation: shownName ?? '' }} pressed={timeline.loop === true} disabled={shown === null}>
              <Icon name="repeat" size="sm" />
            </PanelButton>
          ) : null}
        </div>
        <div className="timeline__track" style={{ width } as CSSProperties} data-track="">
          <div
            className="timeline__ruler"
            data-ruler=""
            data-door={RULER?.ref}
            data-args="{}"
            title={t('command.timeline.playhead')}
          >
            <span className="timeline__playhead" data-playhead="" style={{ left: `${(percent / 100) * 100}%` } as CSSProperties} />
          </div>
          <div className="timeline__lane">
            {shown !== null
              ? keyframeMarks(shown.animation).map((mark) => (
                  <span
                    key={mark.offset}
                    className={`timeline__keyframe${mark.offset === playhead ? ' is-current' : ''}`}
                    data-keyframe-marker=""
                    data-door={KEYFRAME?.ref}
                    data-args={KEYFRAME === null ? undefined : JSON.stringify({ animation: shownName, keyframe: mark.offset })}
                    style={{ left: `${(mark.x / width) * 100}%` } as CSSProperties}
                    title={t('timeline.keyframeOffset', { offset: String(mark.offset) })}
                  >
                    <Icon name="diamond" size="sm" />
                  </span>
                ))
              : null}
          </div>
        </div>
        <div className="timeline__row">
          {ADD_KEYFRAME !== null && shown !== null ? (
            <PanelButton
              entry={ADD_KEYFRAME}
              args={{ animation: shownName ?? '', offset: Math.round(percent) }}
              label={t('timeline.addKeyframe')}
              onDone={() => undefined}
            >
              <Icon name="diamond" size="sm" /> {t('timeline.addKeyframe')}
            </PanelButton>
          ) : null}
          {KEYFRAME_EASING !== null && shown !== null && playhead !== null ? (
            <PanelField
              entry={KEYFRAME_EASING}
              args={{ animation: shownName ?? '', keyframe: playhead }}
              value={shown.animation.keyframes.find((k) => k.offset === playhead)?.easing ?? ''}
              label={t('command.animation.easing')}
              offered={offeredValues(KEYFRAME_EASING)}
              curve
            />
          ) : null}
          {DELETE_KEYFRAME !== null && shown !== null && playhead !== null ? (
            <PanelButton entry={DELETE_KEYFRAME} args={{ animation: shownName ?? '', keyframe: playhead }} label={t('command.animation.deleteKeyframe')} icon={<Icon name="trash" size="sm" />} onDone={() => undefined} />
          ) : null}
        </div>
        {shown === null ? null : <p className="timeline__hint">{t('timeline.keyframeOffset', { offset: String(Math.round(percent)) })}</p>}
      </div>
    </div>
  );
}
