// The tooth proof's switch (tools/runner/tooth.ts), a Vite plugin active only when the runner sets TOOTH_COMMANDS or
// TOOTH_MODULE for the dev server it starts; the product code carries no hook for it.
// - TOOTH_COMMANDS (comma-separated command ids): the command table (src/app/commands.ts) gets, for each, a registered
//   handler that returns without changing anything, and the availability predicate each names in the manifest holds
//   always, so the doors stay enabled and do nothing: a refusal the predicate makes (Escape with nothing selected) is
//   the feature's too, and goes with it.
// - TOOTH_MODULE (a module path, such as src/editor/canvas/render/render.ts): every exported class of the module
// becomes a class
//   whose methods do nothing, and every exported function one that returns nothing.
import fs from 'node:fs';
import path from 'node:path';
import { init, parse } from 'es-module-lexer';
import { normalizePath, type Plugin } from 'vite';

const COMMAND_TABLE = '/src/app/commands.ts';

// the availability predicates the commands name (manifest/commands/*.json)
function predicatesOf(commands: readonly string[]): string[] {
  const all = fs
    .readdirSync('manifest/commands')
    .flatMap((f) => (JSON.parse(fs.readFileSync(path.join('manifest/commands', f), 'utf8')) as { commands: { id: string; availability: { predicate: string } }[] }).commands);
  return [...new Set(all.filter((c) => commands.includes(c.id)).map((c) => c.availability.predicate))];
}

export function toothPlugin(): Plugin | null {
  const commands = (process.env.TOOTH_COMMANDS ?? '').split(',').filter((c) => c !== '');
  const module = process.env.TOOTH_MODULE ?? '';
  if (commands.length === 0 && module === '') return null;
  const predicates = commands.length > 0 ? predicatesOf(commands) : [];
  return {
    name: 'tooth-proof',
    enforce: 'post',
    async transform(code, id) {
      const file = normalizePath(id).split('?')[0] ?? '';
      if (commands.length > 0 && file.endsWith(COMMAND_TABLE)) {
        return `${code}\nimport { registerHandler as __toothHandler } from '/src/core/commands/registry.ts';\nfor (const __id of ${JSON.stringify(commands)}) COMMANDS[__id] = __toothHandler(__id, () => ({ kind: 'change' }));\nfor (const __p of ${JSON.stringify(predicates)}) PREDICATES[__p] = { id: __p, test: () => true };\n`;
      }
      if (module !== '' && file.endsWith(`/${module}`)) {
        await init;
        const [, exported] = parse(code);
        const locals = exported.map((e) => e.ln).filter((ln): ln is string => ln !== undefined);
        // a const binding is never reassigned, so it is left as it is (a module with constants for its data and a
        // function for its behaviour stays buildable, and the function is the behaviour the proof switches off)
        const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const noop = locals
          .filter((ln) => !new RegExp(`\\bconst\\s+${escape(ln)}\\b`).test(code))
          .map(
            (ln) =>
              `try { if (typeof ${ln} === 'function') { if (/^class[\\s{]/.test(Function.prototype.toString.call(${ln}))) { const __m = Object.getOwnPropertyNames(${ln}.prototype).filter((n) => n !== 'constructor'); ${ln} = class {}; for (const __n of __m) ${ln}.prototype[__n] = function () {}; } else ${ln} = function () {}; } } catch {}`,
          )
          .join('\n');
        return `${code}\n${noop}\n`;
      }
      return undefined;
    },
  };
}
