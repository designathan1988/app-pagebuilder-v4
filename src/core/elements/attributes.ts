// An element's ID, classes and attributes (INVENTORY.md, owners; feature props-attributes, and every element
// feature whose Settings fields are attributes of elements.json): element.setId, element.setClasses and
// element.setAttribute, each acting on its door's node or the one selected element.
//  - The text is taken without the spaces around it; an empty one removes the ID or the attribute (the element then
//    has none, and nothing invents one); the same value records nothing.
//  - An ID starts with a letter and holds letters, digits, "-" and "_" (status.id.invalid); no two nodes share one
//    (status.id.duplicate names the node that has it).
//  - Classes are the words of the text, each a CSS class name (status.attribute.invalid names the first that is not),
//    kept once each in their order.
//  - An attribute's value follows its value type (elements.json): a text as typed; a URL through the one rule of a
//    resource address (core/elements/address.ts: status.url.unsafe, status.url.malformed); a number as a number; a
//    keyword one of its keywords; a boolean true or absent (status.attribute.invalid for anything else).
//  - A locked element, or one inside a locked element, keeps its values (spec lock-element).
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import { allNodes, locate, walk, type DocNode, type DocumentJson, type Location } from '../document/model.ts';
import { formAttributeIssue } from '../forms/config.ts';
import { customAttributeRefusal, reservedAttributeOwner, type ModelRules } from '../document/validate.ts';
import { missingClassDefinitions, validClassName } from '../design/classes.ts';
import { hasIncompatibleMask, inputTypeOf } from './inputs.ts';
import type { Patch } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { readAddress } from './address.ts';
import { referencesOf } from './references.ts';

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

// the element a door names, else the one selected; null when it names none and not one element is selected (refused:
// the random probe found the door's command reached with a selection of none or of several)
function nodeOf(state: { readonly document: DocumentJson; readonly selection: readonly NodeId[] }, target: NodeId | undefined): Location | null {
  const id = target ?? (state.selection.length === 1 ? state.selection[0] : undefined);
  if (id === undefined) return null;
  const found = locate(state.document, id);
  if (found === null) throw new Error(`attributes: the document has no node ${id}`);
  return found;
}

// the patch that stores, replaces or removes an attribute of a node, or null when it already holds that value
function attributePatch(at: Location, name: string, value: string | number | true | undefined): Patch | null {
  const stored = at.node.attributes[name as keyof typeof at.node.attributes];
  if (stored === value) return null;
  const path = [...at.path, 'attributes', name];
  if (value === undefined) return stored === undefined ? null : { op: 'remove', path };
  return { op: stored === undefined ? 'add' : 'replace', path, value };
}

// the label of an attribute in the person's language
function labelOf(rules: ModelRules, words: (key: never) => string, attribute: string): string {
  const key = rules.attributeValues.get(attribute)?.labelKey;
  return key === undefined ? attribute : words(key as never);
}

const DECIMAL = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;
function numeric(value: unknown): number | null {
  if (value === undefined || value === '') return null;
  const text = String(value);
  return DECIMAL.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}

function validDateValue(type: string, value: string): boolean {
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  }
  if (type === 'time') return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
  if (type === 'month') return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
  if (type === 'week') return /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);
  if (type === 'datetime-local') {
    const [day, time] = value.split('T');
    return day !== undefined && time !== undefined && validDateValue('date', day) && validDateValue('time', time);
  }
  return true;
}

