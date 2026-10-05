// The colour picker (INVENTORY.md, owners; spec color-picker): the picker open on a property of the
// selection (ui.colorPicker: the property, the value the primary selected element holds for it when it opened, the
// format its channels show). colorPicker.open opens it from a colour field's swatch; colorPicker.setFormat shows its
// channels as HSB, RGB, Hex, OKLCH or OKLab (color-picker-oklch); colorPicker.setChannel writes the colour a channel
// typed in them makes (core/style/color.ts editedColour: a value out of the channel's range is refused);
// colorPicker.apply and colorPicker.cancel close it and say how (ui.colorPickerClosed). Its session is one gesture of
// the pointer owner (src/editor/input/pointer.ts): opened when the picker opens, every part writes style.set through it
// (the canvas shows the colour live), Apply commits it (one undo step), Cancel, Escape (drag.cancel) or another closing
// cancels it (the value it opened with is back, no undo step). Apply also puts the colour it keeps first among the
// recent colours of the preferences (color-swatches-eyedropper: the last RECENT_COLOURS applied, each once), which
// every picker lists.
import { message, registerHandler } from '../../core/commands/registry.ts';
import { locate } from '../../core/document/model.ts';
import { editedColour, type ColorChannel } from '../../core/style/color.ts';
import { writePropertyText } from '../../core/style/set.ts';
import { storedValue } from '../../core/style/stored.ts';
import type { MessageId } from '../../generated/ids.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import type { EditorUi } from '../state.ts';
import { RECENT_COLOURS } from '../preferences/preferences.ts';

type ColorFormat = CommandArgs['colorPicker.setFormat']['format'];

export interface ColorPickerState {
  readonly property: string;
  // what the primary selected element held for the property when the picker opened ('' for none of its own)
  readonly previous: string;
  readonly format: ColorFormat;
}

// how the last session ended, numbered so each ending is heard once
export interface ColorPickerClosed {
  readonly applied: boolean;
  readonly count: number;
}

export const openColorPicker = registerHandler<'colorPicker.open', EditorUi>('colorPicker.open', ({ state, rules }, { property }) => {
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const format = state.ui.colorPicker?.format ?? 'hsb';
  return { kind: 'change', ui: { ...state.ui, colorPicker: { property, previous: storedValue(primary.node, property, rules) ?? '', format } } };
});

export const setColorFormat = registerHandler<'colorPicker.setFormat', EditorUi>(
  'colorPicker.setFormat',
  ({ state }, { format }) => (state.ui.colorPicker === null ? { kind: 'change' } : { kind: 'change', ui: { ...state.ui, colorPicker: { ...state.ui.colorPicker, format } } }),
  (state, args) => state.ui.colorPicker?.format === args.format,
);

// each channel's name, as the picker labels its field and a refusal names it
export const CHANNEL_LABELS: Readonly<Record<ColorChannel, MessageId>> = {
  h: 'colorPicker.hue',
  s: 'colorPicker.saturation',
  v: 'colorPicker.brightness',
  r: 'colorPicker.red',
  g: 'colorPicker.green',
  b: 'colorPicker.blue',
  hex: 'colorPicker.hexDigits',
  alpha: 'colorPicker.alpha',
  'ok-l': 'colorPicker.okLightness',
  'ok-c': 'colorPicker.okChroma',
  'ok-h': 'colorPicker.okHue',
  'ok-a': 'colorPicker.okA',
  'ok-b': 'colorPicker.okB',
};

// each channel's key inside its field (jornada02 GENERALISATION: H S B A, the quick panel's key-in-field rule): the
// colour models' own letters, the same in every language
export const CHANNEL_KEYS: Readonly<Record<ColorChannel, string>> = { h: 'H', s: 'S', v: 'B', r: 'R', g: 'G', b: 'B', hex: '#', alpha: 'A', 'ok-l': 'L', 'ok-c': 'C', 'ok-h': 'H', 'ok-a': 'a', 'ok-b': 'b' };

// A channel typed in the picker: the colour the primary selected element holds for the property (else the one the
// picker shows, `base`: the page's) with that channel changed, written into every selected element like style.set —
// through the same writer, so a colour written into a composite (a border's colour, border-color) lands on the
// composite's longhands exactly as a typed one does.
export const setColorChannel = registerHandler<'colorPicker.setChannel', EditorUi>('colorPicker.setChannel', (context, { property, channel, text, base }) => {
  const { state, rules } = context;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  const colour = editedColour(storedValue(primary.node, property, rules) ?? base ?? '', channel, text, state.ui.colorPicker?.format ?? '');
  if (colour === null) return { kind: 'refused', message: message('status.colorPicker.invalid', { channel: { key: CHANNEL_LABELS[channel] }, value: text }) };
  return writePropertyText(context, property, colour);
});

const closed = (ui: EditorUi, applied: boolean): EditorUi => ({ ...ui, colorPicker: null, colorPickerClosed: { applied, count: ui.colorPickerClosed.count + 1 } });

const NO_RECENT: readonly string[] = [];
export const recentColours = (ui: EditorUi): readonly string[] => ui.preferences.recentColors ?? NO_RECENT;

export const applyColorPicker = registerHandler<'colorPicker.apply', EditorUi>('colorPicker.apply', ({ state, rules }) => {
  const picker = state.ui.colorPicker;
  if (picker === null) return { kind: 'change' };
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  const applied = primary === null ? undefined : storedValue(primary.node, picker.property, rules);
  const ui = closed(state.ui, true);
  if (applied === undefined) return { kind: 'change', ui };
  const recent = [applied, ...recentColours(state.ui).filter((c) => c !== applied)].slice(0, RECENT_COLOURS);
  return { kind: 'change', ui: { ...ui, preferences: { ...ui.preferences, recentColors: recent } } };
});

export const cancelColorPicker = registerHandler<'colorPicker.cancel', EditorUi>('colorPicker.cancel', ({ state }) =>
  state.ui.colorPicker === null ? { kind: 'change' } : { kind: 'change', ui: closed(state.ui, false), message: message('status.colorPicker.cancelled') },
);
