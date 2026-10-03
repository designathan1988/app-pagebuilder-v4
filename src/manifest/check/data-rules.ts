// Data holds no logic: couplings, history, references and consumers, the HTML content model.
import { schemaFields } from '../fields.ts';
import { COUPLING_ACTIONS, COUPLING_PREDICATES, GESTURE_DOOR_KINDS, type DoorKind, type ElementType } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { ReferenceKind } from './base.ts';
import { htmlRefusal } from './base.ts';

export function dataRulesRules(ctx: CheckContext) {
  const { p, report, featureIndex, commands, doors, elementById, propertyById, compositeById, constantById, input } = ctx;
  // ---- coupling: rules are data made of a closed list of predicates and actions
  for (const [i, c] of p.properties.couplings.entries()) {
    const path = `couplings[${i}]`;
    const bad = (at: string, message: string) => report('coupling', 'properties.json', `${path}.${at}`, message);
    if (!(COUPLING_PREDICATES as readonly string[]).includes(c.condition.predicate)) bad('condition.predicate', `unknown predicate "${c.condition.predicate}": use one of ${COUPLING_PREDICATES.join(', ')}`);
    if (!(COUPLING_ACTIONS as readonly string[]).includes(c.effect.action)) bad('effect.action', `unknown action "${c.effect.action}": use one of ${COUPLING_ACTIONS.join(', ')}`);
    if (!propertyById.has(c.trigger.property)) bad('trigger.property', `"${c.trigger.property}" is not an edited property`);
    if (c.trigger.via !== null) {
      const via = compositeById.get(c.trigger.via);
      if (!via) bad('trigger.via', `unknown composite "${c.trigger.via}"`);
      else if (!via.longhands.includes(c.trigger.property)) bad('trigger.via', `${via.id} does not write ${c.trigger.property}`);
    }
    if (c.condition.predicate === 'always') {
      if (c.condition.property !== null || c.condition.values.length > 0) bad('condition', '"always" takes no property and no values');
    } else if (c.condition.property === null || !propertyById.has(c.condition.property) || c.condition.values.length === 0) {
      bad('condition', `"${c.condition.predicate}" needs an edited property and at least one value`);
    }
    if (!propertyById.has(c.effect.property)) bad('effect.property', `"${c.effect.property}" is not an edited property`);
    const takesValue = c.effect.action === 'setValue' || c.effect.action === 'setParentValue';
    if (takesValue !== (c.effect.value !== null)) bad('effect.value', takesValue ? `"${c.effect.action}" needs a value` : `"${c.effect.action}" takes no value`);
    if (!featureIndex.has(c.feature)) bad('feature', `unknown feature "${c.feature}"`);
  }

  // ---- history: every command declares how it meets the history
  const writesProperties = new Set(doors.filter((d) => d.door.adapter.writes.length > 0).map((d) => d.command.id));
  const sessionPanels = new Set(doors.flatMap((d) => (d.command.id === 'drag.cancel' && d.door.kind === 'shortcut' ? [d.door.context] : [])));
  for (const c of commands) {
    const h = c.command.history;
    const path = `${c.path}.history`;
    if (!h.undoable) {
      if (writesProperties.has(c.command.id)) report('history', c.file, path, `${c.command.id} writes properties, so it changes the document and must be undoable`);
      continue;
    }
    // a door of a panel that is a pointer gesture while it is open (the colour picker's session: Escape, drag.cancel,
    // has a door in the key context of the panel's name) runs inside that gesture too
    const gesture = c.command.entryPoints.some((d) => (GESTURE_DOOR_KINDS as readonly DoorKind[]).includes(d.kind) || (d.kind === 'panel-control' && d.panel !== undefined && sessionPanels.has(d.panel)));
    if (gesture && h.transaction !== 'per-gesture') report('history', c.file, `${path}.transaction`, `${c.command.id} has pointer-gesture doors: one transaction per gesture`);
    if (!gesture && h.transaction !== 'per-dispatch') report('history', c.file, `${path}.transaction`, `${c.command.id} has no pointer-gesture door: one transaction per dispatch`);
    if (h.coalesce !== 'none') {
      const constant = constantById.get(h.coalesce.within);
      if (!constant) report('history', c.file, `${path}.coalesce.within`, `unknown constant "${h.coalesce.within}"`);
      else if (constant.unit !== 'ms') report('history', c.file, `${path}.coalesce.within`, `constant ${constant.id} is in ${constant.unit}, not ms`);
    }
  }

  // ---- reference: every id the data names for code is planned or registered
  const referenced = new Map<string, string>(); // "kind:id" → first place
  const need = (kind: ReferenceKind, id: string, where: string) => {
    const key = `${kind}:${id}`;
    if (!referenced.has(key)) referenced.set(key, where);
  };
  for (const c of commands) {
    need('handler', c.command.id, `${c.file} ${c.path}.id`);
    need('predicate', c.command.availability.predicate, `${c.file} ${c.path}.availability.predicate`);
  }
  p.properties.properties.forEach((prop, i) => {
    need('codec', prop.codec, `properties.json properties[${i}].codec`);
    need('predicate', prop.appliesTo, `properties.json properties[${i}].appliesTo`);
  });
  p.properties.composites.forEach((c, i) => {
    need('codec', c.codec, `properties.json composites[${i}].codec`);
  });
  p.properties.recipes.forEach((r, i) => {
    need('codec', r.codec, `properties.json recipes[${i}].codec`);
    need('predicate', r.appliesTo, `properties.json recipes[${i}].appliesTo`);
  });
  p.properties.structures.forEach((s, i) => need('codec', s.codec, `properties.json structures[${i}].codec`));
  p.properties.couplings.forEach((c, i) => {
    // an id outside the closed lists is reported by the coupling rule
    if ((COUPLING_PREDICATES as readonly string[]).includes(c.condition.predicate)) need('predicate', c.condition.predicate, `properties.json couplings[${i}].condition.predicate`);
    if ((COUPLING_ACTIONS as readonly string[]).includes(c.effect.action)) need('action', c.effect.action, `properties.json couplings[${i}].effect.action`);
  });
  const listed = new Map(p.references.references.map((r, i) => [`${r.kind}:${r.id}`, { entry: r, index: i }]));
  const registeredIn = (kind: ReferenceKind, id: string) => (input.registered[kind] ?? []).includes(id);
  for (const [key, where] of referenced) {
    const [kind = '', ...rest] = key.split(':');
    const id = rest.join(':');
    const entry = listed.get(key);
    const inCode = registeredIn(kind as ReferenceKind, id);
    if (!entry && !inCode) {
      const [file = '', ...path] = where.split(' ');
      report('reference', file, path.join(' '), `${kind} "${id}" is neither planned in references.json nor registered in code`);
    }
  }
  for (const [key, { entry, index }] of listed) {
    const path = `references[${index}]`;
    if (!referenced.has(key)) report('reference', 'references.json', path, `${entry.kind} "${entry.id}" is listed but nothing in the manifest references it`);
    const inCode = registeredIn(entry.kind, entry.id);
    if (entry.status === 'registered' && !inCode) report('reference', 'references.json', `${path}.status`, `${entry.kind} "${entry.id}" says registered but no code registers it`);
    if (entry.status === 'planned' && inCode) report('reference', 'references.json', `${path}.status`, `${entry.kind} "${entry.id}" is registered in code: mark it registered`);
  }

  // ---- consumer: every field of every schema has a module that reads it
  const fields = schemaFields();
  const readers = new Map(p.consumers.consumers.map((c, i) => [c.field, i]));
  for (const field of fields) if (!readers.has(field)) report('consumer', 'consumers.json', 'consumers', `field ${field} has no reader: name the module that reads it, or remove the field`);
  const fieldSet = new Set(fields);
  for (const [field, i] of readers) if (!fieldSet.has(field)) report('consumer', 'consumers.json', `consumers[${i}].field`, `${field} is not a field of any schema`);

  // ---- html-model: element types follow the generated HTML content model
  const html = p.html.elements;
  const refusal = (parent: ElementType, child: ElementType): string | null => {
    if (parent.content !== 'children') return `${parent.id} holds ${parent.content}, not element children`;
    if (child.namespace === 'svg') return parent.tag !== null && html[parent.tag]?.foreign === true ? null : `${child.id} is an SVG element and goes only inside a foreign (svg) element`;
    if (parent.tag !== null && html[parent.tag]?.foreign === true) return `${parent.id} is foreign content and holds only SVG elements`;
    if (parent.tag === null || child.tag === null) return 'an element without a tag has no content model';
    return htmlRefusal(p.html, parent.tag, child.tag);
  };
  for (const [i, e] of p.elements.elements.entries()) {
    const path = `elements[${i}]`;
    const meta = e.tag !== null ? html[e.tag] : undefined;
    if (e.namespace === 'html' && e.tag !== null) {
      if (!meta) report('html-model', 'elements.json', `${path}.tag`, `<${e.tag}> is not an element of the generated HTML data`);
      else if (meta.deprecated) report('html-model', 'elements.json', `${path}.tag`, `<${e.tag}> is deprecated in the generated HTML data`);
      for (const tag of e.alternativeTags) if (!html[tag] || html[tag]?.deprecated) report('html-model', 'elements.json', `${path}.alternativeTags`, `<${tag}> is not a current HTML element`);
    }
    if (e.namespace === 'svg' && e.tag !== null && html[e.tag]) report('html-model', 'elements.json', `${path}.namespace`, `<${e.tag}> is an HTML element, not an SVG one`);
    if (meta?.void && e.content !== 'none') report('html-model', 'elements.json', `${path}.content`, `<${e.tag}> is void, so its content is "none"`);
    if (meta?.textOnly && e.content === 'children') report('html-model', 'elements.json', `${path}.content`, `<${e.tag}> holds text only`);
    for (const naturalChild of [e.naturalChild ?? []].flat()) {
      const child = elementById.get(naturalChild);
      const reason = child ? refusal(e, child) : null;
      if (reason !== null) report('html-model', 'elements.json', `${path}.naturalChild`, `${naturalChild} cannot be a child of ${e.id}: ${reason}`);
    }
  }
  const enumOf = (tag: string | null, attribute: string) => (tag !== null ? html[tag]?.attributes[attribute]?.enum ?? null : null);
  for (const [i, a] of p.elements.attributes.entries()) {
    if (a.html === null || a.keywords.length === 0) continue;
    const targets = a.elements === 'all' ? [] : a.elements;
    for (const id of targets) {
      const values = enumOf(elementById.get(id)?.tag ?? null, a.html);
      if (values === null) continue;
      for (const k of a.keywords) if (!values.includes(k)) report('html-model', 'elements.json', `attributes[${i}].keywords`, `"${k}" is not a value of ${a.html} on <${elementById.get(id)?.tag ?? id}> (${values.join(', ')})`);
    }
  }
  for (const [gi, g] of p.elements.palette.entries()) {
    for (const [ei, entry] of g.entries.entries()) {
      if (entry.inputType === null) continue;
      const values = enumOf(elementById.get(entry.element)?.tag ?? null, 'type');
      if (values !== null && !values.includes(entry.inputType)) report('html-model', 'elements.json', `palette[${gi}].entries[${ei}].inputType`, `"${entry.inputType}" is not an input type (${values.join(', ')})`);
    }
  }
  return { html };
}
