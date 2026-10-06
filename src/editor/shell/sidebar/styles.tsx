// The Styles view (spec shared-style-classes): the project's classes, each renamed in place, then its variables,
// site colours and suggestions (variables.tsx).
import { useEffect, useRef } from 'react';
import { isFeatureBuilt } from '../../../core/commands/registry.ts';
import type { DispatchResult } from '../../../core/store/store.ts';
import type { CommandId, FeatureId } from '../../../generated/ids.ts';
import type { DoorEntry } from '../../../manifest/runtime.ts';
import { DoorControl, useDoor } from '../../doors/door.tsx';
import { doorSlots } from '../../doors/placement.ts';
import { afterGesture } from '../../input/pointer.ts';
import { useEditorState, useStore } from '../../store.ts';
import { ViewTitle } from '../view-title.tsx';
import { useT } from '../../text.ts';
import { SiteColours, Suggestions, Variables } from '../variables.tsx';
import { classesOf, usesOfClass } from '../../../core/design/classes.ts';

// The Styles view: its Classes and Variables sections, with the doors the manifest places in the styles region, each
// disabled with "not available yet" until its command is built (the user's correction of decision 2).
export function Styles() {
  const t = useT();
  return (
    <section className="view" aria-label={t('activity.styles')} data-region="styles">
      <ViewTitle panel="variables" title={t('activity.styles')} />
      <div className="section-title">
        <span className="section-title__text">{t('styles.classes')}</span>
      </div>
      <StyleClasses />
      <Variables />
      <SiteColours />
      <Suggestions />
    </section>
  );
}

// The project's classes, read-only (styles; spec shared-style-classes): each name and how
// many elements have it; a class is edited through the selector bar.
function StyleClasses() {
  const t = useT();
  const text = useEditorState((s) => JSON.stringify(classesOf(s.document).map((c) => [c.name, usesOfClass(s.document, c.name)])));
  const rows = JSON.parse(text) as [string, number][];
  // none yet: how one is made (LR2: an empty project's view was a title over nothing)
  if (rows.length === 0) return <p className="styles__none">{t('styles.noClasses')}</p>;
  const rename = doorSlots('styles').find((entry) => entry.command.args.nextName !== undefined);
  const remove = doorSlots('styles').find((entry) => entry.command.args.className !== undefined && entry.command.args.nextName === undefined);
  return (
    <ul className="style-classes">
      {rows.map(([name, count]) => (
        <li key={name} className="style-classes__row">
          {rename !== undefined ? <ClassNameField entry={rename} name={name} /> : <span className="style-classes__name">.{name}</span>}
          <span className="style-classes__count">{count === 1 ? t('styles.count.one') : t('styles.count.other', { count })}</span>
          {remove !== undefined ? <DoorControl entry={remove} args={{ className: name }} label={t('styles.deleteClassUsedBy', { count })} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ClassNameField({ entry, name }: { readonly entry: DoorEntry; readonly name: string }) {
  const store = useStore();
  const door = useDoor(entry, { className: name }, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  const field = useRef<HTMLInputElement>(null);
  const said = useEditorState((state) => state.message);
  useEffect(() => {
    if (field.current !== null) field.current.value = name;
  }, [name, said]);
  const keep = () => {
    const nextName = field.current?.value ?? name;
    if (nextName === name) return;
    afterGesture(store, () => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { className: name, nextName }));
  };
  return (
    <form className={`style-classes__field${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify({ className: name })} title={door.title} onSubmit={(event) => { event.preventDefault();
      keep();
    }}>
      <input ref={field} className="input" aria-label={door.label} disabled={!door.available} spellCheck={false} onBlur={keep} />
    </form>
  );
}
