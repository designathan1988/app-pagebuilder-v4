// The trust boundary of an element's interactions, without the manifest: the document validator reads it, and the
// generators and checkers load the validator under Node, where the manifest's runtime reader (import.meta.glob) is not
// there. The triggers and actions are the ones interactions.add's arguments list in the manifest, held as a record of
// the generated argument types, so the type check fails while the two differ (a missing or an extra key).
import type { CommandArgs } from '../../generated/commands.ts';
import { readAddress } from '../elements/address.ts';

type AddArgs = CommandArgs['interactions.add'];
const TRIGGERS: Readonly<Record<NonNullable<AddArgs['trigger']>, true>> = {
  click: true, hover: true, 'scroll-into-view': true, 'page-load': true, 'form-submit': true,
};
const ACTIONS: Readonly<Record<NonNullable<AddArgs['action']>, true>> = {
  show: true, hide: true, 'toggle-class': true, 'play-animation': true, 'scroll-to': true, 'open-link': true,
};

// the longest wait an action takes (10 s): a longer one reads as a site that does not answer
export const MAX_DELAY = 10_000;

// a class the toggle-class action toggles and the scope names: a CSS class name's grammar (core/design/classes.ts)
const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

// The trust boundary of an element's interactions (the audit's EV2): what the document validator reads of every node
// that holds some, and what interactions.add reads of the options a door hands it. An interaction is an object of the
// model's fields only; its trigger and action are the manifest's; its target names an element of the document; its
// class and its scope are class names, its animation a name; its address passes the one rule of an address, so none
// runs code in the exported script; once is a flag, a delay whole ms up to MAX_DELAY, newTab only true.
const INTERACTION_FIELDS: ReadonlySet<string> = new Set(['trigger', 'action', 'target', 'className', 'animation', 'address', 'newTab', 'scope', 'once', 'delay']);
export function interactionProblems(value: unknown, nodeIds: ReadonlySet<string>): { readonly field: string; readonly message: string }[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [{ field: '', message: 'an interaction is an object' }];
  const held = value as Readonly<Record<string, unknown>>;
  const out: { field: string; message: string }[] = [];
  const bad = (field: string, text: string) => out.push({ field, message: text });
  for (const key of Object.keys(held)) if (!INTERACTION_FIELDS.has(key)) bad(key, `"${key}" is no field of an interaction`);
  if (typeof held.trigger !== 'string' || !Object.hasOwn(TRIGGERS, held.trigger)) bad('trigger', `"${String(held.trigger)}" is no trigger (${Object.keys(TRIGGERS).join(', ')})`);
  if (typeof held.action !== 'string' || !Object.hasOwn(ACTIONS, held.action)) bad('action', `"${String(held.action)}" is no action (${Object.keys(ACTIONS).join(', ')})`);
  if ('target' in held && (typeof held.target !== 'string' || !nodeIds.has(held.target))) bad('target', `"${String(held.target)}" names no element of the document`);
  for (const field of ['className', 'scope'] as const) if (field in held && (typeof held[field] !== 'string' || !CLASS_NAME.test(held[field] as string))) bad(field, `"${String(held[field])}" is no class name`);
  if ('animation' in held && (typeof held.animation !== 'string' || !CLASS_NAME.test(held.animation))) bad('animation', `"${String(held.animation)}" is no animation name`);
  if ('address' in held && (typeof held.address !== 'string' || !readAddress(held.address).ok)) bad('address', `"${String(held.address)}" is not an address this page can use`);
  if ('newTab' in held && held.newTab !== true) bad('newTab', 'newTab is true, or absent');
  if ('once' in held && typeof held.once !== 'boolean') bad('once', 'once is true or false');
  if ('delay' in held && (typeof held.delay !== 'number' || !Number.isInteger(held.delay) || held.delay < 0 || held.delay > MAX_DELAY)) bad('delay', `a delay is whole ms from 0 to ${String(MAX_DELAY)}`);
  return out;
}
