# Lossless Captured Pages Implementation Plan

> **For agentic workers:** Execute this plan in the current `main` checkout, one task and one gate commit at a time. DEC-11 forbids subagents, branches, and worktrees in this repository.

**Goal:** Make accessible web pages render and remain editable after capture without discarding their DOM, cascade, responsive state, or localizable resources; prove fidelity against the unchanged 20-site corpus at four widths.

**Architecture:** A captured page stores full ordered browser DOM snapshots for observed widths, the original ordered author styles and localized resources in versioned JSON. `Page.tree` remains an empty root for page settings on captured pages; `Page.capture` is the only source of captured content, never a second lossy projection. Canvas and export render that same data, with edits recorded as document patches. Authored pages retain their present BEM pipeline. Browser-paint fallbacks carry an explicit editability limit.

**Tech Stack:** TypeScript, React, Chrome, Playwright, Vitest, CSS Tree, ZIP project storage; no new dependency is planned.

**Spec:** `docs/PRODUCT.md` PLAN-R8 / STG-12.6 / AUD-15; root-cause data in `.cache/logs/capture-diagnosis-2026-10-04.md` and `.cache/logs/capture-pipeline-study.json`.

## Global constraints

- User approved schema/interface changes and saved-project migration on 2026-10-04.
- Keep one document JSON source of truth. Do not hide an uneditable original HTML copy behind an editable but visually different projection.
- Preserve authored pages and migrate old saved projects forward; refuse unknown newer versions.
- Run original Chrome gestures and inspect before/after PNGs for each visible delivery.
- Keep the 20-site list, unchanged pixel comparator and the current 100% target. Re-record references when capture changes; each live reference and DOM must come from the same paused page. Preserve historical HARs, images and complete command logs.
- All source text, source-order CSS, and observed responsive differences must remain traceable in saved data. Do not insert site-name branches or pixel-specific fixes.
- Scripts are inert on the editing canvas. Unsafe URLs, inline event handlers, and script execution must be handled explicitly; retaining visual markup does not authorize running third-party code in the editor.

## Findings that determine the design

1. The present importer maps HTML to closed element types, turns mixed content into text runs, unwraps unknown tags, and drops visual descendants such as Typewolf's `<p><a><img>`. It cannot encode the source DOM without loss.
2. It partitions source CSS into a generated later sheet plus a residual sheet. CSS cascade layers, `!important`, specificity, inline declarations, conditional rules and inherited custom properties are order dependent. A broad attempt to wrap all original CSS in a layer passed a toy fixture but did not improve selected real sites, so CSS provenance and edit origin must be modeled, not guessed from property names.
3. A single wide DOM cannot describe four freshly navigated viewport states. Allbirds has different phone content/order; W3C menu state differs. Stable identity matching must report additions, removals, and moves rather than silently reusing the desktop tree.
4. The Companion copy itself was below 98% at every width on 11 sites, while 18 sites lost fidelity during conversion in the earlier three-stage study. Those earlier absolute scores used references now known to be degraded; the stage pattern still isolates two boundaries. New evidence binds live PNG, DOM, layout, runtime values and HAR resources from the same paused page, and compares two independent live loads at each width. Unstable pairs remain invalid evidence, not a reason to alter the threshold.
5. A read-only census of 19 available Companion copies found 19,719 elements; 1,043 text-model elements containing visual media; 762 unsupported HTML elements (SVG internals excluded); 1,847 inline style attributes; 16 frames; 24 CSS layers and 4,357 important declarations. Twelve sites currently have paired live desktop/phone snapshots. These are compatibility candidates, not assertions that every counted node is lost. Evidence: `.cache/logs/capture-architecture-census.md` and `.cache/logs/capture-systemic-audit-2026-10-04.md`.

## File ownership and interfaces

