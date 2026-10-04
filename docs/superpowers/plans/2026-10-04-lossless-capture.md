# Lossless Captured Pages Implementation Plan

> **For agentic workers:** Execute this plan in the current `main` checkout, one task and one gate commit at a time. DEC-11 forbids subagents, branches, and worktrees in this repository.

**Goal:** Make accessible web pages render and remain editable after capture without discarding their DOM, cascade, responsive state, or localizable resources; prove fidelity against the unchanged 20-site corpus at four widths.

**Architecture:** A captured page has a distinct, versioned document representation: an ordered DOM tree of element and text nodes with source attributes and stable identities, its original ordered style sheets, assets, and independently observed viewport snapshots. The editor applies user changes as explicit document patches to this source; canvas and export use the same renderer. Authored pages retain their present BEM document pipeline. The capture, import, render, edit, and export boundaries each have a separate proof so a visual match cannot hide missing editability.

**Tech Stack:** TypeScript, React, Chrome, Playwright, Vitest, CSS Tree, ZIP project storage; no new dependency is planned.

**Spec:** `docs/PRODUCT.md` PLAN-R8 / STG-12.6 / AUD-15; root-cause data in `.cache/logs/capture-diagnosis-2026-10-04.md` and `.cache/logs/capture-pipeline-study.json`.

## Global constraints

- User approved schema/interface changes and saved-project migration on 2026-10-04.
- Keep one document JSON source of truth. Do not hide an uneditable original HTML copy behind an editable but visually different projection.
- Preserve authored pages and migrate old saved projects forward; refuse unknown newer versions.
- Run original Chrome gestures and inspect before/after PNGs for each visible delivery.
- Keep the 20 HAR records, reference screenshots, comparator, and 98% threshold unchanged. Preserve complete command logs.
- All source text, source-order CSS, and observed responsive differences must remain traceable in saved data. Do not insert site-name branches or pixel-specific fixes.
- Scripts are inert on the editing canvas. Unsafe URLs, inline event handlers, and script execution must be handled explicitly; retaining visual markup does not authorize running third-party code in the editor.

## Findings that determine the design

1. The present importer maps HTML to closed element types, turns mixed content into text runs, unwraps unknown tags, and drops visual descendants such as Typewolf's `<p><a><img>`. It cannot encode the source DOM without loss.
2. It partitions source CSS into a generated later sheet plus a residual sheet. CSS cascade layers, `!important`, specificity, inline declarations, conditional rules and inherited custom properties are order dependent. A broad attempt to wrap all original CSS in a layer passed a toy fixture but did not improve selected real sites, so CSS provenance and edit origin must be modeled, not guessed from property names.
3. A single wide DOM cannot describe four freshly navigated viewport states. Allbirds has different phone content/order; W3C menu state differs. Stable identity matching must report additions, removals, and moves rather than silently reusing the desktop tree.
4. The Companion copy itself is below 98% at every width on 11 sites, while 18 sites lose fidelity during conversion. The two boundaries need separate exit gates. A repeated W3C run changed under identical HAR/commit, so deterministic readiness and state sampling need proof.

## File ownership and interfaces

- `src/core/document/captured.ts` owns `CapturedNode` (`element` with namespace, tag, ordered attributes and children; `text` with literal value), `CapturedViewport`, `CapturedSheet`, and stable node IDs. A captured page variant owns this data; an authored page owns `DocNode`. No rendered DOM or parallel projected `DocNode` is stored.
- `src/core/document/model.ts`, `migrations.ts`, `validate.ts` own the page union, version 3 migration, and invariant checks. Migration 2→3 wraps existing pages as authored without changing any tree/style data.
- `tools/companion/serialize.ts` and capture assembly own browser-observed DOM/style/resource snapshots at 1440, 1180, 834, and 390. Every output names its viewport and capture provenance.
- `src/core/import/captured.ts` reads the Companion package directly into `CapturedNode` data, preserves mixed content and unsupported elements, and rewrites only local asset addresses. `src/core/import/import.ts` remains the owner of ordinary HTML import and its report.
- `src/core/render/captured.ts` owns safe DOM creation in the canvas; `src/core/export/captured.ts` owns deterministic HTML/CSS output from the same data. Shared pure helpers own URL rewriting, escaping, and applying viewport variants.
- `src/core/capture/edits.ts` owns typed patches to captured nodes (text, attributes, element order/structure, and style overrides); commands use the existing store/undo history. Inspector and Layers expose those commands through the manifest.
- `manifest/`, `spec/BEHAVIOUR.md`, `docs/PRODUCT.md`, and `docs/QA-LOG.md` register each changed behavior and its proof. Generated inventory is regenerated by the gate.

## Review focus

