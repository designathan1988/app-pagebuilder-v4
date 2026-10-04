// The task list of the order being worked on (the working memory's task file, AGENTS.md "Finishing a task"): the
// order's "done when" copied one criterion a line. The Stop check reads it so that a turn cannot end while a
// criterion is silently open.
//
//   - [ ] a criterion                       open: the work is not done and nothing blocks it
//   - [ ] blocked: <why> — a criterion      blocked: it cannot move without the user or an outside dependency
//   - [x] a criterion — evidence: <log>     done: the evidence names the command's log or the photo
//
// An item may continue on the indented lines that follow it.

export type ItemState = 'open' | 'blocked' | 'done' | 'unproven';

export interface TaskItem {
  readonly text: string;
  readonly state: ItemState;
}

const ITEM = /^\s*- \[( |x|X)\] (.*)$/;

export function taskItems(text: string): TaskItem[] {
  const items: { checked: boolean; text: string }[] = [];
  // a list saved with Windows line ends reads the same (a regular expression's . stops at \r)
  for (const line of text.split(/\r?\n/)) {
    const match = ITEM.exec(line);
    if (match !== null) {
      items.push({ checked: match[1] !== ' ', text: (match[2] ?? '').trim() });
      continue;
    }
    const last = items.at(-1);
    // an indented line continues the item above it; a blank or unindented line ends it
    if (last !== undefined && /^\s+\S/.test(line)) last.text = `${last.text} ${line.trim()}`;
  }
  return items.map(({ checked, text: itemText }) => ({ text: itemText, state: stateOf(checked, itemText) }));
}

function stateOf(checked: boolean, text: string): ItemState {
  if (checked) return /\bevidence:/i.test(text) ? 'done' : 'unproven';
  return /\bblocked:/i.test(text) ? 'blocked' : 'open';
}

/** The items that keep a turn from ending: open ones, and ones ticked without their evidence. */
export function unfinished(items: readonly TaskItem[]): TaskItem[] {
  return items.filter((item) => item.state === 'open' || item.state === 'unproven');
}

/** The message the Stop check gives back to the agent, naming each item that is not finished. */
export function stopReason(items: readonly TaskItem[]): string {
  const lines = items.map((item) => `- ${item.state === 'unproven' ? '(ticked without evidence) ' : ''}${item.text}`);
  return [
    `.memory/task.md still has ${items.length} unfinished ${items.length === 1 ? 'criterion' : 'criteria'}:`,
    ...lines,
    'Continue with them. A criterion that cannot move without the user stays listed as "blocked: <why>"; a done one',
    'names its evidence ("evidence: <log or photo>"). If the user changed or narrowed the order, mark the lines it',
    'drops "blocked: <the user\'s words>". Never narrow the order on your own (AGENTS.md, Finishing a task).',
  ].join('\n');
}
