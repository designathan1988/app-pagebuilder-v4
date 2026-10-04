// The background image (INVENTORY.md, owners; specs props-background, gradient-editor): style.setBackgroundImage
// writes the image a field hands it into its property (background-image; never the background shorthand, so the colour
// under it stays) of every selected element, in one undo step. Every control of the background's image writes through
// it (Problems in Pager 5 of the gradient editor):
//  - the image field hands the text typed (`value`): none or one image address, bare or inside url() (the codec
//    image-layers reads it and writes url("…")); an address with another scheme than a web address or a path inside the
//    project is refused naming it (status.url.unsafe), text that is no image as any value a field does not take;
//  - the gradient editor hands an edit (`edit`) of the gradient the primary selected element holds
//    (core/style/gradient.ts):
//    a gradient to edit that is not there is refused (status.gradient.none), a stop removed below two too
//    (status.gradient.minStops), a value the browser does not take as any value a field does not take.
//    `reset` (Remove the gradient) takes the declaration away (removeStyle, reset.ts), never a background-image: none
//    left in its place; the colour under it stays.
import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { readAddress } from '../elements/address.ts';
import { imageAddress } from './codecs.ts';
import { splitLayers } from './codecs.ts';
import { editedGradient, parseGradient, type GradientEdit } from './gradient.ts';
import { removeStyle } from './reset.ts';
import { propertyName, readValue, typedText, withTargets, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';
import { argumentRefused } from '../store/args.ts';

export const setBackgroundImageCommand = registerHandler('style.setBackgroundImage', (given, { property, value, edit, targets }) => {
  const context = withTargets(given, targets);
  if (context === null) return { kind: 'change' };
  if (typeof property !== 'string') throw new Error('style.setBackgroundImage: a door hands the property it edits');
  const { state, rules } = context;
  let text: string;
  if (edit !== undefined && edit !== null) {
    if (typeof edit !== 'object' || Array.isArray(edit)) throw new Error('style.setBackgroundImage: an edit is an object');
    // Remove the gradient takes the gradient's layer away and leaves the rest (an image under it), or the whole
    // declaration when nothing is left; the layers are one owner's (codecs.ts splitLayers, A3.34)
    if ((edit as GradientEdit).reset === true) {
      const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
      if (primary === null) return { kind: 'change' };
      const rest = splitLayers(storedValue(primary.node, property, rules)).filter((layer) => parseGradient(layer) === null);
      if (rest.length === 0) return removeStyle(context, property);
      const read = readValue(context, property, rest.join(', '));
      if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: rest.join(', ') }) };
      return writeStyle(context, property, read.css);
    }
    const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
    if (primary === null) return { kind: 'change' };
    const edited = editedGradient(storedValue(primary.node, property, rules), edit as GradientEdit);
    if ('refused' in edited) {
      if (edited.refused === 'noGradient') return { kind: 'refused', message: message('status.gradient.none', { name: primary.node.name }) };
      if (edited.refused === 'minStops') return { kind: 'refused', message: message('status.gradient.minStops') };
      // what the edit typed, quoted once as typed: not the stop it names (spec inspector-number-fields, Problems in
      // Pager 3)
      return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: typedText(Object.fromEntries(Object.entries(edit as Record<string, unknown>).filter(([name]) => name !== 'stop'))) }) };
    }
    text = edited.text;
  } else {
    if (typeof value !== 'string') return { kind: 'refused', message: argumentRefused('value') };
    const address = imageAddress(value);
    if (address !== null && address !== '') {
      // the one rule of an address (core/elements/address.ts)
      const read = readAddress(address);
      if (!read.ok) return { kind: 'refused', message: read.refusal };
    }
    text = value;
  }
  const read = readValue(context, property, text);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: text }) };
  return writeStyle(context, property, read.css);
});
