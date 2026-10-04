// The Stop check (.claude/settings.json, the Stop hook): Claude Code runs it whenever Claude ends a turn. While the
// order's task list (the working memory's task file, AGENTS.md "Finishing a task") has a criterion open, or ticked
// without its evidence, it blocks the end of the turn and names what is left, so a task is never reported finished
// with a criterion silently dropped (the audit of 2026-10-04 was closed with R6, R7, the corpus and its audit document
// still open). No task list: nothing to check.
//
// The hook's answer is the JSON Claude Code reads on stdout ({"decision": "block", "reason": …}). It blocks again at
// each stop while the list is unchanged (stop_hook_active is not read: one nudge would let the next stop through);
// Claude Code itself overrides a Stop hook that blocks eight times in a row without progress
// (https://code.claude.com/docs/en/hooks-guide#stop-hook-hits-the-block-cap), so a stuck run still ends.
import fs from 'node:fs';
import path from 'node:path';
import { stopReason, taskItems, unfinished } from './task-list.ts';

interface StopInput {
  readonly cwd?: string;
}

function readInput(): StopInput {
  try {
    const text = fs.readFileSync(0, 'utf8').trim();
    return text === '' ? {} : (JSON.parse(text) as StopInput);
  } catch {
    return {};
  }
}

const input = readInput();
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const file = path.join(root, '.memory', 'task.md');
if (!fs.existsSync(file)) process.exit(0);

const left = unfinished(taskItems(fs.readFileSync(file, 'utf8')));
if (left.length > 0) process.stdout.write(JSON.stringify({ decision: 'block', reason: stopReason(left) }));
process.exit(0);
