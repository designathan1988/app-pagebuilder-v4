// Borders and radii (INVENTORY.md, owners; spec props-border-outline). Every border value is stored as its
// longhands and written by one command per kind:
//  - style.setBorder writes the width, the style and the colour it is given, of all sides (each through its composite,
//    border-width, border-style, border-color: one to four values, top, right, bottom, left) or of one side (its
//    longhands), in one command and one undo step, through writeStyle, so the couplings run (a width written while
//    the side's style is none also writes solid, unless the same write names a style);
//  - style.setRadius writes the radius of all corners (border-radius: one to four values) or of one corner.
// A value a field does not take is refused naming that field (status.value.invalid); a locked element refuses both.
// `borderArgs` parts the text typed in a border field into the arguments of style.setBorder, by the codec of what the
// field edits (the border of every side, one side, one aspect of every side, one side's width).
import { message, registerHandler } from '../commands/registry.ts';
import type { ModelRules } from '../document/validate.ts';
import { codecOf } from './codecs.ts';
import { declarationsOf, factsOf, propertyName, readValue, withTargets, writeStyle } from './set.ts';

// the aspects of a border side, in its composite's order (border-top: width, style, colour): style.setBorder's
// arguments of the same names
const ASPECTS = Object.keys({ width: 0, style: 0, color: 0 });
type Aspects = { width?: string; style?: string; color?: string };

// the property one aspect of the sides is written through: a composite of every side, or one side's longhand
function aspectTarget(sides: string, aspect: string, rules: ModelRules): string {
  if (sides === 'all') return `border-${aspect}`;
  const longhand = rules.compositeFacts.get(`border-${sides}`)?.longhands[ASPECTS.indexOf(aspect)];
  if (longhand === undefined) throw new Error(`properties.json: border-${sides} has no ${aspect}`);
  return longhand;
}

// what the status bar names the write by: the field the aspects written make up
function writtenAs(sides: string, aspects: readonly string[]): string {
  if (sides === 'all') return aspects.length === 1 ? `border-${aspects[0] ?? ''}` : 'border';
  return aspects.length === 1 && aspects[0] === ASPECTS[0] ? `border-${sides}-${ASPECTS[0]}` : `border-${sides}`;
}

export const setBorderCommand = registerHandler('style.setBorder', (asked, args) => {
  const context = withTargets(asked, args.targets);
  if (context === null) return { kind: 'change' };
  const given = ASPECTS.flatMap((aspect) => {
    const text = (args as Aspects)[aspect as keyof Aspects];
    return typeof text === 'string' && text.trim() !== '' ? [[aspect, text.trim()] as const] : [];
  });
  const values: Record<string, string> = {};
  for (const [aspect, text] of given) {
    const target = aspectTarget(args.sides, aspect, context.rules);
    const read = readValue(context, target, text);
    if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(target, context.rules), value: text }) };
    Object.assign(values, declarationsOf(target, read, context.rules));
  }
  if (given.length === 0) return { kind: 'change' };
  return writeStyle(
    context,
    writtenAs(
      args.sides,
      given.map(([aspect]) => aspect),
    ),
    given.map(([, text]) => text).join(' '),
    values,
  );
});

// the corners of style.setRadius's `corners`, in border-radius's order (its longhands: top left, top right, bottom
// right, bottom left)
export const setRadiusCommand = registerHandler('style.setRadius', (given, { corners, value, targets }) => {
  const context = withTargets(given, targets);
  if (context === null) return { kind: 'change' };
  const target = corners === 'all' ? 'border-radius' : `border-${corners}-radius`;
  const read = readValue(context, target, value);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(target, context.rules), value }) };
  return writeStyle(context, target, read.css, declarationsOf(target, read, context.rules));
});

// The arguments of style.setBorder that a text typed in a border field stands for, the field's sides aside: the
// width, style and colour of a side (or of every side) parted by its codec, or the one aspect the field edits. Text the
// codec cannot part goes whole to the field's first aspect, so style.setBorder refuses it naming the field.
export function borderArgs(target: string, text: string, rules: ModelRules): Aspects {
  const composite = rules.compositeFacts.get(target);
  const codecId = composite?.codec ?? rules.propertyFacts.get(target)?.codec ?? '';
  // one aspect of every side (border-width: box-sides), named after it; one side's width (line-width)
  if (composite !== undefined && composite.longhands.length === 4) return { [target.slice('border-'.length)]: text };
  if (composite === undefined) return { [ASPECTS[0] ?? '']: text };
  const read = codecOf(codecId)?.read(text, factsOf(target, rules));
  if (read === null || read === undefined || read.kind !== 'longhands') return { [ASPECTS[0] ?? '']: text };
  // the border of every side holds the four widths, styles and colours; a side its width, style and colour
  const step = composite.longhands.length / ASPECTS.length;
  return Object.fromEntries(ASPECTS.flatMap((aspect, i) => (read.values[i * step] ? [[aspect, read.values[i * step] ?? '']] : [])));
}
