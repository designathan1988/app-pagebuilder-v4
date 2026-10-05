// The one store. State changes only through dispatch(command): the store looks up the command's entry in the
// command table, checks its availability predicate, runs its handler, applies the handler's patches as one
// transaction, validates the whole document and the selection, records the transaction in the history when the
// command is undoable and changed something, and notifies subscribers. A state that fails validation is never
// committed. In development and tests every committed state is deep-frozen.
// The editor state (Ui) is opaque here: the editor's handlers own it.
import type { CommandArgs } from '../../generated/commands.ts';
import type { CommandId, ConstantId, MessageId } from '../../generated/ids.ts';
import type { Command } from '../../manifest/schema.ts';
import { argumentRefusal, withCommandName } from './args.ts';
import { referenceKindRegistered } from './references.ts';
import { isBuilt, message, type CommandTable, type HandlerContext, type KeyframeTarget, type Message, type MessageParam, type Outcome, type PredicateTable } from '../commands/registry.ts';
import type { MotionEditorContext } from '../motion/record.ts';
import { locate, type DocumentJson, type Selection } from '../document/model.ts';
import { validateDocument, type Invalid, type ModelRules } from '../document/validate.ts';
import { EMPTY_HISTORY, LAST_CHANGE, record, redo, redone, undo, undone, type HistoryState, type Restorable } from '../history/history.ts';
import { applyPatches, deepEqual, type Patch, type Transaction } from '../history/transaction.ts';
import type { Clock } from '../ports/clock.ts';
import type { ClipboardWriter } from '../ports/clipboard.ts';
import { anyCss, type CssSupport } from '../ports/css.ts';
import type { Downloads } from '../ports/download.ts';
import { reportEmptyChange, reportError, reportInvariantBreach } from '../incidents.ts';
import type { IdGenerator } from '../ports/ids.ts';
import { noLayout, type Layout } from '../ports/layout.ts';
import { rulesForDocument } from '../document/breakpoint-rules.ts';

export interface StoreState<Ui> {
  readonly document: DocumentJson;
  readonly selection: Selection;
  readonly history: HistoryState;
  // the last message, shown in the status bar (an aria-live region)
  readonly message: Message | null;
  // a dispatch waiting for the person's answer to its command's confirmation (the manifest's `confirmation`); absent
  // or null while none waits
  readonly confirmation?: PendingConfirmation | null;
  // the refusal the last command met, with what it was asked, so the control that asked says it beside itself (a
  // field: spec inspector-number-fields, Problems in Pager 3); absent or null once a command runs
  readonly refusal?: Refusal | null;
  // whether the message is a refusal: the next command that runs replaces it, with its own message or none (PRODUCT.md
  // §5.3 "Dock and status bar"; the audit's A3.41: an error never stays after the next action); absent or false
  // otherwise
  readonly refused?: boolean;
  readonly ui: Ui;
}

interface Refusal {
  readonly command: CommandId;
  readonly args: unknown;
  readonly message: Message;
}

// What a confirmation asks and its two answers' labels, from the command's manifest entry, and the dispatch it holds.
interface PendingConfirmation {
  readonly command: CommandId;
  readonly args: unknown;
  readonly message: MessageId;
  // the values of the question's placeholders, from the command that asks
  readonly params?: Readonly<Record<string, string | number>>;
  readonly confirm: MessageId;
  readonly cancel: MessageId;
}

export type DispatchResult =
  | { readonly status: 'done'; readonly changed: boolean }
  | { readonly status: 'refused'; readonly message: Message }
  | { readonly status: 'not-available-yet' }
  // the command asked the person first: the dispatch waits for `answer`
  | { readonly status: 'confirm' };

export class InvalidStateError extends Error {
  override name = 'InvalidStateError';
  constructor(
    // the command that produced the state, or "initial state"
    readonly source: string,
    readonly problems: readonly Invalid[],
  ) {
    super(`${source} produced an invalid state: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`);
  }
}

// A change of the document, for the renderer: the patches that turn `before` into `after`, in order (a
// transaction's patches, its inverses on undo, a cancelled gesture's inverses; a loaded project replaces the pages).
export interface DocumentChange {
  readonly before: DocumentJson;
  readonly after: DocumentJson;
  readonly patches: readonly Patch[];
}

// One pointer gesture: everything dispatched through it is applied at once (the canvas follows the pointer) and
// becomes one transaction and one history entry at commit; cancel restores the state from before the gesture.
export interface Gesture {
  dispatch<Id extends CommandId>(id: Id, args: CommandArgs[Id]): DispatchResult;
  commit(): void;
  cancel(): void;
}

