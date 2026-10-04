// Grid tracks (PRODUCT.md §5; spec props-grid-container, Problems in Pager 3; the user's real-use audit, item A1.2):
// the one owner of the track list a grid's axis has and of the value it is written as. A value of equal tracks written
// in the repeat form the templates use ("repeat(3, minmax(0, 1fr))") reads as its tracks; one written as a list
// ("1fr 2fr auto") reads as its tracks; none (none, a value no track list, or no value of its own) reads as no tracks.
// Written back, equal tracks take the repeat form and any other list is joined, so adding a column to three equal
// columns gives "repeat(4, minmax(0, 1fr))" and never a appended track beside a repeat.
const DEFAULT_TRACK = 'minmax(0, 1fr)';
const REPEAT = /^repeat\(\s*(\d+)\s*,\s*([\s\S]+)\s*\)$/i;

import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { commandOf, manifest, numberConstantAt } from '../../manifest/runtime.ts';
import { propertyName, readValue, shownText, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';
import { argumentRefused } from '../store/args.ts';

// the tracks a value holds, in order; none for none or an unreadable value
export function tracksOf(value: string | undefined): readonly string[] {
  const held = value?.trim() ?? '';
  if (held === '' || held.toLowerCase() === 'none') return [];
  const repeated = REPEAT.exec(held);
  if (repeated !== null) {
    const count = Number.parseInt(repeated[1] as string, 10);
    const track = (repeated[2] as string).trim();
    return count > 0 ? Array.from({ length: count }, () => track) : [];
  }
  // a track holding no space of its own (minmax(0, 1fr)) stays one track: the split is at the spaces outside
  // parentheses
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of held) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (current !== '') tracks.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current !== '') tracks.push(current);
  return tracks;
}

// the value a list of tracks is written as: none for none, a single track plainly, the repeat form when every track is
// the same, else the list
export function tracksToValue(tracks: readonly string[]): string {
  if (tracks.length === 0) return 'none';
  const first = tracks[0] as string;
  if (tracks.length === 1) return first;
  return tracks.every((track) => track === first) ? `repeat(${tracks.length}, ${first})` : tracks.join(' ');
}

// The tracks a value holds with one more track (the Add column and Add row buttons): one like the tracks it already
// holds while they are all the same (three equal columns take a fourth and keep their repeat form, the audit's
// acceptance), the default track otherwise, and the first track of a grid that holds none.
export function withTrackAdded(value: string | undefined, track: string = DEFAULT_TRACK): string {
  const tracks = tracksOf(value);
  const first = tracks[0];
  const added = first !== undefined && tracks.every((held) => held === first) ? first : track;
  return tracksToValue([...tracks, added]);
}

// the tracks a value holds without its last (the Remove column and Remove row buttons); none when it holds {none}
export function withTrackRemoved(value: string | undefined): string {
  const tracks = tracksOf(value);
  return tracksToValue(tracks.slice(0, -1));
}

// the tracks a value holds with one of them written differently (the field of a track); an index it does not hold is a
// defect of the caller
export function withTrackSet(value: string | undefined, index: number, track: string): string {
  const tracks = tracksOf(value);
  if (index < 0 || index >= tracks.length) throw new Error(`withTrackSet: the grid holds no track ${String(index)}`);
  return tracksToValue(tracks.map((held, at) => (at === index ? track : held)));
}

// The tracks a grid that lays one equal track per child writes, and the overrides by breakpoint (the user's real-use
// audit, item A1.4): one track per child at the base breakpoint and, per breakpoint, the number interactions.json
// names (layout.gridTracks.<breakpoint>: two at Tablet while it holds more, one at Phone), never more than it holds
// children, and no override where the number does not differ from the base one. The one owner of the responsive grid:
// the grid wrapper's wrap command and the template that names it both write what this gives, and the property the
// columns are written as is the one the track editor's own doors carry (the manifest's data).
export function tracksForChildren(count: number, rules: Pick<ModelRules, 'breakpoints'>): { readonly property: string; readonly columns: string; readonly layers: Readonly<Record<string, string>> } {
  const tracks = (n: number): string => tracksToValue(Array.from({ length: Math.max(1, n) }, () => DEFAULT_TRACK));
  const layers: Record<string, string> = {};
  for (const breakpoint of manifest.properties.breakpoints) {
    if (breakpoint.base || !rules.breakpoints.has(breakpoint.id)) continue;
    const named = numberConstantAt('layout.gridTracks', breakpoint.id);
    if (named !== undefined && named < count) layers[breakpoint.id] = tracks(named);
  }
  return { property: COLUMNS_PROPERTY, columns: tracks(count), layers };
}

// style.setGridTracks (spec props-grid-container, Problems in Pager 3; the user's real-use audit, item A1.2): what the
// track editor's doors ask of one axis of the selected grid — add the default track, remove the last, or write one
// track differently by its place. The tracks the element holds are read here and the value written as this module
// writes it (a repeat of equal tracks, else the list), then read and written as any value of the property
// (style.set's own reader and writer). A place the grid does not hold, and a track the property does not take, are
// refused with the value named; a locked element refuses as every style write does.
export type TrackEdit =
  | { readonly add: true }
  | { readonly remove: true }
  | { readonly track: number; readonly value: string };

export function editedTracks(held: string | undefined, edit: TrackEdit): string | { readonly refused: 'noTrack' } {
  if ('add' in edit) return withTrackAdded(held);
  if ('remove' in edit) return withTrackRemoved(held);
  const tracks = tracksOf(held);
  if (edit.track < 0 || edit.track >= tracks.length) return { refused: 'noTrack' };
  return withTrackSet(held, edit.track, edit.value);
}

export const setGridTracksCommand = registerHandler('style.setGridTracks', (context, { property, track, value, edit }) => {
  if (typeof property !== 'string' || (typeof track !== 'number' && (typeof edit !== 'object' || edit === null || Array.isArray(edit)))) {
    return { kind: 'refused', message: argumentRefused(typeof property !== 'string' ? 'property' : 'track') };
  }
  const { state, rules } = context;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  // a track's field hands its place and the text typed; the add and remove buttons hand an edit
  const asked: TrackEdit = typeof track === 'number' ? { track, value: typeof value === 'string' ? value : '' } : (edit as TrackEdit);
  // the tracks the element shows here: its own at the edited breakpoint and state, else the ones it inherits along the
  // cascade (another breakpoint, a class) — editing an inherited track writes the whole list here (J10)
  const held = storedValue(primary.node, property, rules) ?? shownText(primary.node, property, rules);
  const written = editedTracks(held, asked);
  // a place the grid does not hold is a refusal naming the element, not a defect of the door
  if (typeof written !== 'string') return { kind: 'refused', message: message('status.tracks.noTrack', { name: primary.node.name }) };
  const read = readValue(context, property, written);
  // what the person typed is named when it is the value refused; the track's place otherwise
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: 'value' in asked ? String(asked.value) : written }) };
  return writeStyle(context, property, read.css);
});

// The property a grid's columns are written as: the first of the track editor's own doors' arguments (the manifest's
// data; the doors are declared columns first, as the inspector draws them). Read by tracksForChildren.
export const COLUMNS_PROPERTY: string = (() => {
  const doors = commandOf(setGridTracksCommand.command).entryPoints.filter((d) => typeof d.args.property === 'string');
  return String(doors[0]?.args.property ?? '');
})();
