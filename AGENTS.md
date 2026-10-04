# AGENTS.md — the entry for Codex

> **Rule zero — research on the internet first, always.** Before
> implementing anything that is not trivial, search the official
> documentation (MDN, W3.org and others as references).

You are continuing work another agent (Claude) started in this repository. You own the work: you decide the
approach, try it, see whether it works, change course when it does not, and choose the best path. This file gives
you the goal, the few rules that are not negotiable, and the facts of this machine. Everything else is your call.

## 1. Where things are

- **`CLAUDE.md`** — the rules of this repository. They apply to you as written ("the assistant" means you).
- **`docs/PRODUCT.md`** — the single source of truth: scope, the requirements register with each requirement's status,
  the open problems, the decisions, the architecture and how to prove things.
- **`.memory/builder.md`** — your working memory. Keep it current (at most 60 lines) so that after a context
  compaction you know where you are; read it first after one.
- **`.memory/review.md`** — the reviewer's findings (section 4).
- **`docs/QA-LOG.md`** — every change so far, one row each, with its commit.

`.memory/` and `.cache/` are ignored by git and exist only on this machine. The approved plan of 2026-10-01 is
translated and archived in `docs/archive/plan-2026-10-01.md`; its items are rows of the requirements register.

## 2. The goal

Every requirement of `docs/PRODUCT.md` section 2 that is not **done** or **out**, and every open problem of section 3,
fixed and proven, most severe first. The scope is the commitment; the order, the technique, the split into commits
and the way you prove things are yours to choose (subagents are not used: DEC-11). Keep going from one item to the
next without waiting for anyone. Where something needs the user's own credentials or permission (SDK install,
service tokens, API key, signing certificate), build the field or step for the user, never type a credential, note it
in your memory under "Waiting on the user", and carry on with what does not depend on it.

## 3. Not negotiable (the user's rules)

- **Complete, never minimal.** No stub, placeholder, TODO or "first version" counts as done.
- **Never edit, skip or loosen a test or a scenario to make it pass.** A test changed on purpose says why in its
  commit and QA-LOG row. Never fake a result; a claim rests on the full output saved in `.cache/logs/`.
- **Proven in the real app.** Interface work is proven with real gestures in the installed Chrome (`npm run ui`,
  the e2e tests) and by looking at the pictures, not by the absence of errors.
- **The contract stays true.** Behaviour changes go through the manifest and `spec/BEHAVIOUR.md` with the code; one
  owner per concept (`check:fast` and the inventory enforce this).
- **Everything committed and pushed**, one change per commit, through the gate (below), with its QA-LOG row.
- **Tell the user what you are doing**, as you go, in plain Portuguese with every acronym or code spelled out.
- **Show the user every delivery, always, until the end of the plan.** The user cannot see the app through your
  eyes. For every item, every part of a large item, every review finding fixed and every stage closing: say in two
  or three plain sentences what a person saw in the app before and what they see now (never in terms of tests),
  and put the photos in the message itself as images (`![what it shows](absolute path of the PNG)`): at least one
  of the defect or the old state and one of the result; for new capabilities, one photo per state that matters.
  The commit and the tests go last, in one line. At a stage closing, a gallery of every surface the stage touched.

## 4. The reviewer

A reviewer (Claude, in another window) reads your commits, logs, photos and code, and writes findings in
`.memory/review.md`. A finding says what is wrong, why, and the evidence; how to fix it is yours. Read the file
from time to time; deal with `OPEN` findings when you judge best, then mark each `FIXED <hash>` or
`DISPUTED: <why>` (you may disagree, with reasons). Never delete a finding.

## 5. Facts of this machine

- **The gate** regenerates, runs `check:fast`, commits and pushes `main` to `origin` (the v2 repository; the remote
  `v1` is read-only):

  ```powershell
  & "C:\Program Files\Git\bin\bash.exe" .cache/scratch/gate.sh .cache/scratch/msg.txt <short-tag>
  ```

  Use Git Bash by that full path: plain `bash` from PowerShell is WSL here. Write `msg.txt` with your file-editing
  tool (Windows PowerShell 5.1 redirection adds a byte-order mark or the ANSI code page). Never `--no-verify`,
  `--amend`, a branch, a worktree or a force push: one tree, `main`.
- One agent writes in this tree at a time, and one Playwright run at a time (they share the port and Chrome).
- Lint traps: no `onPointer*`/`onMouse*` props or pointer listeners outside `src/editor/input/pointer.ts` (publish a
  signal from `pointer/views.ts`); no `contentWindow` outside the canvas; no `setState` inside an effect; CSS values
  only from the tokens. A feature with no command needs a scenario and a `toothProof` to be registered.
- Code, comments, docs and commit messages in English; UI text only through the i18n catalogues.
- `../builder-5/reference/` is read-only reference for behaviour, never for code.
