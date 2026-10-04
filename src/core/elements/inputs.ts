// The rules of form inputs (INVENTORY.md, owners; spec elements-form-inputs-rules): which attributes each
// type of input takes (HTML's input types), element.setInputType and element.setLabelTarget.
//  - An input's type is its attribute inputType (written type). Switching it keeps the attributes the new type takes
//    and drops the others, one undo step (status.input.typeSet).
//  - A label points at one form control (element.setLabelTarget): the label's `for` is the control's id; a control
//    with no id is given one from its name (lower case, words joined by "-", numbered when taken), in the same undo
//    step (status.label.target).
//  - A locked element, or one inside a locked element, keeps its values (spec lock-element).
import type { NodeId } from '../../generated/commands.ts';
import { slug } from '../text/fold.ts';
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import { allNodes, locate, type DocNode, type DocumentJson, type Location } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { readFieldConfig } from '../forms/config.ts';

const TEXTUAL = ['text', 'email', 'password', 'tel', 'url', 'search'];
export const acceptsTextMask = (node: DocNode): boolean => node.tag === 'textarea' || (node.tag === 'input' && TEXTUAL.includes(inputTypeOf(node)));
export function hasIncompatibleMask(node: DocNode): boolean {
  const mask = readFieldConfig(node.attributes.formField)?.mask;
  return mask !== undefined && mask.kind !== 'none' && !acceptsTextMask(node);
}
const RANGED = ['number', 'range', 'date', 'datetime-local', 'month', 'week', 'time'];
// attribute (elements.json id) → the input types that take it (HTML, "input type=..." applicability); an attribute
// listed in neither table applies to every input type
const APPLIES: Readonly<Record<string, readonly string[]>> = {
  checked: ['checkbox', 'radio'],
  min: RANGED,
  max: RANGED,
  step: RANGED,
  pattern: TEXTUAL,
  placeholder: [...TEXTUAL, 'number'],
  readonly: [...TEXTUAL, 'number', 'date', 'time'],
  required: [...TEXTUAL, 'number', 'date', 'time', 'checkbox', 'radio', 'file'],
  accept: ['file'],
  multiple: ['file', 'email'],
  maxLength: TEXTUAL,
  minLength: TEXTUAL,
};
// attribute → the input types that do not take it (every other type does)
const EXCEPT: Readonly<Record<string, readonly string[]>> = {
  autocomplete: ['checkbox', 'radio', 'file'],
  value: ['file'],
};

// the type of an input node (text when none is stored)
export const inputTypeOf = (node: DocNode): string => String(node.attributes.inputType ?? 'text');

// Whether an attribute applies to a node: for an input, whether its type takes it; for any other element, true.
export function attributeApplies(node: DocNode, attribute: string): boolean {
  if (node.type === 'link') {
    if (attribute === 'href' || attribute === 'newTab') return node.tag === 'a';
    if (attribute === 'buttonType') return node.tag === 'button';
  }
  if (node.type !== 'input') return true;
  const type = inputTypeOf(node);
  const only = APPLIES[attribute];
  if (only !== undefined) return only.includes(type);
  return !(EXCEPT[attribute] ?? []).includes(type);
}

// The attributes a type change will remove, named by their manifest IDs for the inspector's
// warning. The handler and its warning use this one applicability rule.
export function droppedInputAttributes(node: DocNode, nextType: string): readonly string[] {
  if (node.type !== 'input') return [];
  const switched: DocNode = { ...node, attributes: { ...node.attributes, inputType: nextType } };
  return Object.keys(node.attributes).filter((attribute) => attribute !== 'inputType' && !attributeApplies(switched, attribute));
}

function oneSelected(state: { readonly document: DocumentJson; readonly selection: readonly NodeId[] }): Location | null {
  const [only, ...others] = state.selection;
  return only === undefined || others.length > 0 ? null : locate(state.document, only);
}

