// The removable modules the application installs (src/modules/*): the one place a module joins the command table,
// the predicates and the document validator. Removing a module is removing its line here and in modules-view.ts (its
// editor side), its manifest files and its folder; the rest of the application does not name it. A document a removed
// module wrote still opens: its authoring data is kept, unread (core/document/authoring.ts).
import type { CommandId } from '../generated/ids.ts';
import { registerAuthoringValidator, type AuthoringValidator } from '../core/document/authoring.ts';
import { LAYOUT_COMPOSER } from '../modules/layout-composer/module.ts';

// what the application asks of a module here: the validator of what it keeps on the document
interface InstalledModule {
  readonly authoring: { readonly namespace: string; readonly validator: AuthoringValidator };
}

const INSTALLED: readonly InstalledModule[] = [LAYOUT_COMPOSER];

for (const module of INSTALLED) registerAuthoringValidator(module.authoring.namespace, module.authoring.validator);

// A module's handlers by the command each names, typed so the command table still proves itself complete (exported:
// every module's line below uses it, and the application holds it while none is installed)
type Named = { readonly command: CommandId };
type ByCommand<H extends readonly Named[]> = { readonly [E in H[number] as E['command']]: E };
const byCommand = <H extends readonly Named[]>(handlers: H): ByCommand<H> => Object.fromEntries(handlers.map((h) => [h.command, h])) as ByCommand<H>;

export const MODULE_COMMANDS = { ...byCommand(LAYOUT_COMPOSER.handlers) } as const;
export const MODULE_PREDICATES = { ...LAYOUT_COMPOSER.predicates } as const;
