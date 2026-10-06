# Builder

A desktop pagebuilder that runs in recent Chrome only, for professionals who build websites. The edited page renders
inside an iframe scaled with CSS `zoom`; the document JSON is the source of truth, never the DOM.

## Run and check

- `npm run dev` starts the dev server; the port comes from the `PORT` environment variable.
- `npm run check:fast` is the static gate: `gen:check`, `manifest:check`, `inventory:check`, the type checks, lint and
  the unit suite — about a minute.
- `npm run ui -- <flow>` drives the real app in Chrome with real gestures (Playwright on the installed Chrome, never
  an embedded pane), photographs every step into `.cache/logs/ui-<flow>-<time>/`, and fails on any console error,
  incident or unmet expectation. `npm run ui -- --list` says what can be run.
- `npm run e2e` runs the browser tests; at the end of a block, run the tests of what the block built
  (`npm run e2e -- <spec file>`). The complete suite runs once, when the whole application is ready.
- `npm run gate -- <message-file> <log-name> <path>…` commits the paths named and pushes them, after checking exactly
  what is committed (`CLAUDE.md`, Commits).
- `npm run inventory` regenerates `docs/INVENTORY.md` (and its machine copy) and `docs/FEATURES.md` from the manifest,
  the source and the last complete browser run.
- `npm run companion` starts the Builder Companion (web address capture, the assistant's bridge); `npm run perf`
  measures the large page. The full list is in `docs/PRODUCT.md` section 6.

## Where things are

- `manifest/`: the contract — every element type, edited CSS property, interaction constant and command with its
  doors, and every feature with its scenarios. `manifest:check` validates it.
- `spec/BEHAVIOUR.md`: the behaviour specs, one section per feature, anchored by id (the manifest points at them).
- `docs/PRODUCT.md`: the single source of truth — scope, requirements and their status, open problems, decisions,
  architecture, how to prove things.
- `docs/FEATURES.md`, `docs/INVENTORY.md`: generated — the state of every feature; every feature, command, door and
  module, and who owns what.
- `docs/QA-LOG.md`: the history, one row per commit.
- `src/core/`: the document core (no React); `src/editor/`: the editor; `src/app/`: the wiring; `src/manifest/`: the
  contract's reader; `src/generated/`: written by `npm run gen` alone.
- `tests/`: the browser tests and their one fixture (`tests/support/`).
- `tools/`: `gen`, `manifest`, `lint`, `runner`, `inventory`, `ui`, `perf`, `parity`, `journey`, `companion`, `modules`, `gate`
  — what the app is built, checked and driven with.
- `design/final/`: the visual contract and the tokens.