- `tools/capture/reference.ts` owns live screenshot/DOM/runtime/layout observation, fixed clock/seed and independent-load validity. `tools/capture/diagnose.ts` remains read-only: a marked PNG and first differing band/boxes, never a scorer.
- `tools/companion/serialize.ts` and capture assembly own same-load per-width DOM/style/resource observations, including frame/shadow/media paint sidecars. The Companion package carries a versioned `.capture/snapshots.json` alongside localized HTML/CSS/assets; no extra site-script replay creates the import source.
- `src/core/document/captured.ts` owns `CapturedNode` (`element` with namespace, tag, ordered attributes and ordered children; `text`/`comment` with literal value), viewport snapshots, source styles and stable IDs. `Page.capture` owns all captured content; the mandatory `Page.tree` is an empty page-settings root only, so no lossy projection is saved beside it.
- `src/core/document/model.ts`, `migrations.ts`, `validate.ts` own the captured-page field, version 3 migration and invariants. Migration 2→3 preserves existing authored page trees/styles without changing their output.
- `src/core/import/captured.ts` recognizes and validates the Companion's snapshot metadata, retains arbitrary mixed HTML and namespaces, and localizes addresses. `src/core/import/import.ts` remains the command owner and keeps ordinary HTML import behavior for files without snapshot metadata.
- `src/core/render/captured.ts` owns safe browser DOM creation in the canvas; `src/core/export/captured.ts` owns HTML/CSS output from the same data. Source sheets keep order/layers/importance, and captured author inline declarations retain their element-attached priority. The existing authored BEM/no-inline-style contract continues for authored pages; the captured-page exception must be recorded in PRODUCT/spec with implementation.
- `src/core/capture/edits.ts` owns typed patches to captured nodes (text, attributes, element order/structure, and style overrides); commands use the existing store/undo history. Inspector and Layers expose those commands through the manifest.
- `manifest/`, `spec/BEHAVIOUR.md`, `docs/PRODUCT.md`, and `docs/QA-LOG.md` register each changed behavior and its proof. Generated inventory is regenerated by the gate.

## Review focus

- Text before, between, and after media in a paragraph or caption remains ordered and editable.
- A custom element, SVG namespace, `<picture>`, and slotted open shadow content retain visible children and safe attributes.
- Source CSS, including inline declarations, original media/supports/layer order, root variables and SVG-internal selectors, computes unchanged when the person has not edited it.
- A site `!important` rule, layered/unlayered rules, inline values, `@supports`, and root variables compute as in the copied page until a user edits the property; an edit has defined precedence and survives undo/reopen/export.
- Fresh viewport navigation can add, remove, reorder, and change text/attributes on elements. Variant identity conflicts must fail visibly, not apply a patch to the wrong node.
- Every referenced resource is either localized with the exact observed bytes or reported missing/blocked; no silent remote substitution is considered a fidelity pass.

## Task 1: Valid source and boundary proof (R6)

- [ ] Prove the controlled fresh-viewport, duplicate-HAR-response, late-lazy-content, same-load DOM, fixed-clock/random, preserved session/cache history and source/diagnostic layout cases red then green in installed Chrome.
- [ ] For each corpus width, bind live PNG, `serializePage` result, responsive runtime values and source layout from the same paused page; localize resource bytes from its HAR. Photograph a second independent load with equivalent navigation history. Record its unchanged pixel agreement; below 99%, mark the site's score invalid and inspect its live/live difference instead of choosing a favorable run.
- [ ] Re-record and verify all 80 live references and four-width snapshots; produce a gallery and report with live/live and HAR-replay diagnostics separate from the export score. Preserve old records as evidence. If a source cannot be made stable or accessible under general controls, document same-kind replacement with photos and a PRODUCT decision, never by score preference.
- [ ] Update the contract, requirement register and QA log; gate-commit/push the complete reference methodology. Mark R6 fixed only with full evidence.

## Task 2: Lossless captured document, untouched canvas and export