export const setInputTypeCommand = registerHandler('element.setInputType', ({ state, rules }, { type }): Outcome<never> => {
  const at = oneSelected(state);
  if (at === null || at.node.type !== 'input') return { kind: 'refused', message: message('status.needsSingleSelection') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const nextType = type.trim().toLowerCase();
  if (!rules.attributeValues.get('inputType')?.keywords.includes(nextType)) return { kind: 'refused', message: message('status.input.invalidType', { type }) };
  const said = message('status.input.typeSet', { name: at.node.name, type: nextType });
  if (inputTypeOf(at.node) === nextType) return { kind: 'change', message: said };
  const switched: DocNode = { ...at.node, attributes: { ...at.node.attributes, inputType: nextType } };
  if (hasIncompatibleMask(switched)) return { kind: 'refused', message: message('status.forms.requiresText') };
  const dropped = new Set(droppedInputAttributes(at.node, nextType));
  const kept = Object.fromEntries(Object.entries(switched.attributes).filter(([name]) => !dropped.has(name)));
  return { kind: 'change', patches: [{ op: 'replace', path: [...at.path, 'attributes'], value: kept }], message: said };
});

// an id no node has, from a name: lower case, words joined by "-", numbered from 2 when taken
export function freshId(document: DocumentJson, name: string): string {
  const base = slug(name).replace(/^(?![a-z])/, 'field-') || 'field';
  const taken = new Set([...allNodes(document)].map((n) => n.attributes.id).filter((id) => id !== undefined));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

export const setLabelTargetCommand = registerHandler('element.setLabelTarget', ({ state }, { control }): Outcome<never> => {
  const label = oneSelected(state);
  const target = locate(state.document, control);
  if (label === null || target === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  // a label points at a form control, and only a label points (the audit's AUD-03: labelFor written on a heading left a
  // document the validator refused)
  if (label.node.type !== LABEL) return { kind: 'refused', message: message('status.label.notLabel', { name: label.node.name }) };
  if (!CONTROLS.has(target.node.type)) return { kind: 'refused', message: message('status.label.notControl', { name: target.node.name }) };
  const locked = lockRefusal(state.document, label.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches: Patch[] = [];
  // the control gets an id attribute when it has none, so the page has something to point at; the label keeps the
  // control's node id, not that attribute: renaming the attribute later leaves the reference working (A3.4)
  const holder = target.node.attributes.id === undefined || String(target.node.attributes.id) === '';
  // the control is changed too when it takes an id: a locked one keeps what it holds (the audit's LK1)
  const lockedControl = holder ? lockRefusal(state.document, target.node.id, 'status.locked.edit') : null;
  if (lockedControl !== null) return { kind: 'refused', message: lockedControl };
  if (holder) patches.push({ op: 'add', path: [...target.path, 'attributes', 'id'], value: freshId(state.document, target.node.name) });
  if (label.node.attributes.labelFor !== target.node.id) patches.push({ op: label.node.attributes.labelFor === undefined ? 'add' : 'replace', path: [...label.path, 'attributes', 'labelFor'], value: target.node.id });
  return { kind: 'change', patches, message: message('status.label.target', { name: label.node.name, control: target.node.name }) };
});

// The form controls a label may point at: the inputs, text areas, selects, buttons, meters, progress bars and outputs
// of the document, in document order.
const CONTROLS = new Set(['input', 'textarea', 'select', 'button', 'meter', 'progress', 'output']);
const LABEL = 'label';
export function formControls(document: DocumentJson): DocNode[] {
  return [...allNodes(document)].filter((node) => CONTROLS.has(node.type));
}

// Whether a node is a form control whose value is edited in the inspector, never on the canvas: an input, a text area
// or a select (spec elements-form-inputs-rules, Problems in Pager 1).
const VALUE_CONTROLS = new Set(['input', 'textarea', 'select']);
export function isValueControl(document: DocumentJson, id: NodeId): boolean {
  const found = locate(document, id);
  return found !== null && VALUE_CONTROLS.has(found.node.type);
}