- Text before, between, and after media in a paragraph or caption remains ordered and editable.
- A custom element, SVG namespace, `<picture>`, and slotted open shadow content retain visible children and safe attributes.
- A site `!important` rule, layered/unlayered rules, inline values, `@supports`, and root variables compute as in the copied page until a user edits the property; an edit has defined precedence and survives undo/reopen/export.
- Fresh viewport navigation can add, remove, reorder, and change text/attributes on elements. Variant identity conflicts must fail visibly, not apply a patch to the wrong node.
- Every referenced resource is either localized with the exact observed bytes or reported missing/blocked; no silent remote substitution is considered a fidelity pass.

## Task 1: Capture boundary invariants

- [ ] Add controlled Chrome fixtures for ordered mixed DOM, custom elements/open shadow roots, SVG, source cascade, and fresh width-dependent DOM. Save source and Companion-copy screenshots at four widths.
- [ ] Run the fixtures before modification and record specific failing assertions and PNGs. Compute original→copy with the unchanged comparator.
- [ ] Change Companion serialization and resource assembly to preserve observable structure, order, namespaces, root attributes, and per-width values. Record inaccessible closed shadow/cross-origin frame/canvas content as opaque capture limits rather than inventing editable descendants.
- [ ] Re-run the fixtures and the 20-site original→copy study. Require every controlled case to pass and no measured corpus regression without a diagnosed reason. Record unresolved resource requests by cause.
- [ ] Update manifest/spec/PRODUCT/QA-LOG and gate-commit/push. Show old/new Chrome pictures.

## Task 2: Lossless captured document and migration

- [ ] Write red validation/migration tests: arbitrary nested tags, mixed text/media, preserved attribute order/namespace, malicious event attributes rejected, version-1 and version-2 authored pages unchanged after migration and reopen.
- [ ] Add the page union and captured tree types. Add version 2→3 migration; update typed current-version fixtures without changing behavior expectations.
- [ ] Import a Companion page into the captured variant and round-trip its JSON without converting to text-only/BEM nodes. Do not alter ordinary HTML-import behavior.
- [ ] Prove validation, save/reload, rejection of malformed/unsafe data, then gate-commit/push with contract and QA row.

## Task 3: Source-faithful canvas and export

- [ ] Add failing Chrome tests for mixed content, unknown tags, SVG internals, root classes, source stylesheet order, responsive conditions, and image selection at the four widths; compare source copy, canvas and export computed style/geometry.
- [ ] Render the captured tree by creating DOM nodes safely; export the same ordered DOM and CSS through pure shared helpers. Preserve the captured author cascade unchanged for an unedited page. Keep the editor's neutral chrome styles scoped away from it.
- [ ] Make breakpoint snapshots select by documented width intervals, with stable IDs and full change sets for added/removed/reordered nodes. Assert no interpolation invents content between sampled widths.
- [ ] Check the nine sites whose copy already exceeds 98% at all widths; require copy→export to improve without taking the completed Grid by Example site below 98%. Gate-commit/push with pictures and scores.

## Task 4: Editing a captured page

- [ ] Write red real-gesture tests for selecting an arbitrary captured node in Layers/canvas; editing text, link, image source, attributes and CSS; moving/removing/adding an element; undo/redo; save/reopen; and exported result at each width.
- [ ] Wire these actions to typed captured-node patches through the existing dispatch/store, with explicit source/override style precedence. Text edit must preserve adjacent media nodes and unrelated viewport variants.
- [ ] Validate security and edit behavior on controlled mixed DOM and source cascade fixtures. Gate-commit/push with old/new/undo pictures.

## Task 5: Full corpus closure

- [ ] Run original→copy and copy→export diagnostics at four widths for every site. Classify each remaining difference into source state, inaccessible content/resource, captured data, renderer, or nondeterministic sample. Address the class of problem, not the site's name.
- [ ] Re-run the unchanged full `npm run capture:corpus` on the final code. Mark PLAN-R8, STG-12.6, AUD-15 complete only if all 20 sites reach 98% at every width, with saved full output and screenshots. Report any genuine browser-access limit openly; do not claim 100% general compatibility from this finite corpus.
- [ ] Run the requested final clean-tree browser suite, coverage, journeys, parity, performance enforcement, and dated audit. Gate-commit/push the final register/audit/QA row and show a gallery of every affected surface.

## Standards used

- [HTML parsing and fragment serialization](https://html.spec.whatwg.org/multipage/parsing.html): the browser DOM tree has ordered element/text nodes and serialization rules, including shadow-root limits.
- [CSS Cascading and Inheritance Level 5](https://www.w3.org/TR/css-cascade-5/): source order, origins, cascade layers and importance determine computed values.
- [Chrome extension scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) and [content-script security](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): capture capabilities depend on execution world and frame access.