- [ ] Write red validation/migration tests: arbitrary nested tags, mixed text/media, preserved attribute order/namespace, malicious event attributes rejected, version-1 and version-2 authored pages unchanged after migration and reopen.
- [ ] Add the page union and captured tree types. Add version 2→3 migration; update typed current-version fixtures without changing behavior expectations.
- [ ] Import the Companion snapshot package into `Page.capture`, never through the restricted text/BEM conversion. Parse/validate arbitrary ordered HTML/SVG/MathML nodes; sanitize scripts, event attributes and unsafe URLs. Keep source style sheets and inline styles in browser cascade order. Do not alter ordinary authored HTML import.
- [ ] Render and export from the same saved capture tree and localized resources; prove unedited source→canvas→export DOM order and computed style/geometry at four widths on controlled mixed media, unknown-tag, root-variable, layered/important/inline CSS, SVG and font fixtures. The test must fail on the current code, then pass without per-site branches or comparator changes.
- [ ] Prove selection and a real text/attribute/style edit with undo/reopen/export. Gate-commit/push a complete visible behavior with manifest/spec/PRODUCT/QA row and before/after Chrome images. A data type without usable canvas/export/editing is not a delivered feature.

## Task 3: Full responsive DOM and editable variants

- [ ] Add controlled Chrome cases in which fresh desktop/phone navigation changes element presence, order, text, classes, menu state, inline values and picture source. Require the exact DOM for each observed width to survive capture, editing and export.
- [ ] Choose observed viewport snapshots in the canvas and in exported HTML without adding wrappers that change child/adjacent/`:nth-*` selectors. Make matching IDs and edit width scope explicit; uncertain matches stay independent. Define how unsampled widths behave and do not claim exactness there.
- [ ] Show a real variant edit, undo, save/reload and four-width export in Chrome; gate-commit/push with contract and photos. Re-measure representative sites from both previously observed bottlenecks, including Grid by Example as a regression gate.

## Task 4: Browser paint/resources and complete editing

- [ ] Add controlled real-browser cases for cross-origin frame DOM, open/closed shadow content, canvas/WebGL bitmap, selected video frame/poster, script-added fonts, pseudo-element paint, failed/blocked resources and exact original asset bytes. Use Playwright frames and Chrome protocol capabilities where proved, following SingleFile/Webrecorder's browser-observation pattern without copying their licensed source.
- [ ] Localize every accessible resource. For irreducibly opaque paint, save a same-moment image fallback with provenance; expose it as an editable image/box and identify inaccessible inner text as a limit. Never count a screenshot-only fallback as arbitrary DOM editing.
- [ ] Finish captured-node operations: text and mixed media, link/image source, arbitrary safe attributes, CSS, insertion, move, remove, undo/redo, save/reopen and export, all through the existing store/command history and manifest doors. Run real Chrome gestures and visual proof; gate-commit/push by coherent behavior.

## Task 5: First-divergence repair, R7 and corpus closure

- [ ] Use the read-only marked difference PNG and saved source/export `getBoundingClientRect` boxes to find the first vertical divergence for each failing site. Group failures by shared missing data/renderer cause, then write one red→green regression per cause. Record both gains and regressions. The diagnostic never changes `comparePictures` or the score.
- [ ] Prove and fix R7: Bellroy's export at 1180 must not extend to 1770 while the live original is 1180 wide; name the actual overflowing node/selector and verify with a red→green general case and Chrome pictures. Compare also with the site's genuine 1510-wide live output at 1440.
- [ ] Re-run the unchanged full `npm run capture:corpus` on the final code. Mark PLAN-R8, STG-12.6, AUD-15 complete only if all 20 sites reach the current 100% target at every width, with saved full output and screenshots. Report any genuine browser-access limit openly; do not claim 100% general compatibility from this finite corpus.
- [ ] Run the requested final clean-tree browser suite, coverage, journeys, parity, performance enforcement, and dated audit. Gate-commit/push the final register/audit/QA row and show a gallery of every affected surface.

## Standards used

- [HTML parsing and fragment serialization](https://html.spec.whatwg.org/multipage/parsing.html): the browser DOM tree has ordered element/text nodes and serialization rules, including shadow-root limits.
- [CSS Cascading and Inheritance Level 5](https://www.w3.org/TR/css-cascade-5/): source order, origins, cascade layers and importance determine computed values.
- [Chrome extension scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) and [content-script security](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): capture capabilities depend on execution world and frame access.