// Commands remain individual transactions, but a short ambiguous keyboard sequence may be cancelled as a whole.
// Only this store owns its state snapshot. Any external dispatch or gesture settles it before doing other work.
export interface CommandSequence {
  dispatch<Id extends CommandId>(id: Id, args: CommandArgs[Id]): DispatchResult;
  active(): boolean;
  commit(): void;
  cancel(): boolean;
}

interface CommandGroup extends Gesture {
  active(): boolean;
}

export interface Store<Ui> {
  getState(): StoreState<Ui>;
  dispatch<Id extends CommandId>(id: Id, args: CommandArgs[Id]): DispatchResult;
  gesture(): Gesture;
  sequence(): CommandSequence;
  sequenceOpen(): boolean;
  // A non-pointer command group accepts every undoable command and holds an exclusive mutation lease.
  commandGroup(busy: Message): CommandGroup;
  commandGroupOpen(): boolean;
  // Whether a gesture is open: its changes are drawn, not committed yet (autosave keeps only committed work)
  gestureOpen(): boolean;
  // Whether the command would run now with these arguments: it is built, its availability predicate holds and its
  // handler does not refuse. Nothing changes: the handler's outcome is read and dropped (handlers are pure). The
  // context menu shows only the commands that apply to the selection (archive/DESIGN.md "Overlays").
  canRun<Id extends CommandId>(id: Id, args: CommandArgs[Id]): boolean;
  // Why the command would not run now with these arguments: "not available yet" while it is not built, else the
  // refusal of its availability predicate or of its handler; null when it would run. Nothing changes, as with canRun
  // (a palette tile's creation drag draws the refusal its drop would meet, spec palette-drag-insert).
  refusal<Id extends CommandId>(id: Id, args: CommandArgs[Id]): Message | null;
  // The person's answer to the confirmation a dispatch is waiting for (state.confirmation): confirmed, the dispatch
  // runs again, told it is confirmed; cancelled, nothing changes and the status bar says so. Nothing happens when no
  // confirmation is waiting.
  answer(confirmed: boolean): DispatchResult;
  // The one way to say something without running a command: a guard that dropped an action it had waited for has no
  // command of its own to say it through (an image file dropped whose target the person has since deleted). It only
  // writes the status bar's message; the document, the selection and the history are untouched.
  notice(message: Message): void;
  subscribe(listener: () => void): () => void;
  // every change of the document, with its patches, before the state's subscribers hear of it
  subscribeDocument(listener: (change: DocumentChange) => void): () => void;
}

export interface StoreOptions<Ui> {
  readonly siteScripts?: HandlerContext<Ui>['siteScripts'];
  readonly table: CommandTable<Ui>;
  readonly predicates: PredicateTable<Ui>;
  // the manifest's commands: availability and history of each
  readonly commands: ReadonlyMap<CommandId, Command>;
  // the manifest's interaction constants, for coalescing windows
  readonly constants: ReadonlyMap<ConstantId, number | readonly number[]>;
  readonly rules: ModelRules;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  // a catalogue text in the language the editor state holds (the core never reads the editor state itself)
  readonly words: (ui: Ui, key: MessageId, params?: Readonly<Record<string, string | number>>) => string;
  readonly language?: (ui: Ui) => string;
  // where the canvas draws the page's nodes (the editor's canvas); none drawn when absent
  readonly layout?: Layout;
  // whether the browser takes a value for a property (the editor's CSS.supports); every value when absent
  readonly css?: CssSupport;
  // the class the editor state makes the style target (the core never reads the editor state itself); none when absent
  readonly styleClass?: (ui: Ui) => string | null;
  // the keyframe the editor state makes the style target (the timeline's playhead, spec timeline-keyframes); none when
  // absent: a style write goes to the elements' styles
  readonly keyframe?: (state: StoreState<Ui>) => KeyframeTarget | null;
  // what the motion commands read of the editor's Timeline: the playhead, and what a style write records into
  // (spec motion-keyframes); none when absent
  readonly motion?: (state: StoreState<Ui>) => MotionEditorContext | null;
  // the saved versions' documents by revision (the recovery port, src/editor/persistence/autosave.ts)
  readonly version?: (revision: string) => unknown;
  // whether this tab only reads the project (another tab edits it, spec multi-tab-guard): a command that would change
  // the document is refused (status.tabGuard.readOnly), nothing else is
  readonly readOnly?: () => boolean;
  // the layer style writes go to: the breakpoint and the state the editor edits (spec breakpoint-overrides,
  // state-styles); the base layer without it. Handlers read it as rules.base, the layer they write.
  readonly layer?: (state: { readonly document: DocumentJson; readonly ui: Ui }) => { readonly breakpoint: string; readonly state: string };
  // the editing lock of the project (the tab-guard port, src/editor/persistence/tab-guard.ts): taken from another tab
  readonly editing?: { takeOver(): void };
  // where a file a command hands out goes (the browser's downloads in the editor); nowhere when absent
  readonly downloads?: Downloads;
  // where what a command copies goes (the system clipboard in the editor); nowhere when absent
  readonly clipboard?: ClipboardWriter;
  // what follows a change in the same transaction (core/data/derive.ts: the content bound to collections and the
  // shared regions): the patches that join the command's own, or the refusal that stops it; nothing follows when absent
  readonly derive?: (before: DocumentJson, after: DocumentJson, context: HandlerContext<Ui>) => { readonly patches: readonly Patch[] } | { readonly refused: Message };
  // the first message too, when the start has something to say (the work recovered after a crash)
  readonly initial: { readonly document: DocumentJson; readonly selection?: Selection; readonly ui: Ui; readonly message?: Message | null };
  // deep-freeze every committed state (development and tests)
  readonly freeze: boolean;
  // the editor state that follows a new selection, whichever command or undo step changed it (the editor's owner of
  // that state knows it: Layers unfolds the branches that hide a selected node)
  readonly followSelection?: (state: StoreState<Ui>) => Followed<Ui>;
  // the editor state that follows a command that ran, by the command's manifest data and the arguments it ran with (a
  // text edit ends when an undoable command runs: the document may change under it; a renamed class the editor targets
  // moves the target with it); it returns the same editor state when nothing follows
  readonly followCommand?: (state: StoreState<Ui>, command: Command, args: Readonly<Record<string, unknown>>) => Followed<Ui>;
}

