@AGENTS.md

## Claude Code only

- `AGENTS.md` above is the whole rulebook; this file adds only what is specific to Claude Code. Claude Code does not
  read `AGENTS.md` by itself while a `CLAUDE.md` exists, hence the import.
- The Stop check runs from `.claude/settings.json` at the end of every turn and reads `.memory/task.md` (AGENTS.md,
  Finishing a task). If it blocks, finish the lines it names or mark them `blocked: <why>`; never tick a line without
  its evidence to get past it.
- The assistant's own memory (`~/.claude/projects/C--Codex-Shared-deepseek-builder-6/memory/`) holds preferences and
  pointers only; the project's rules live in `AGENTS.md` and its state in `.memory/` and `docs/PRODUCT.md`.
- When the conversation is compacted, keep the open lines of `.memory/task.md`, the files changed and not yet
  committed, and the commands run with their log paths.
