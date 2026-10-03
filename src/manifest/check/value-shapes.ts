// How values are written: recipes, structured values, shorthands and composites, the doors that write a property,
// individual transforms.
import { BROWSERS, STRUCTURED_VALUE_TYPES, type Browser, type Composite, type Recipe } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { cssSyntaxRules } from './css-syntax.ts';
import type { browserSupportRules } from './browser-support.ts';
import { VENDOR_PREFIX, baseName } from './base.ts';

export function valueShapesRules(ctx: CheckContext, cssSyntax: Pick<ReturnType<typeof cssSyntaxRules>, 'analysed' | 'written'>, browserSupport: Pick<ReturnType<typeof browserSupportRules>, 'unsupportedParts'>) {
  const {
    p,
    report,
    css,
    unique,
    doors,
    doorByRef,
    propertyById,
    compositeById,
    recipeById,
    structureById,
    isRecipeDoor,
    generated,
    isShorthand,
    compat,
    lacking,
    describeLack,
    supportedByAll,
    vendorPrefixed,
    structureOf,
    vouched,
  } = ctx;
  const { analysed, written } = cssSyntax;
  const { unsupportedParts } = browserSupport;
  // ---- recipe: the declarations browsers need for one effect, written by one undoable command, working in every
  // browser
  for (const [i, r] of p.properties.recipes.entries()) {
    const path = `recipes[${i}]`;
    const bad = (at: string, message: string) => report('recipe', 'properties.json', at === '' ? path : `${path}.${at}`, message);
    const names = r.declarations.map((d) => d.property);
    for (const [di, d] of r.declarations.entries()) {
      const at = `declarations[${di}]`;
      if (!generated[d.property]) {
        bad(`${at}.property`, `${d.property} is not a CSS property of the generated web data`);
        continue;
      }
      if (names.indexOf(d.property) !== di) bad(`${at}.property`, `${d.property} is declared twice`);
      const editedLonghands = (generated[d.property]?.longhands ?? []).filter((l) => propertyById.has(l));
      if (editedLonghands.length > 0) bad(`${at}.property`, `${d.property} is the shorthand of the edited ${editedLonghands.join(', ')}: a recipe writes those longhands, never a second writer of them`);
      const wholeShorthand = p.properties.storedWhole.find((w) => (generated[w.property]?.longhands ?? []).includes(d.property));
      if (wholeShorthand) bad(`${at}.property`, `${d.property} is a longhand of ${wholeShorthand.property}, which is stored whole: a recipe does not write it beside that property`);
      const c = compat[d.property];
      if (!c || lacking(c).length === BROWSERS.length) bad(`${at}.property`, `no browser supports ${d.property}${c ? `: ${describeLack(c)}` : ''}`);
    }
    const valued = r.declarations.filter((d) => d.value === null);
    if (valued.length === 0) bad('declarations', `${r.id} has no declaration that carries the door's value (value null)`);
    if (!r.declarations.some((d) => vendorPrefixed(d.property) || (d.value !== null && VENDOR_PREFIX.test(d.value)))) {
      bad('declarations', `${r.id} holds no vendor prefix: a recipe exists for legacy prefixed CSS; edit standard properties as properties or composites`);
    }
    if (!valued.some((d) => compat[d.property]?.bcd === r.source.bcd)) {
      bad('source.bcd', `${r.source.bcd} is not the BCD entry of a declaration that carries the door's value (${valued.map((d) => `${d.property}: ${compat[d.property]?.bcd ?? 'none'}`).join(', ')})`);
    }
    const shares = r.declarations.some((d) => propertyById.has(d.property));
    if (shares !== (r.shared !== null)) bad('shared', shares ? `${r.id} also writes edited properties (${names.filter((n) => propertyById.has(n)).join(', ')}): declare how it shares them` : `${r.id} writes no edited property, so it shares none`);
    // every browser gets the effect: each group (a property and its prefixed forms) has a declaration it supports
    const supportedIn = (b: Browser, d: Recipe['declarations'][number], di: number): string | null => {
      const c = compat[d.property];
      if (!c) return 'no compat entry';
      if (c[b] === false) return c.why[b] ?? 'not supported';
      if (d.value === null || vouched(d.property, d.value, r.id)) return null;
      const result = analysed.get(`recipe ${r.id} ${di}`);
      if (!result?.ok) return 'not a valid value';
      return unsupportedParts(d.property, d.value, result, b)[0] ?? null;
    };
    for (const b of BROWSERS) {
      for (const base of new Set(names.map(baseName))) {
        const group = r.declarations.map((d, di) => ({ d, di })).filter(({ d }) => baseName(d.property) === base);
        const reasons = group.map(({ d, di }) => ({ d, why: supportedIn(b, d, di) }));
        if (reasons.every((x) => x.why !== null)) {
          bad('declarations', `${r.id} does not work in ${b}: no declaration of ${base} is supported there: ${reasons.map(({ d, why }) => `${d.property}${d.value !== null ? `: ${d.value}` : ''} (${why ?? ''})`).join('; ')}`);
        }
      }
    }
    for (const [di, d] of r.doors.entries()) {
      const entry = doorByRef.get(d);
      if (!entry) continue;
      if (entry.door.kind !== 'inspector-field' || entry.door.recipe !== r.id) bad(`doors[${di}]`, `${d} is listed as a door of ${r.id} but does not edit it`);
      const writes = entry.door.adapter.writes;
      const missing = names.filter((n) => !writes.includes(n));
      const extra = writes.filter((n) => !names.includes(n));
      if (missing.length > 0 || extra.length > 0) bad(`doors[${di}]`, `${d} must write exactly the declarations of ${r.id}${missing.length > 0 ? `; it leaves out ${missing.join(', ')}` : ''}${extra.length > 0 ? `; it also writes ${extra.join(', ')}` : ''}`);
      if (!entry.command.history.undoable) bad(`doors[${di}]`, `${d} writes ${r.id} through ${entry.command.id}, which is not undoable: a recipe is one undo step`);
    }
  }
  for (const { file, path, door, ref: doorRef } of doors) {
    if (door.kind !== 'inspector-field' || door.recipe === null) continue;
    const r = recipeById.get(door.recipe);
    if (r && !r.doors.includes(doorRef)) report('recipe', file, `${path}.recipe`, `${doorRef} edits ${r.id} but ${r.id} does not list it among its doors`);
  }

  // ---- structured-value: a structured value type declares typed fields that serialise to the property's syntax
  const units = p.css.units;
  for (const [i, s] of p.properties.structures.entries()) {
    const path = `structures[${i}]`;
    const bad = (at: string, message: string) => report('structured-value', 'properties.json', `${path}${at}`, message);
    if (!STRUCTURED_VALUE_TYPES.includes(s.id)) bad('.id', `${s.id} is not a structured value type (${STRUCTURED_VALUE_TYPES.join(', ')})`);
    unique(`field of structure ${s.id}`, 'properties.json', s.fields.map((f, fi) => ({ id: f.id, path: `${path}.fields[${fi}]` })));
    for (const [fi, f] of s.fields.entries()) {
      const at = `.fields[${fi}]`;
      if ((f.css === 'keyword') !== (f.keyword !== null)) bad(at, f.css === 'keyword' ? `${f.id} is written as a keyword but names none` : `${f.id} is not written as a keyword, so it names none`);
      if ((f.type === 'boolean') !== (f.css !== 'value')) bad(at, `${f.id}: a boolean field is written as a keyword or hides the layer; other fields are written as their value`);
      if ((f.type === 'boolean') !== (typeof f.sample === 'boolean')) bad(`${at}.sample`, `the sample of ${f.id} is not a ${f.type}`);
      if ((f.type === 'length') !== (f.units !== null)) bad(`${at}.units`, f.type === 'length' ? `${f.id} is a length: name the unit list it offers` : `${f.id} is not a length, so it offers no units`);
      else if (f.units !== null && !units[f.units]) bad(`${at}.units`, `"${f.units}" is not a unit list of css-properties.json (${Object.keys(units).join(', ')})`);
    }
    const users = p.properties.properties.filter((prop) => prop.valueType === s.id);
    if (users.length === 0) bad('', `no property has the value type ${s.id}`);
    const layer = (flip: string | null) =>
      s.fields
        .filter((f) => f.css !== 'hides-layer')
        .map((f) => (f.css === 'value' ? String(f.sample) : (f.id === flip ? !f.sample : f.sample) === true ? f.keyword : null))
        .filter((part): part is string => part !== null)
        .join(' ');
    const samples = [layer(null), ...s.fields.filter((f) => f.css === 'keyword').map((f) => layer(f.id))];
    if (s.list) samples.push(`${layer(null)}, ${samples[samples.length - 1] ?? layer(null)}`);
    for (const prop of users) {
      if (prop.codec !== s.codec) report('structured-value', 'properties.json', `properties[${p.properties.properties.indexOf(prop)}].codec`, `${prop.id} has the structured value type ${s.id}, whose codec is ${s.codec}, not ${prop.codec}`);
      for (const sample of samples) {
        const reason = css.match(prop.id, sample);
        if (reason !== null) bad('.fields', `a ${s.id} layer serialised from the samples ("${sample}") is not a valid ${prop.id}: ${reason}`);
      }
    }
  }
  for (const [i, prop] of p.properties.properties.entries()) {
    if (STRUCTURED_VALUE_TYPES.includes(prop.valueType) && !structureById.has(prop.valueType)) report('structured-value', 'properties.json', `properties[${i}].valueType`, `${prop.valueType} is a structured value type, but properties.json declares no structure for it`);
    if (structureOf(prop.id) && prop.subsets.length > 0) report('structured-value', 'properties.json', `properties[${i}].subsets`, `${prop.id} stores typed fields, so no subset offers it as CSS text`);
  }
  // a structured value is never written as CSS text: not as a default, a coupling effect or a fixed door value
  for (const [i, e] of p.elements.elements.entries()) {
    for (const name of Object.keys(e.defaultStyles)) if (structureOf(name)) report('structured-value', 'elements.json', `elements[${i}].defaultStyles.${name}`, `${name} stores typed fields, so it has no CSS text default`);
  }
  for (const [i, w] of p.elements.wrappers.entries()) {
    for (const name of Object.keys(w.styles)) if (structureOf(name)) report('structured-value', 'elements.json', `wrappers[${i}].styles.${name}`, `${name} stores typed fields, so it has no CSS text default`);
  }
  for (const [i, c] of p.properties.couplings.entries()) {
    if (structureOf(c.effect.property) && c.effect.value !== null) report('structured-value', 'properties.json', `couplings[${i}].effect`, `${c.effect.property} stores typed fields, so a coupling cannot write it as CSS text`);
  }
  for (const { file, path, command, door, ref: doorRef } of doors) {
    const property = door.args.property;
    if (typeof property === 'string' && structureOf(property) && typeof door.args.value === 'string') report('structured-value', file, `${path}.args.value`, `${doorRef} writes ${property}, which stores typed fields, as CSS text`);
    const structured = door.adapter.writes.flatMap((name) => {
      const s = structureOf(name);
      return s ? [{ name, s }] : [];
    });
    // typed fields travel as typed data: the command takes them as a json argument, never as CSS text
    if (structured.length > 0 && !Object.values(command.args).some((a) => a.type === 'json')) {
      report('structured-value', file, `${path}.adapter.writes`, `${doorRef} writes ${structured.map((x) => x.name).join(', ')}, a structured value, through ${command.id}, which takes no typed (json) argument: doors edit typed fields through the codec, never CSS text`);
    }
    if (door.adapter.fields.length > 0 && structured.length === 0) report('structured-value', file, `${path}.adapter.fields`, `${doorRef} edits typed fields but writes no property with a structured value type`);
    for (const field of door.adapter.fields) {
      for (const { name, s } of structured) {
        if (!s.fields.some((f) => f.id === field)) report('structured-value', file, `${path}.adapter.fields`, `${doorRef} edits the field ${field}, which ${name} (${s.id}) does not have`);
      }
    }
  }

  // ---- shorthand-write: the document stores the finest-grained property browsers implement. A shorthand
  // is edited through its longhands (a composite) when all three browsers implement every one of them.
  // When a browser lacks one, the manifest either omits it from the composite or stores the shorthand
  // whole, declared in storedWhole with the reason; a shorthand stored whole has no longhand edited too.
  const storedWhole = new Map(p.properties.storedWhole.map((w, i) => [w.property, i]));
  unique('shorthand stored whole', 'properties.json', p.properties.storedWhole.map((w, i) => ({ id: w.property, path: `storedWhole[${i}]` })));
  for (const [i, prop] of p.properties.properties.entries()) {
    if (!isShorthand(prop.id)) continue;
    const longhands = generated[prop.id]?.longhands ?? [];
    const missing = longhands.filter((l) => !supportedByAll(l));
    if (missing.length === 0) report('shorthand-write', 'properties.json', `properties[${i}].id`, `${prop.id} is a shorthand of ${longhands.join(', ')}, all of which Chrome, Firefox and Safari implement: edit it as a composite of them`);
    else if (!storedWhole.has(prop.id)) report('shorthand-write', 'properties.json', `properties[${i}].id`, `${prop.id} is a shorthand; browsers lack ${missing.join(', ')}: declare it in storedWhole with the reason, or edit a composite that omits them`);
    const overlap = longhands.filter((l) => propertyById.has(l));
    if (overlap.length > 0) report('shorthand-write', 'properties.json', `properties[${i}].id`, `${prop.id} is stored whole, so its longhands ${overlap.join(', ')} are not edited as well: that would be two writers of one value`);
  }
  for (const [i, w] of p.properties.storedWhole.entries()) {
    if (!propertyById.has(w.property) || !isShorthand(w.property)) report('shorthand-write', 'properties.json', `storedWhole[${i}].property`, `${w.property} is not an edited shorthand`);
  }
  for (const entry of doors) {
    if (isRecipeDoor(entry)) continue;
    for (const name of entry.door.adapter.writes) {
      if (isShorthand(name) && !propertyById.has(name)) report('shorthand-write', entry.file, `${entry.path}.adapter.writes`, `${entry.ref} writes the shorthand ${name}; a door writes its longhands (${generated[name]?.longhands.join(', ')})`);
    }
  }
  for (const [i, e] of p.elements.elements.entries()) {
    for (const name of Object.keys(e.defaultStyles)) if (isShorthand(name) && !propertyById.has(name)) report('shorthand-write', 'elements.json', `elements[${i}].defaultStyles.${name}`, `default style ${name} is a shorthand; store its longhands`);
  }
  for (const [i, w] of p.elements.wrappers.entries()) {
    for (const name of Object.keys(w.styles)) if (isShorthand(name) && !propertyById.has(name)) report('shorthand-write', 'elements.json', `wrappers[${i}].styles.${name}`, `a wrapper style ${name} is a shorthand; store its longhands`);
  }

  // ---- composite: a shorthand is edited as a composite whose door writes every longhand in one undoable command
  const compositesOf = new Map<string, Composite[]>();
  for (const [i, c] of p.properties.composites.entries()) {
    const path = `composites[${i}]`;
    for (const name of c.longhands) {
      if (!compositesOf.has(name)) compositesOf.set(name, []);
      compositesOf.get(name)?.push(c);
      if (!propertyById.has(name)) report('composite', 'properties.json', `${path}.longhands`, `${c.id} writes ${name}, which is not an edited property`);
    }
    if (c.shorthand !== null && propertyById.has(c.shorthand)) report('composite', 'properties.json', `${path}.shorthand`, `${c.shorthand} is stored whole as a property, so no composite writes its longhands`);
    if (c.shorthand === null) {
      if (c.omits !== null) report('composite', 'properties.json', `${path}.omits`, `${c.id} stands for no shorthand, so it omits nothing`);
    } else {
      const expected = generated[c.shorthand]?.longhands ?? [];
      if (expected.length === 0) {
        report('composite', 'properties.json', `${path}.shorthand`, `${c.shorthand} is not a shorthand in the generated web data`);
      } else {
        const omitted = c.omits?.longhands ?? [];
        const missing = expected.filter((l) => !c.longhands.includes(l) && !omitted.includes(l));
        const extra = [...c.longhands, ...omitted].filter((l) => !expected.includes(l));
        const both = c.longhands.filter((l) => omitted.includes(l));
        if (missing.length > 0) report('composite', 'properties.json', `${path}.longhands`, `${c.id} leaves out ${missing.join(', ')}, which the ${c.shorthand} shorthand sets; write them or declare them in omits with the reason`);
        if (extra.length > 0) report('composite', 'properties.json', `${path}.longhands`, `${extra.join(', ')} are not longhands of ${c.shorthand}`);
        if (both.length > 0) report('composite', 'properties.json', `${path}.omits`, `${both.join(', ')} are both written and omitted`);
      }
    }
    for (const [di, d] of c.doors.entries()) {
      const entry = doorByRef.get(d);
      if (!entry) continue;
      const missing = c.longhands.filter((l) => !entry.door.adapter.writes.includes(l));
      if (missing.length > 0) report('composite', 'properties.json', `${path}.doors[${di}]`, `${d} is a door of ${c.id} but does not write ${missing.join(', ')}: a composite door writes every longhand in one command`);
      if (!entry.command.history.undoable) report('composite', 'properties.json', `${path}.doors[${di}]`, `${d} writes ${c.id} through ${entry.command.id}, which is not undoable: a composite write is one undo step`);
      if (entry.door.kind === 'inspector-field' && entry.door.composite !== c.id) report('composite', entry.file, `${entry.path}.composite`, `${d} is listed as a door of ${c.id} but edits ${entry.door.composite ?? entry.door.property ?? 'nothing'}`);
    }
  }
  // a value a composite offers or writes sets only the longhands the composite writes: none it omits.
  // The longhand is found as a property the matched syntax references (<'column-height'>), or as a
  // keyword only an omitted longhand's syntax names (emoji for font-variant-emoji).
  for (const w of written) {
    const c = w.composite;
    const omitted = c?.omits?.longhands ?? [];
    if (!c || omitted.length === 0) continue;
    const result = analysed.get(`${w.file} ${w.path}`);
    if (!result?.ok) continue;
    const writtenKeywords = new Set(c.longhands.flatMap((l) => Object.keys(compat[l]?.keywords ?? {})));
    const sets = new Set(result.properties.filter((name) => omitted.includes(name)));
    for (const name of omitted) {
      const own = new Set(Object.keys(compat[name]?.keywords ?? {}));
      if (result.keywords.some((k) => own.has(k) && !writtenKeywords.has(k))) sets.add(name);
    }
    if (sets.size > 0) report('composite', w.file, w.path, `"${w.value}" sets ${[...sets].join(', ')}, which ${c.id} omits (${c.omits?.reason ?? ''})`);
  }
  for (const { file, path, door, ref: doorRef } of doors) {
    if (door.kind === 'inspector-field' && door.composite !== null) {
      const c = compositeById.get(door.composite);
      if (c && !c.doors.includes(doorRef)) report('composite', file, `${path}.composite`, `${doorRef} edits ${c.id} but ${c.id} does not list it among its doors`);
    }
    // a longhand that has no control of its own is written only with the rest of its composite
    for (const name of door.adapter.writes) {
      if (propertyById.get(name)?.control !== 'part-of-composite') continue;
      const whole = (compositesOf.get(name) ?? []).some((c) => c.longhands.every((l) => door.adapter.writes.includes(l)));
      if (!whole) report('composite', file, `${path}.adapter.writes`, `${doorRef} writes ${name} without the rest of its composite`);
    }
  }
  for (const [i, prop] of p.properties.properties.entries()) {
    if (prop.control === 'part-of-composite' && !compositesOf.has(prop.id)) report('composite', 'properties.json', `properties[${i}].control`, `${prop.id} is part of no composite`);
  }

  // ---- door-writes: a property lists exactly the doors that write it, and a field writes what it edits
  const writers = new Map<string, string[]>();
  for (const { ref: doorRef, door } of doors) {
    for (const name of door.adapter.writes) {
      if (!writers.has(name)) writers.set(name, []);
      writers.get(name)?.push(doorRef);
    }
  }
  for (const [i, prop] of p.properties.properties.entries()) {
    const actual = writers.get(prop.id) ?? [];
    for (const d of actual) if (!prop.doors.includes(d)) report('door-writes', 'properties.json', `properties[${i}].doors`, `${d} writes ${prop.id} but is not listed among its doors`);
    for (const d of prop.doors) if (doorByRef.has(d) && !actual.includes(d)) report('door-writes', 'properties.json', `properties[${i}].doors`, `${d} is listed among the doors of ${prop.id} but does not write it`);
  }
  for (const { file, path, door, ref: doorRef } of doors) {
    if (door.kind === 'inspector-field' && door.property !== null && propertyById.has(door.property) && !door.adapter.writes.includes(door.property)) {
      report('door-writes', file, `${path}.adapter.writes`, `${doorRef} edits ${door.property} but does not write it`);
    }
  }

  // ---- individual-transform: movement, rotation and scaling use translate, rotate and scale
  for (const { file, path, door, ref: doorRef } of doors) {
    if (!door.adapter.writes.includes('transform')) continue;
    if (door.kind === 'canvas-handle' || door.kind === 'canvas-drag') {
      report('individual-transform', file, `${path}.adapter.writes`, `${doorRef} is a canvas handle and writes transform: handles write translate, rotate or scale`);
    }
    const others = door.adapter.writes.filter((w) => w !== 'transform');
    if (others.length > 0) report('individual-transform', file, `${path}.adapter.writes`, `${doorRef} writes transform together with ${others.join(', ')}: transform only holds the functions translate, rotate and scale do not cover`);
  }
}