// What follows a new selection or a command that ran: the editor state, and words for the status bar when what followed
// is something the person should hear of (the style state gone back to Base: the audit's AUD-03)
export interface Followed<Ui> {
  readonly ui: Ui;
  readonly message?: Message | undefined;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

// A patch that adds, removes, or replaces a whole collection: the shape of a structural change, as opposed to a value
// written in place (which may equal the one already held).
const structural = (patch: Patch): boolean => patch.op === 'add' || patch.op === 'remove' || (patch.op === 'replace' && Array.isArray(patch.value));

interface OpenGesture {
  readonly before: StoreState<unknown>;
  command: CommandId | null;
  patches: Patch[];
  inverses: Patch[];
}

export function createStore<Ui>(options: StoreOptions<Ui>): Store<Ui> {
  const { table, predicates, commands, rules, clock, ids } = options;
  const listeners = new Set<() => void>();
  const documentListeners = new Set<(change: DocumentChange) => void>();

  // every built command names a registered availability predicate, and every kind of thing its arguments name has a
  // module that finds it (core/store/references.ts)
  for (const [id, command] of commands) {
    if (isBuilt(table[id]) && predicates[command.availability.predicate as keyof PredicateTable<Ui>] === undefined) {
      throw new Error(`${id} is built but its availability predicate "${command.availability.predicate}" is not registered`);
    }
    for (const [argument, arg] of Object.entries(command.args)) {
      if (isBuilt(table[id]) && arg.refers !== undefined && !referenceKindRegistered(arg.refers)) throw new Error(`${id} is built but no module finds the ${arg.refers} its ${argument} names`);
    }
  }

  // A command that produced patches the model refuses is a bug, never a normal refusal: nothing of the change is
  // published (the previous document, selection and history stay), the incident feed records it, and development and
  // tests throw so it is loud (plan T2). The person is never left with nothing (jornada03 J1, the silent failures):
  // the status bar says the command's change was refused and nothing changed, before development throws.
  // Predictable invalid operations are refused by the operation itself, before any patch exists.
  // A command is named by its name without placeholders when its label has some (the manifest's nameKey): no argument
  // is at hand here to fill them, and a text that cannot be formatted would fail where it is drawn (the audit's
  // AUD-01).
  const nameOf = (command: { readonly labelKey: string; readonly nameKey?: string | undefined }): MessageParam => ({ key: (command.nameKey ?? command.labelKey) as MessageId });
  const breachMessage = (source: string): Message => {
    const command = commands.get(source as CommandId);
    return message('status.change.invalid', { command: command === undefined ? source : nameOf(command) });
  };
  // the refusal the last commit made of a command's own result, read by run() to answer the dispatch
  let breach: Message | null = null;
  const breachNow = (): Message | null => breach;
  const commit = (next: StoreState<Ui>, source: string): StoreState<Ui> => {
    const problems = validateDocument(next.document, next.selection, rules);
    if (problems.length > 0) {
      reportInvariantBreach(source, problems);
      // the first state has no previous one to keep: it must be valid, always
      if (!started) throw new InvalidStateError(source, problems);
      breach = breachMessage(source);
      const kept: StoreState<Ui> = { ...state, message: breach, refused: true };
      if (options.freeze) {
        state = deepFreeze(kept);
        for (const listener of [...listeners]) listener();
        throw new InvalidStateError(source, problems);
      }
      return kept;
    }
    return options.freeze ? deepFreeze(next) : next;
  };
  let started = false;

  let state = commit(
    { document: options.initial.document, selection: options.initial.selection ?? [], history: EMPTY_HISTORY, message: options.initial.message ?? null, ui: options.initial.ui },
    'the initial state',
  );
  started = true;
  let open: OpenGesture | null = null;
  let group: (OpenGesture & { readonly busy: Message; readonly mergeable: string | null }) | null = null;
  let sequence: { readonly before: StoreState<Ui>; readonly mergeable: string | null; readonly inverses: Patch[] } | null = null;
  // the coalescing key of the last dispatch when it recorded an entry that may merge; any other dispatch clears it,
  // so a burst merges only when no other command came in between (spec absolute-nudge)
  let lastMergeable: string | null = null;

  // a committed state whose selection changed, with the editor state that follows it
  const followSelection = (before: StoreState<Ui>, next: StoreState<Ui>): StoreState<Ui> => {
    if (options.followSelection === undefined || deepEqual(before.selection, next.selection)) return next;
    const { ui, message: said } = options.followSelection(next);
    if (ui === next.ui && said === undefined) return next;
    const followed = { ...next, ui, ...(said === undefined ? {} : { message: said }) };
    return options.freeze ? deepFreeze(followed) : followed;
  };

  const publish = (committed: StoreState<Ui>, patches: readonly Patch[] = [], follow = true) => {
    const before = state;
    const next = follow ? followSelection(before, committed) : committed;
    state = next;
    if (next.document !== before.document) {
      const change: DocumentChange = { before: before.document, after: next.document, patches };
      for (const listener of [...documentListeners]) listener(change);
    }
    for (const listener of [...listeners]) listener();
  };

  const settleSequence = () => {
    if (sequence === null) return;
    sequence = null;
    // Persistence ignored provisional changes; it must hear that the current state is now settled.
    publish(state);
  };

  // Commands that coalesce merge entries with the same target and property: the target is the node the arguments
  // name, or else the selection the command acts on.
  const coalescing = (command: Command, args: unknown, selection: Selection): { key: string | null; within: number | null } => {
    const h = command.history;
    if (!h.undoable || h.coalesce === 'none') return { key: null, within: null };
    const constant = options.constants.get(h.coalesce.within as ConstantId);
    const within = typeof constant === 'number' ? constant : null;
    const a = (args ?? {}) as Record<string, unknown>;
    return { key: `${command.id}|${JSON.stringify(a.target ?? a.targets ?? a.nodes ?? selection)}|${JSON.stringify(a.property ?? null)}`, within };
  };

  // what a handler reads: the state now, the ports, the words of the person's language, and whether the person
  // confirmed this run
  // the rules of the project (its own breakpoints: core/document/breakpoints.ts), and of the layer the editor shows
  // (the breakpoint and state picked): what a handler writes into and what a predicate reads. A breakpoint the project
  // does not have (one removed, a preference from another project) is its base.
  const layeredNow = (): ModelRules => {
    const project = rulesForDocument(rules, state.document);
    // the same layer for a predicate and a handler (an element made absolute at Phone is positioned there: A3.23)
    const picked = options.layer?.(state);
    if (picked === undefined) return project;
    const layer = project.breakpoints.has(picked.breakpoint) ? picked : { ...picked, breakpoint: project.base.breakpoint };
    return layer.breakpoint === project.base.breakpoint && layer.state === project.base.state ? project : { ...project, base: layer };
  };
  const handlerContext = (confirmed = false): HandlerContext<Ui> => {
    const ui = state.ui;
    const layered = layeredNow();
    return {
      state,
      clock,
      ids,
      ...(options.siteScripts === undefined ? {} : { siteScripts: options.siteScripts }),
      rules: layered,
      words: (key, params) => options.words(ui, key, params),
      ...(options.language === undefined ? {} : { language: options.language(ui) }),
      layout: options.layout ?? noLayout,
      css: options.css ?? anyCss,
      styleClass: options.styleClass?.(ui) ?? null,
      keyframe: options.keyframe?.(state) ?? null,
      motion: options.motion?.(state) ?? null,
      confirmed,
      version: (revision) => options.version?.(revision),
    };
  };

  const groupBlocked = (outcome: Outcome<Ui>, external: boolean): boolean => outcome.kind === 'load' || outcome.kind === 'undo' || outcome.kind === 'redo' || outcome.kind === 'confirm' ||
    (outcome.kind === 'change' && (outcome.download !== undefined || outcome.clipboard !== undefined || outcome.editing !== undefined || (external && ((outcome.patches?.length ?? 0) > 0 || outcome.selection !== undefined))));
  const busyResult = (): DispatchResult => {
    const text = group?.busy ?? message('common.notAvailableYet');
    publish(commit({ ...state, message: text, refused: true }, 'a command group lease'));
    return { status: 'refused', message: text };
  };

  const run = <Id extends CommandId>(id: Id, args: CommandArgs[Id], gesture: OpenGesture | null, confirmed = false, ownedGroup: OpenGesture | null = null): DispatchResult => {
    const entry = table[id];
    const command = commands.get(id);
    if (!command) throw new Error(`unknown command ${id}`);
    if (group !== null && ownedGroup !== group && command.history.undoable) return busyResult();
    const previousMergeable = lastMergeable;
    lastMergeable = null;
    // the manifest's history.transaction: a command recorded once per dispatch never joins a gesture's transaction
    if (gesture && command.history.undoable && command.history.transaction === 'per-dispatch') throw new Error(`${id} records one transaction per dispatch: it cannot run inside a gesture`);
    if (!isBuilt(entry)) return { status: 'not-available-yet' };
    // arguments the command does not take are refused before anything reads them (core/store/args.ts; AUD-09)
    const invalid = argumentRefusal(id, command, args, state.document, layeredNow());
    if (invalid !== null) {
      publish(commit({ ...state, message: invalid, refused: true }, id));
      return { status: 'refused', message: invalid };
    }
    const predicate = predicates[command.availability.predicate as keyof PredicateTable<Ui>];
    if (predicate && !predicate.test(state, layeredNow(), args)) {
      const declared = message((command.availability.refusalKey ?? 'common.notAvailableYet') as Message['key']);
      const refusal = predicate.refusal?.(state, layeredNow(), args) ?? declared;
      publish(commit({ ...state, message: refusal, refused: true }, id));
      // a refusal the manifest does not declare for the command is a defect of the contract, said after the person has
      // the words (the audit's AUD-08: it threw before anything was said): the incident feed records it, and
      // development and tests throw
      if (refusal.key !== declared.key && !(command.refusals as readonly string[]).includes(refusal.key)) {
        const defect = `${id}: its predicate refuses with ${refusal.key}, which the manifest does not declare for it`;
        reportError(defect, defect);
        if (options.freeze) throw new Error(defect);
      }
      return { status: 'refused', message: refusal };
    }
    // a handler that throws is a defect too, never a silent one (jornada03 J1): the incident feed keeps what it threw,
    // the status bar says the command failed and nothing changed, and development and tests still throw
    let outcome: Outcome<Ui>;
    try {
      outcome = entry.run(handlerContext(confirmed), args);
    } catch (error) {
      const failed = message('status.change.failed', { command: nameOf(command) });
      publish(commit({ ...state, message: failed, refused: true }, id));
      // development hears it through the page's own error feed (src/editor/errors.ts)
      if (options.freeze) throw error;
      reportError(`${id} threw`, error instanceof Error ? (error.stack ?? error.message) : String(error));
      return { status: 'refused', message: failed };
    }

    if (group !== null && groupBlocked(outcome, ownedGroup !== group)) return busyResult();
    // Effects outside state cannot be taken back by a typing guard. History walks and loads also end its scope.
    if (outcome.kind === 'load' || outcome.kind === 'undo' || outcome.kind === 'redo' ||
      (outcome.kind === 'change' && (outcome.download !== undefined || outcome.clipboard !== undefined || outcome.editing !== undefined))) settleSequence();
    // a read-only tab changes no document: a load, a confirmation before one, or patches, are refused
    if (options.readOnly?.() === true && (outcome.kind === 'load' || outcome.kind === 'confirm' || (outcome.kind === 'change' && (outcome.patches?.length ?? 0) > 0))) {
      const readOnly = message('status.tabGuard.readOnly');
      publish(commit({ ...state, message: readOnly, refused: true }, id));
      return { status: 'refused', message: readOnly };
    }
    // the person is asked first: the dispatch waits, with the words of the command's confirmation (manifest)
    if (outcome.kind === 'confirm') {
      if (gesture) throw new Error(`${id} cannot ask a confirmation inside a gesture`);
      const asked = command.confirmation;
      if (asked === null) throw new Error(`${id} asks a confirmation the manifest does not declare`);
      const confirmation: PendingConfirmation = {
        command: id,
        args,
        message: asked.messageKey as MessageId,
        confirm: asked.confirmKey as MessageId,
        cancel: asked.cancelKey as MessageId,
        ...(outcome.params === undefined ? {} : { params: outcome.params })
      };
      publish(commit({ ...state, confirmation }, id));
      return { status: 'confirm' };
    }
    if (outcome.kind === 'refused') {
      const said = withCommandName(outcome.message, command);
      publish(commit({ ...state, message: said, refusal: { command: id, args, message: said }, refused: true }, id));
      return { status: 'refused', message: said };
    }
    if (outcome.kind === 'undo' || outcome.kind === 'redo') {
      if (gesture) throw new Error(`${id} cannot run inside a gesture`);
      const tx = outcome.kind === 'undo' ? state.history.past.at(-1) : state.history.future.at(-1);
      const restored: Restorable | null = (outcome.kind === 'undo' ? undo : redo)(state);
      if (restored === null || tx === undefined) return { status: 'done', changed: false };
      // the step names what it undoes or redoes: what its command said, else "the last change"
      const action = tx.message ?? LAST_CHANGE;
      publish(commit({ ...state, ...restored, message: outcome.kind === 'undo' ? undone(action) : redone(action), refusal: null, refused: false }, id), outcome.kind === 'undo' ? tx.inverses : tx.patches);
      return { status: 'done', changed: true };
    }
    if (outcome.kind === 'load') {
      if (gesture) throw new Error(`${id} cannot run inside a gesture`);
      const loaded = commit({ ...state, document: outcome.document, selection: [], history: EMPTY_HISTORY, message: outcome.message ?? (state.refused === true ? null : state.message), refusal: null, refused: false }, id);
      publish(loaded, [{ op: 'replace', path: ['pages'], value: outcome.document.pages }]);
      return { status: 'done', changed: true };
    }

    const before = state;
    // a patch that does not fit the document, or a derivation that throws, is a failure of the command as a handler
    // that throws is (the audit's ST2: it escaped dispatch into the control that asked, with no word said)
    let own: ReturnType<typeof applyPatches>;
    let derived: ReturnType<NonNullable<StoreOptions<Ui>['derive']>> | null;
    try {
      own = applyPatches(before.document, outcome.patches ?? []);
      // what follows the change (options.derive) is computed from the document the handler's patches make and joins
      // them in one transaction, before the whole is validated and recorded: one undo takes both back. A refusal there
      // is the command's own, said before anything changes.
      derived = own.applied.length > 0 && options.derive !== undefined ? options.derive(before.document, own.document, handlerContext(confirmed)) : null;
    } catch (error) {
      const failed = message('status.change.failed', { command: nameOf(command) });
      publish(commit({ ...state, message: failed, refused: true }, id));
      if (options.freeze) throw error;
      reportError(`${id} produced patches that do not fit the document`, error instanceof Error ? (error.stack ?? error.message) : String(error));
      return { status: 'refused', message: failed };
    }
    if (derived !== null && 'refused' in derived) {
      publish(commit({ ...state, message: derived.refused, refusal: { command: id, args, message: derived.refused }, refused: true }, id));
      return { status: 'refused', message: derived.refused };
    }
    const followed = derived === null || derived.patches.length === 0 ? null : applyPatches(own.document, derived.patches);
    const applied = followed === null ? own : { document: followed.document, applied: [...own.applied, ...followed.applied], inverses: [...followed.inverses, ...own.inverses] };
    const documentChanged = applied.applied.length > 0 && !deepEqual(before.document, applied.document);
    if (!documentChanged && (outcome.patches ?? []).some(structural)) reportEmptyChange(id, outcome.message === undefined ? null : JSON.stringify(outcome.message));
    if (documentChanged && !command.history.undoable) throw new Error(`${id} is not undoable in the manifest but changed the document`);
    // a node the derivation took away (a repeated item whose item went) leaves the selection with it
    const chosen = outcome.selection ?? before.selection;
    const selection = followed === null ? chosen : chosen.filter((node) => locate(applied.document, node) !== null);
    let history = before.history;
    // a gesture's transaction takes the patches once the commit accepts them, below (the audit's AUD-08: they joined it
    // before, and a refused commit inside a gesture left them in its history entry)
    if (documentChanged && gesture === null && ownedGroup === null) {
      const { key, within } = coalescing(command, args, before.selection);
      const tx: Transaction = { command: id, patches: applied.applied, inverses: applied.inverses, selectionBefore: before.selection, selectionAfter: selection, at: clock.now(), coalesceKey: key, message: outcome.message ?? null };
      history = record(before.history, tx, key !== null && key === previousMergeable ? within : null);
      lastMergeable = key;
    }
    const ran: StoreState<Ui> = {
      document: documentChanged ? applied.document : before.document,
      selection,
      history,
      // a refusal's message goes with the next command that runs, which says its own or nothing
      message: outcome.message ?? (before.refused === true ? null : before.message),
      confirmation: before.confirmation ?? null,
      refusal: null,
      refused: false,
      ui: outcome.ui ?? before.ui,
    };
    const follows = options.followCommand?.(ran, command, args);
    const next: StoreState<Ui> = follows === undefined ? ran : { ...ran, ui: follows.ui, ...(follows.message === undefined ? {} : { message: follows.message }) };
    const changed = documentChanged || !deepEqual(before.selection, next.selection) || next.ui !== before.ui || next.message !== before.message;
    breach = null;
    if (changed) {
      const committed = commit(next, id);
      const refused = breachNow();
      if (refused !== null) {
        publish(committed);
        return { status: 'refused', message: refused };
      }
      if (documentChanged && gesture !== null) {
        gesture.command ??= id;
        gesture.patches.push(...applied.applied);
        gesture.inverses.unshift(...applied.inverses);
      } else if (documentChanged && ownedGroup !== null) {
        ownedGroup.command ??= id;
        ownedGroup.patches.push(...applied.applied);
        ownedGroup.inverses.unshift(...applied.inverses);
      }
      if (documentChanged) sequence?.inverses.unshift(...applied.inverses);
      publish(committed, documentChanged ? applied.applied : []);
    }
    // the file the command hands out, once its state is committed
    if (outcome.download !== undefined) options.downloads?.deliver(outcome.download);
    // what the command copies, once its state is committed
    if (outcome.clipboard !== undefined) options.clipboard?.write(outcome.clipboard);
    // the editing lock taken from another tab, once the state is committed
    if (outcome.editing === 'take-over') options.editing?.takeOver();
    return { status: 'done', changed };
  };

  // why a command would not run now (the predicate's refusal, as run() reads it, or the handler's): nothing changes,
  // the handler's outcome is read and dropped (handlers are pure)
  const refusal = <Id extends CommandId>(id: Id, args: CommandArgs[Id]): Message | null => {
    const entry = table[id];
    const command = commands.get(id);
    if (!command) throw new Error(`unknown command ${id}`);
    if (group !== null && command.history.undoable) return group.busy;
    if (!isBuilt(entry)) return message('common.notAvailableYet');
    const invalid = argumentRefusal(id, command, args, state.document, layeredNow());
    if (invalid !== null) return invalid;
    const predicate = predicates[command.availability.predicate as keyof PredicateTable<Ui>];
    // a predicate or a handler that throws while a control asks is a defect, said as a failure and recorded, never a
    // throw into the control that asked (the audit's AUD-08: with no error boundary, it blanked the editor)
    try {
      if (predicate && !predicate.test(state, layeredNow(), args)) return predicate.refusal?.(state, layeredNow(), args) ?? message((command.availability.refusalKey ?? 'common.notAvailableYet') as Message['key']);
      const outcome = entry.run(handlerContext(), args);
      if (group !== null && groupBlocked(outcome, true)) return group.busy;
      return outcome.kind === 'refused' ? withCommandName(outcome.message, command) : null;
    } catch (error) {
      reportError(`${id} threw while its control asked whether it would run`, error instanceof Error ? (error.stack ?? error.message) : String(error));
      return message('status.change.failed', { command: nameOf(command) });
    }
  };

  return {
    getState: () => state,
    gestureOpen: () => open !== null,
    sequenceOpen: () => sequence !== null,
    commandGroupOpen: () => group !== null,
    commandGroup: (busy) => {
      if (group !== null) throw new Error('a command group is already open');
      if (open !== null) throw new Error('a pointer gesture is open');
      if (sequence !== null) throw new Error('a command sequence is open');
      if (state.confirmation != null) throw new Error('a confirmation is waiting');
      const current = { before: state as StoreState<unknown>, busy, mergeable: lastMergeable, command: null as CommandId | null, patches: [] as Patch[], inverses: [] as Patch[] };
      group = current;
      const cancel = () => {
        if (group !== current) return;
        group = null;
        lastMergeable = current.mergeable;
        const before = current.before as StoreState<Ui>;
        publish(commit({ ...state, document: before.document, selection: before.selection, history: before.history, confirmation: before.confirmation ?? null }, 'a cancelled command group'), current.inverses);
      };
      return {
        active: () => group === current,
        dispatch: (id, args) => {
          if (group !== current) throw new Error('this command group is closed');
          try {
            const result = run(id, args, null, false, current);
            if (result.status !== 'done') cancel();
            return result;
          }
          catch (error) { cancel();
            throw error;
          }
        },
        cancel,
        commit: () => {
          if (group !== current) throw new Error('this command group is closed');
          const before = current.before as StoreState<Ui>;
          try {
            const tx: Transaction | null = current.command === null || deepEqual(before.document, state.document) ? null : {
              command: current.command,
              patches: current.patches,
              inverses: current.inverses,
              selectionBefore: before.selection,
              selectionAfter: state.selection,
              at: clock.now(),
              coalesceKey: null,
              message: state.message !== before.message ? state.message : null
            };
            const next = commit({ ...state, history: tx === null ? before.history : record(before.history, tx, null) }, current.command ?? 'a command group');
            group = null;
            lastMergeable = null;
            publish(next);
          } catch (error) { cancel();
            throw error;
          }
        },
      };
    },
    sequence: () => {
      if (group !== null) throw new Error('a command group is open');
      if (open) throw new Error('a pointer gesture is open: a command sequence cannot start');
      settleSequence();
      const current = { before: state, mergeable: lastMergeable, inverses: [] as Patch[] };
      sequence = current;
      return {
        active: () => sequence === current,
        dispatch: (id, args) => {
          if (sequence !== current) throw new Error('this command sequence is closed');
          return run(id, args, null);
        },
        commit: () => { if (sequence === current) settleSequence(); },
        cancel: () => {
          if (sequence !== current) return false;
          sequence = null;
          lastMergeable = current.mergeable;
          publish(commit(current.before, 'a cancelled command sequence'), current.inverses, false);
          return true;
        },
      };
    },
    canRun: (id, args) => refusal(id, args) === null,
    refusal,
    dispatch: (id, args) => {
      if (open) throw new Error('a gesture is open: dispatch through it');
      settleSequence();
      return run(id, args, null);
    },
    answer: (confirmed) => {
      if (group !== null) return busyResult();
      settleSequence();
      const waiting = state.confirmation ?? null;
      if (waiting === null) return { status: 'done', changed: false };
      if (open) throw new Error('a gesture is open: a confirmation waits outside gestures');
      if (confirmed) {
        publish(commit({ ...state, confirmation: null }, waiting.command));
        return run(waiting.command, waiting.args as CommandArgs[typeof waiting.command], null, true);
      }
      publish(commit({ ...state, confirmation: null, message: message('status.confirmation.cancelled') }, waiting.command));
      return { status: 'done', changed: false };
    },
    notice: (text) => {
      // the document, the selection, the history and the refusal are untouched: only what the status bar reads
      publish(commit({ ...state, message: text, refused: false }, 'a notice'));
    },
    gesture: () => {
      if (group !== null) throw new Error('a command group is open');
      if (open) throw new Error('a gesture is already open');
      settleSequence();
      const current: OpenGesture = { before: state as StoreState<unknown>, command: null, patches: [], inverses: [] };
      open = current;
      const close = () => {
        if (open !== current) throw new Error('this gesture is closed');
        open = null;
      };
      return {
        dispatch: (id, args) => {
          if (open !== current) throw new Error('this gesture is closed');
          return run(id, args, current);
        },
        commit: () => {
          close();
          const before = current.before as StoreState<Ui>;
          // a gesture that leaves the document as it was (a click that only selects) records nothing, and its end is
          // still heard: what waits for no gesture to be open (autosave keeps the selection it made) hears it now
          if (current.command === null || current.patches.length === 0 || deepEqual(before.document, state.document)) {
            publish(state);
            return;
          }
          // one gesture is one entry: it never merges with another
          // a gesture says what it did by the last message its commands gave
          const tx: Transaction = {
            command: current.command,
            patches: current.patches,
            inverses: current.inverses,
            selectionBefore: before.selection,
            selectionAfter: state.selection,
            at: clock.now(),
            coalesceKey: null,
            message: state.message !== before.message ? state.message : null
          };
          publish(commit({ ...state, history: record(before.history, tx, null) }, current.command));
        },
        cancel: () => {
          close();
          const before = current.before as StoreState<Ui>;
          if (state !== before) publish(commit({ ...state, document: before.document, selection: before.selection, history: before.history }, 'a cancelled gesture'), current.inverses);
        },
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDocument: (listener) => {
      documentListeners.add(listener);
      return () => documentListeners.delete(listener);
    },
  };
}