// The value and its relationships to other fields are checked in one place before the patch is made.
function invalidForNode(at: Location, attribute: string, stored: string | number | true | undefined, rules: ModelRules): boolean {
  if (stored === undefined || stored === true) return false;
  if (formAttributeIssue(attribute, stored) !== null) return true;
  const text = String(stored);
  const attrs = at.node.attributes;
  const next = { ...attrs, [attribute]: stored };
  const type = at.node.type === 'input' ? inputTypeOf(at.node) : '';
  if (attribute === 'name' && /\s/.test(text)) return true;
  if (attribute === 'pattern') {
    try {
      new RegExp(text, 'v');
    } catch {
      return true;
    }
  }
  // every word must be a token the manifest lists (a prefix, home or shipping, included): "shipping email"
  if (attribute === 'autocomplete' && text.split(/\s+/).some((word) => !rules.autocompleteTokens.includes(word))) return true;
  if (['rows', 'cols', 'canvasWidth', 'canvasHeight'].includes(attribute)) {
    const number = numeric(stored);
    if (number === null || !Number.isInteger(number) || number < 1 || number > 10000) return true;
  }
  if (['maxLength', 'minLength'].includes(attribute)) {
    const number = numeric(stored);
    if (number === null || !Number.isInteger(number) || number < 0) return true;
    const minimum = numeric(next.minLength);
    const maximum = numeric(next.maxLength);
    if (minimum !== null && maximum !== null && minimum > maximum) return true;
  }
  if (at.node.type === 'input') {
    if (attribute === 'value') {
      if (['number', 'range'].includes(type) && numeric(text) === null) return true;
      if (['date', 'time', 'month', 'week', 'datetime-local'].includes(type) && !validDateValue(type, text)) return true;
      // eslint-disable-next-line builder/no-manifest-id -- This is the HTML input type, not the CSS color property.
      if (type === 'color' && !/^#[0-9a-f]{6}$/i.test(text)) return true;
    }
    if (['min', 'max', 'step'].includes(attribute) && ['number', 'range'].includes(type) && numeric(text) === null && !(attribute === 'step' && text === 'any')) return true;
    if (attribute === 'step' && text !== 'any' && ['number', 'range'].includes(type) && (numeric(text) ?? 0) <= 0) return true;
    if (['min', 'max', 'value'].includes(attribute) && ['date', 'time', 'month', 'week', 'datetime-local'].includes(type)) {
      if (!validDateValue(type, text)) return true;
      const minimum = next.min === undefined ? null : String(next.min);
      const maximum = next.max === undefined ? null : String(next.max);
      const current = next.value === undefined ? null : String(next.value);
      if (minimum !== null && maximum !== null && minimum > maximum) return true;
      if (current !== null && ((minimum !== null && current < minimum) || (maximum !== null && current > maximum))) return true;
    }
    if (['min', 'max', 'value'].includes(attribute) && ['number', 'range'].includes(type)) {
      const minimum = numeric(next.min) ?? (type === 'range' ? 0 : null);
      const maximum = numeric(next.max) ?? (type === 'range' ? 100 : null);
      const current = numeric(next.value);
      if (minimum !== null && maximum !== null && minimum > maximum) return true;
      if (current !== null && ((minimum !== null && current < minimum) || (maximum !== null && current > maximum))) return true;
    }
  }
  if (at.node.type === 'progress' || at.node.type === 'meter') {
    const minimum = at.node.type === 'meter' ? (numeric(next.min) ?? 0) : 0;
    const maximum = numeric(next.max) ?? (at.node.type === 'progress' ? 1 : Number.POSITIVE_INFINITY);
    if (maximum <= minimum) return true;
    for (const name of ['value', 'low', 'high', 'optimum']) {
      const current = numeric(next[name as keyof typeof next]);
      if (next[name as keyof typeof next] !== undefined && (current === null || current < minimum || current > maximum)) return true;
    }
    const low = numeric(next.low);
    const high = numeric(next.high);
    if (low !== null && high !== null && low > high) return true;
  }
  return false;
}

export const setIdCommand = registerHandler('element.setId', ({ state, rules, words }, { id, target }): Outcome<never> => {
  const at = nodeOf(state, target as NodeId | undefined);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const typed = String(id).trim();
  if (typed !== '' && !ID.test(typed)) return { kind: 'refused', message: message('status.id.invalid', { id: typed }) };
  if (typed !== '') {
    const other = [...allNodes(state.document)].find((n) => n.id !== at.node.id && n.attributes.id === typed);
    if (other !== undefined) return { kind: 'refused', message: message('status.id.duplicate', { id: typed, name: other.name }) };
  }
  const patch = attributePatch(at, 'id', typed === '' ? undefined : typed);
  const said = message(typed === '' ? 'status.attribute.removed' : 'status.attribute.set', { attribute: labelOf(rules, words as never, 'id'), name: at.node.name, value: typed });
  return patch === null ? { kind: 'change', message: said } : { kind: 'change', patches: [patch, ...followedReferences(state.document, at.node)], message: said };
});

// The references that named the element by the HTML id it is leaving (an imported label's for="email", a link's
// "#contact": references.ts orphanReferences reads them by that id) name it by its node id from now on, the model's own
// way, so they keep naming it whatever its id becomes (the audit's RF1: a changed id was refused as an orphan).
function followedReferences(document: DocumentJson, target: DocNode): Patch[] {
  const old = target.attributes.id;
  if (typeof old !== 'string' || old === '') return [];
  if ([...allNodes(document)].some((one) => one.id !== target.id && one.attributes.id === old)) return [];
  return referencesOf(document).flatMap((reference): Patch[] => {
    const fragment = reference.value.startsWith('#');
    if ((fragment ? reference.value.slice(1) : reference.value) !== old) return [];
    const at = locate(document, reference.node.id);
    return at === null ? [] : [{ op: 'replace', path: [...at.path, 'attributes', reference.attribute], value: fragment ? `#${target.id}` : target.id }];
  });
}

export const setClassesCommand = registerHandler('element.setClasses', ({ state, rules, words }, { classes, target }): Outcome<never> => {
  const at = nodeOf(state, target as NodeId | undefined);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const list = (Array.isArray(classes) ? classes.map(String) : String(classes ?? '').split(/\s+/)).map((c) => c.trim()).filter((c) => c !== '');
  const label = labelOf(rules, words as never, 'classes');
  const wrong = list.find((c) => !validClassName(c));
  if (wrong !== undefined) return { kind: 'refused', message: message('status.attribute.invalid', { attribute: label, value: wrong }) };
  const kept = [...new Set(list)];
  const said = message(kept.length === 0 ? 'status.attribute.removed' : 'status.attribute.set', { attribute: label, name: at.node.name, value: kept.join(' ') });
  const definitions = missingClassDefinitions(state.document, kept);
  if (kept.join(' ') === at.node.classes.join(' ') && definitions.length === 0) return { kind: 'change', message: said };
  const classPatch: Patch[] = kept.join(' ') === at.node.classes.join(' ') ? [] : [{ op: 'replace', path: [...at.path, 'classes'], value: kept }];
  return { kind: 'change', patches: [...definitions, ...classPatch], message: said };
});

// whether setting this attribute to on switches the element's Muted on with it: the html name "autoplay" on a type
// whose media element takes both (the audit's A3.6, one rule for the pair)
const MUTED_HTML = 'muted';
function mutedAttributeOf(node: DocNode, rules: ModelRules): string | null {
  return [...rules.attributeValues.keys()].find((id) => rules.attributeValues.get(id)?.html === MUTED_HTML && (rules.attributes.get(id) === 'all' || rules.attributes.get(id)?.includes(node.type) === true)) ?? null;
}
function isMutedWith(attribute: string, node: DocNode, rules: ModelRules): boolean {
  const facts = rules.attributeValues.get(attribute);
  return facts?.html === 'autoplay' && facts.valueType === 'boolean' && mutedAttributeOf(node, rules) !== null;
}

export const setAttributeCommand = registerHandler('element.setAttribute', ({ state, rules, words }, { attribute, value, target }): Outcome<never> => {
  const at = nodeOf(state, target as NodeId | undefined);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const rule = rules.attributeValues.get(attribute);
  const appliesTo = rules.attributes.get(attribute);
  if (rule === undefined || appliesTo === undefined || (appliesTo !== 'all' && !appliesTo.includes(at.node.type))) throw new Error(`element.setAttribute: ${attribute} is not an attribute of ${at.node.type}`);
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const label = labelOf(rules, words as never, attribute);
  const invalid = (shown: string) => ({ kind: 'refused' as const, message: message('status.attribute.invalid', { attribute: label, value: shown }) });
  let stored: string | number | true | undefined;
  if (rule.valueType === 'boolean') {
    if (typeof value !== 'boolean') return invalid(String(value));
    stored = value ? true : undefined;
  } else {
    const typed = String(value ?? '').trim();
    // an empty text that is a value of its own is stored (alt: an image with no alternative text is decorative)
    if (typed === '') stored = rule.keepsEmpty ? '' : undefined;
    else if (rule.valueType === 'number') {
      const n = Number(typed);
      if (!Number.isFinite(n)) return invalid(typed);
      stored = n;
    } else if (rule.valueType === 'keyword') {
      if (!rule.keywords.includes(typed)) return invalid(typed);
      stored = typed;
    } else if (rule.valueType === 'url') {
      // the one rule of an address (core/elements/address.ts, the audit's A3.2): a path, a #section, a project page,
      // https:, mailto: and tel: are taken, a bare domain is stored as https://…, javascript: and data: are refused
      const read = readAddress(typed);
      if (!read.ok) return { kind: 'refused', message: read.refusal };
      stored = read.value;
    } else stored = typed;
  }
  if (stored !== undefined && formAttributeIssue(attribute, stored) !== null) return { kind: 'refused', message: message('status.forms.invalid') };
  if (attribute === 'formField' && stored !== undefined && hasIncompatibleMask({ ...at.node, attributes: { ...at.node.attributes, formField: String(stored) } })) return { kind: 'refused', message: message('status.forms.requiresText') };
  if (invalidForNode(at, attribute, stored, rules)) return invalid(String(value));
  const patch = attributePatch(at, attribute, stored);
  const exclusive: Patch[] = [];
  // a media element that plays by itself is muted: a browser blocks an audible autoplay, so the page would be silent
  // and startle nobody — Autoplay switches Muted on with it (the user's real-use audit, A3.6)
  if (stored === true && isMutedWith(attribute, at.node, rules)) {
    const muted = mutedAttributeOf(at.node, rules);
    if (muted !== null && (at.node.attributes as Record<string, unknown>)[muted] !== true) exclusive.push({ op: 'add', path: [...at.path, 'attributes', muted], value: true });
  }
  if (at.node.type === 'option' && attribute === 'selected' && stored === true) {
    let ancestor = at.parent;
    while (ancestor !== null && ancestor.type !== 'select') ancestor = locate(state.document, ancestor.id)?.parent ?? null;
    if (ancestor !== null) for (const sibling of walk(ancestor)) {
      if (sibling.type !== 'option' || sibling.id === at.node.id || sibling.attributes.selected !== true) continue;
      const other = locate(state.document, sibling.id);
      if (other !== null) exclusive.push({ op: 'remove', path: [...other.path, 'attributes', 'selected'] });
    }
  }
  const shown = stored === undefined ? '' : stored === true ? '✓' : String(stored);
  const said = stored !== undefined && (attribute === 'formField' || attribute === 'formSubmit')
    ? message('status.forms.configured', { name: at.node.name })
    : message(stored === undefined ? 'status.attribute.removed' : 'status.attribute.set', { attribute: label, name: at.node.name, value: shown });
  const patches = [...exclusive, ...(patch === null ? [] : [patch])];
  return patches.length === 0 ? { kind: 'change', message: said } : { kind: 'change', patches, message: said };
});

// element.setCustomAttribute / element.removeCustomAttribute (feature element-attributes-aria): the person's own
// attributes of the one selected element (aria-*, data-*, role…), stored as they are typed. A name must be an attribute
// name of HTML that is no event handler (status.attribute.eventHandler) nor one of the editor's own marks
// (status.attribute.invalidName); the same value records nothing; a locked element refuses. Removing one that is not
// there records nothing.
function oneSelected(state: { readonly document: DocumentJson; readonly selection: readonly NodeId[] }): Location | null {
  const [only, ...others] = state.selection;
  return only === undefined || others.length > 0 ? null : locate(state.document, only);
}

export const setCustomAttributeCommand = registerHandler('element.setCustomAttribute', ({ state, rules, words }, { name, value }): Outcome<never> => {
  const at = oneSelected(state);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const typed = String(name).trim().toLowerCase();
  if (typed.startsWith('on')) return { kind: 'refused', message: message('status.attribute.eventHandler') };
  const owner = reservedAttributeOwner(typed, rules);
  if (owner !== null) return { kind: 'refused', message: message('status.attribute.reserved', { name: typed, owner: words(owner as never) }) };
  if (customAttributeRefusal(typed, rules) !== null) return { kind: 'refused', message: message('status.attribute.invalidName', { name: typed }) };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const custom = at.node.customAttributes ?? {};
  // a new attribute added with no value yet says it was added; any other says its value
  const said = custom[typed] === undefined && String(value) === '' ? message('status.attribute.added', { attribute: typed, name: at.node.name }) : message('status.attribute.set', { attribute: typed, name: at.node.name, value: String(value) });
  if (custom[typed] === String(value)) return { kind: 'change', message: said };
  const next = { ...custom, [typed]: String(value) };
  return { kind: 'change', patches: [{ op: at.node.customAttributes === undefined ? 'add' : 'replace', path: [...at.path, 'customAttributes'], value: next }], message: said };
});

export const removeCustomAttributeCommand = registerHandler('element.removeCustomAttribute', ({ state }, { name }): Outcome<never> => {
  const at = oneSelected(state);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const said = message('status.attribute.removed', { attribute: name, name: at.node.name });
  if (!(name in (at.node.customAttributes ?? {}))) return { kind: 'change', message: said };
  const custom = Object.fromEntries(Object.entries(at.node.customAttributes ?? {}).filter(([n]) => n !== name));
  const path = [...at.path, 'customAttributes'];
  return { kind: 'change', patches: [Object.keys(custom).length === 0 ? { op: 'remove', path } : { op: 'replace', path, value: custom }], message: said };
});
