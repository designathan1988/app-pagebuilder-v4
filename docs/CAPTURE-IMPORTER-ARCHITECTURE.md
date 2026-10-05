# Importing a website: research, defects and the design (2026-10-04)

The importer turns a page a person opens (File › Open a web address…, or the Builder Capture extension in their own
tab) into a page of the project: drawn on the canvas as the site draws it, editable, saved in the document JSON and
exported as a real page. This document is its contract. It replaces the version of the same date that described the
per-width snapshot design; the research below found that design wrong at its core (DEC-61).

## What the research found

| Question | What mature tools and the specifications do | Sources |
| --- | --- | --- |
| How does a page travel from the browser? | As a tree of nodes, never as HTML text: a DOM built by scripts may not survive "serialize, then parse again" (a `<div>` a script put in `<head>` sends every later head element into `<body>`). rrweb gives each node an id and records element, text and comment nodes with their attributes. | [HTML Standard, parsing and serialization](https://html.spec.whatwg.org/multipage/parsing.html); [rrweb serialization](https://github.com/rrweb-io/rrweb/blob/master/docs/serialization.md) |
| How are the styles read? | From the CSSOM (`sheet.cssRules`), because CSS-in-JS libraries insert their rules with `insertRule` and leave the `<style>` element's text empty; a cross-origin sheet the CSSOM will not show is fetched by its address. A document's `adoptedStyleSheets` come after its own sheets. | rrweb `stringifyStylesheet` ([source](https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb-snapshot/src/utils.ts)); [styled-components speedy mode](https://github.com/styled-components/styled-components/issues/1603); [CSSOM, document or shadow root CSS style sheets](https://drafts.csswg.org/cssom/#documentorshadowroot-document-or-shadow-root-css-style-sheets) |
| What runtime state does a faithful copy keep? | Form values, checked and selected states, the scroll position of every scrolled box, canvas pixels, the image `srcset` chose; scripts are removed so the copy cannot change itself. | rrweb `snapshot.ts` (`rr_scrollLeft`, `value`, `rr_dataURL`); [SingleFile](https://github.com/gildas-lormeau/SingleFile); [freeze-dry](https://github.com/WebMemex/freeze-dry); [DevTools Protocol `DOMSnapshot.captureSnapshot`](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/) (`currentSourceURL`, `inputValue`, `inputChecked`) |
| Shadow DOM? | Kept as shadow DOM (rrweb rebuilds it with `attachShadow`); a static page carries it as declarative shadow DOM, `<template shadowrootmode="open">`, with no script. Flattening it and rewriting `:host` selectors changes what the rules match. | [MDN, `<template shadowrootmode>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template) |
| Several widths? | Builder.io's Copy Layout resizes the browser to capture the layout at several sizes and keeps one block per element with styles per size (`responsiveStyles`). | [Builder.io Chrome extension](https://www.builder.io/c/docs/chrome-extension); [Builder.io Write API](https://www.builder.io/c/docs/write-api) |
| Convert to the editor's own elements from computed styles? | That is what design tools do (getComputedStyle, getBoundingClientRect, text ranges into layers); Builder.io states 80–90 % accuracy, below this project's 98 % target, so the source DOM and CSS are kept and edited in place, as CKEditor's General HTML Support keeps what its model does not know. | [Builder.io, HTML to design](https://www.builder.io/blog/html-to-design); [CKEditor General HTML Support](https://ckeditor.com/docs/ckeditor5/latest/features/html/general-html-support.html) |
| Time in a recorded page | Playwright's `setFixedTime` freezes `Date` only; timers keep running, so a script that measures elapsed time with `Date.now()` never finishes (allbirds' hero stayed at opacity 0). `clock.install({ time })` starts the clock at a fixed moment and lets it run. | [Playwright clock](https://playwright.dev/docs/clock) |

## What was wrong (the design of 2026-10-04 morning)

| # | Defect | Where | Evidence |
| --- | --- | --- | --- |
| 1 | The page travelled as HTML text and was parsed again. | `tools/companion/serialize.ts` (`outerHTML`), `src/editor/browser-ports.ts` (`capturedTree`) | allbirds: the project's body held 597 head nodes before its content (`.cache/logs/r7-1004/audit-all-final.json`) |
| 2 | Each width was a separate tree with its own ids; an edit changed one width only. | `src/core/import/import.ts` (`pageFrom`), `src/core/capture/edits.ts` (`findCaptured`) | the spec said so ("independent across widths") |
| 3 | The export held every width's copy and chose one with `document.write` at load: blank without scripts, unchanged when the window is resized. | `src/core/render/captured.ts` (`capturedResponsiveHtml`) | the code |
| 4 | Styles were read from `<style>` text: rules a script inserted were lost; `document.adoptedStyleSheets` were never read. | `serialize.ts` | the code; styled-components' production mode |
| 5 | Shadow DOM was flattened and its rules rescoped by rewriting selectors. | `serialize.ts`, `tools/companion/capture.ts` (`scopeCss`) | the code |
| 6 | Scroll positions and form values were not kept. | `serialize.ts` | the code (cloneNode copies attributes, not state) |
| 7 | The corpus recorder froze `Date`, so time-driven entrances never ran in the reference or the capture. | `tools/capture/reference.ts` (`setFixedTime`) | `.cache/logs/r6-1004/allbirds-probe.txt` |

Kept, because they are sound: resource fetching and localization (`siteBuilder`), the `srcset` grammar, the canvas and
video paint fallbacks, the safety rules for elements and attributes (`unsafeCapturedElement`,
`unsafeCapturedAttribute`), HAR replay for the corpus, captured-node selection and the inspector.

## The design

### 1. Observe (in the page)

`serializePage` (shared by the Companion and the extension) returns the page as a tree of nodes:

- element `{ kind, key, namespace, tag, attributes, children, shadow?, state? }`, text and comment `{ kind, key, value }`;
  `key` comes from a per-page `WeakMap`, so a node keeps its key across observations of the same page;
- a `<link rel=stylesheet>` or `<style>` stays at its place in the tree, naming its entry in `sheets`: a style
  element's text is read from its CSSOM when the page lets it be read, else from its text; a link is fetched by its
  address; `document.adoptedStyleSheets` follow the document's sheets; a shadow root's adopted sheets are its own;
- an open shadow root is kept: `shadow: { mode, children, adopted }`;
- `state`: an input's value and checked state, an option's selection, a textarea's value, a scrolled box's offsets;
- left out: scripts, `<noscript>`, resource hints (`preload`, `modulepreload`, `prefetch`, `preconnect`,
  `dns-prefetch`), the capture's own style.

### 2. Package (the Companion)

Resources are localized on the tree's attribute values, never by replacing text in markup. The package
`<page>.capture.json` is format 2: `{ format: 2, widths, root, resourceProblems? }`, `root` being the merged tree.

### 3. Merge (pure, `src/core/capture/merge.ts`)

Each width is a fresh navigation (what a person sees when they open the site at that width). The widths are reconciled
into one tree, widest first: two element siblings correspond when tag, namespace and id agree and their classes match
best (a longest common subsequence over each child list, then a second pass by tag alone inside the gaps); text and
comments correspond by position inside a matched parent. A node another width lacks is absent there; a node only one
width has is present there only; an attribute or text that differs keeps its value per width. Every width draws
exactly the nodes, attributes and text of its own observation.

### 4. Document (`Page.capture`, document format 4)

`{ widths, root, resourceProblems? }`: one tree. A node may carry `at: { [width]: { absent?, attributes?, value? } }`.
Format 3 pages migrate by keeping their widest snapshot (the other snapshots had no node identity to merge by); a
format 1 capture package imports the same way.

### 5. Canvas and export

`capturedAt(capture, width)` projects the tree at the observed width nearest the canvas's (stated as approximate between
widths). The export writes the widest projection as static HTML (no script needed to see the page), shadow roots as
declarative shadow DOM, and a Builder-owned script that applies the other widths' nodes, attributes and text when the
window matches them, on load and on resize. Every written page parses back to the tree it came from: an element the
HTML parser would move out of `<head>` is not written there (a head is never drawn), a `<pre>`, `<textarea>` or
`<listing>` whose text starts with a newline takes one more, and an element whose children the parser would rebuild
(a block in a `<p>`, an `<a>` in an `<a>`, a table part out of its place or with what it may not hold, an inner
`<form>`, a list item or heading straight in another, HTML in SVG; `parserRebuilt`, checked against parse5 on
random pages) has its children, and its parent's, set from the tree by the width script.

### 6. Edit

An edit applies to the node at every width: the per-width values of what it changes are dropped. Delete, insert and
move act on the one tree.

## Proof

- Unit: the observation of a page with a script-built head, inserted rules, adopted sheets, an open shadow root,
  scrolled boxes and form values; the merge of widths with added, removed, reordered and restyled nodes; the projection
  and the export parsing back to the same tree; an edit seen at every width.
- Browser: a controlled page captured by the Companion and exported, at four widths, before and after a resize.
- Corpus: `npm run capture:corpus` after the recorder's clock is fixed, with the audit at every boundary.
