# AGENTS.md — the entry for Codex

> **Rule zero — research on the internet first, always.** Before
> implementing anything that is not trivial, search the official
> documentation (MDN, W3.org and other relevant primary sources).
> Do this before editing code. If internet access is unavailable,
> report the blocker; do not treat memory or an unverified assumption
> as a substitute.

> **No trial and error.** Before changing code for a defect, establish the observed
> failure, trace it to its root cause across the affected boundaries, research the
> relevant official sources, and record a causal implementation plan. Implement
> the shared cause rather than a site-specific symptom or a speculative tweak.
> When verification fails, inspect the new evidence and revise the hypothesis
> before editing again; do not cycle through ungrounded variations or tune tests,
> references, or metrics to make the result appear successful.

## Priority

1. The user's current explicit request and restrictions.
2. This file and `CLAUDE.md`.
3. The scope and decisions in `docs/PRODUCT.md`.
4. The agent's judgment about implementation.

The standing backlog does not override a narrower current request. If the user asks for analysis only, do not edit, test, commit or push. Do not expand a task to unrelated work.

## Sources of truth

- `CLAUDE.md` contains the repository's working rules.
- `docs/PRODUCT.md` contains requirements, statuses, open problems, decisions, architecture and proof criteria.
- `spec/BEHAVIOUR.md` and `manifest/` define the behavior contract.
- `docs/QA-LOG.md` records completed changes and their commits.
- `.memory/builder.md` is working memory, limited to 60 lines. Read it at the start of a session and after context compaction.
- `.memory/review.md` contains the reviewer's findings. Never delete a finding.

Read only the material needed for the current item. Do not map the whole repository before a small change.

## Standing goal

Work through every in-scope requirement in `docs/PRODUCT.md` section 2 that is not `done` or `out`, and every open problem in section 3. Start with the most severe actionable item. Continue to the next independent item after completing one, unless the current user request narrows or stops this work.

The existing acceptance criteria remain in force. Do not lower the 20-site, 98% fidelity target or mark it complete because progress is slow. A partial result remains `partial` or `open`.

No subagents are used (DEC-11). One agent writes in the single working tree, and only one Playwright run uses Chrome at a time.

## Unit of work

Choose one bounded, observable outcome at a time. Before editing, identify:

1. The exact requirement or problem being addressed.
2. The observed failure and the evidence for it.
3. The likely cause and the smallest relevant change.
4. The test and, for interface work, the real-app gesture that will prove the outcome.

A single cause may resolve several requirements. Do not split a coherent fix into artificial micro-fixes, and do not combine unrelated changes merely to reduce the number of commits.

For the capture corpus, compare the affected sites and viewport sizes before changing code. Prefer a shared cause when the evidence supports one. Record the measured result after each fix, including regressions. Do not claim that improvement on one site completes the corpus requirement.

## When an approach fails

Investigate the failure before changing code again.

- If the same approach fails twice, change the hypothesis or stop using that approach.
- After three attempts without concrete progress on an item, record the attempts, exact errors or measurements, best current hypothesis and remaining dependency in `.memory/builder.md`.
- Do not mark the item complete, weaken its acceptance criterion, edit a test to hide the failure or continue making speculative variations.
- Continue with another independent item when the working tree permits it. Do not mix unfinished work with an unrelated change in one commit.
- If no useful independent work remains, explain the blocker and the decision needed from the user.

Credentials, service tokens, API keys and signing certificates must come from the user. Build the field or step they need, record the dependency under “Waiting on the user”, and continue with independent work.

## Research

Rule zero applies to every non-trivial implementation, including a bug fix. Search the relevant official documentation before editing. Keep the search focused on the behavior or application programming interface involved, and record the source that informed the change. Reuse a source already checked in the current investigation; search again when a new question or new evidence requires it.

Repository behavior must also be established from its code, tests and real-app evidence. Web research does not replace those checks.

## Implementation rules

- Complete means working behavior, not a stub, placeholder, TODO or “first version”.
- Do not change public interfaces, libraries, schemas, migrations or unrelated code merely to make the current item easier.
- Ask before deleting files or data, adding dependencies, changing a schema or migration, or running destructive Git operations.
- Never edit, skip or loosen a test or scenario to make a failure disappear. A legitimate test change reflecting an intentional behavior change must state its reason in the commit and QA-LOG row.
- Never hardcode expected test output, mock the behavior being tested, silence an error or bypass a check.
- Behavior changes must update the manifest and `spec/BEHAVIOUR.md` with the code. Keep one owner per concept.
- Code, comments, documentation, filenames and commit messages are in English. Interface text comes from the i18n catalogues.

Follow the architecture and lint rules in `CLAUDE.md`. In particular, use the document store and commands for state changes, keep the core free of DOM dependencies, use design tokens for CSS values, and keep pointer handling in its designated module. `../builder-5/reference/` is read-only behavior reference, never code to copy.

## Verification

Use the smallest relevant verification while developing. For changed behavior, run the affected unit and browser tests. For interface work, use real gestures in installed Chrome through `npm run ui` and inspect the resulting screenshots. An absence of console errors alone is not visual proof.

Run the tests for a completed block at the end of that block. Run the complete suite once when the whole application is ready, unless the user explicitly requests another full run. Do not repeatedly run the full suite to investigate one failure.

Save the complete output of every command whose result is claimed in `.cache/logs/`. Report the command, exit code, failing test names when applicable, and the relevant final output. Never say that something works, compiles or passes without seeing the result in this session.

## Delivery and Git

A completed change includes its behavior, contract updates, relevant verification and one QA-LOG row. Commit and push each completed change to `origin/main` through the existing gate:

For this project, `origin` must be `https://github.com/designathan1988/app-pagebuilder-v3.git`. Verify the remote before each push; do not publish new commits to the older v2 repository.

```powershell
& "C:\Program Files\Git\bin\bash.exe" .cache/scratch/gate.sh .cache/scratch/msg.txt <short-tag>
```

Write `msg.txt` with a file-editing tool. Use Git Bash at the path above; plain `bash` from PowerShell starts WSL on this machine.

Use the single working tree on `main`. Do not create a branch or worktree. Never use `--no-verify`, `--amend`, force push, reset-hard or clean to get past a problem. If the gate fails, diagnose and report the failure; do not claim delivery.

Keep `.memory/builder.md` current after each commit. Read `.memory/review.md` periodically. Address `OPEN` findings when appropriate, then mark them `FIXED <hash>` or `DISPUTED: <reason>`; never delete them.

## Communication

Tell the user what you are doing in plain Portuguese. Explain acronyms and code terms when they matter.

For each visible interface delivery, describe what a person saw before and what they see now. Include the actual before and after screenshots in the message. For a new capability, show the states needed to understand it. At a stage closing, show the surfaces changed during that stage. For a change with no visible interface effect, report its observable result.

Put the commit and verification result after the user-facing explanation. Distinguish clearly among `done`, `partial`, `blocked` and `not verified`. Never present progress on one part as completion of the entire requirement.
