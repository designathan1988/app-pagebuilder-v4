# Importing arbitrary websites without discarding their structure

## Decision from importer research

The Builder has two different import contracts. Ordinary authored HTML can be converted into the editor's restricted element vocabulary. A captured external page must preserve arbitrary HTML, CSS and browser-observed state before the editor offers semantic controls. Treating both inputs as the same upcast destroyed valid source information.

This distinction is explicit in mature editors: [CKEditor upcast](https://ckeditor.com/docs/ckeditor5/latest/framework/deep-dive/conversion/upcast.html) converts a view into a schema-bound model, while [General HTML Support](https://ckeditor.com/docs/ckeditor5/latest/features/html/general-html-support.html) retains otherwise unsupported elements, attributes, classes and styles with more limited editing controls. [GrapesJS's parser](https://grapesjs.com/docs/guides/Custom-HTML-parser.html) represents element and text nodes before component recognition; its [parser API](https://grapesjs.com/docs/api/parser.html) separately controls scripts, event attributes and unsafe URL values. For full-page archiving, [SingleFile](https://github.com/gildas-lormeau/SingleFile/blob/master/faq.md) collects page resources, frames and fonts beyond the HTML text, and [Browsertrix](https://github.com/webrecorder/browsertrix-crawler) captures network activity through Chrome DevTools Protocol. These are architectural references; no code is copied from them.

## Builder's causal boundary map

| Boundary | Previous loss | Required invariant | Owner |
| --- | --- | --- | --- |
| Browser state → source | A wide HAR replay could omit phone resources; a second navigation could show different content. | For each width, photograph and serialize the same paused live page, record resource bytes and compare an independent live load. An unstable live pair is invalid evidence. | `tools/capture/reference.ts` |
| Source DOM → captured package | One desktop tree plus selected inline styles cannot encode added, removed or reordered phone nodes. Moving every sheet to the start changes the cascade. | Keep complete ordered DOM observations per width and keep every localized stylesheet at its original position. | `tools/companion/serialize.ts`, `capture.ts` |
| Captured package → project JSON | Closed `DocNode` types converted text-with-media to text and unwrapped custom tags. | `Page.capture` owns ordered element/text/comment nodes, namespaces and attributes. `Page.tree` has only the page settings root. Existing authored projects migrate forward. | `src/core/document/captured.ts`, `src/core/import/import.ts` |
| Project JSON → canvas/export | Residual CSS and later generated BEM rules changed layers, specificity, inline priority and presentation hints. | Both readers use the same captured tree, original author CSS and localized resource bytes; authored pages retain their separate pipeline. | `src/editor/canvas/render/captured.ts`, `src/core/render/captured.ts`, `src/core/export/export.ts` |
| Edit → saved/reopened/exported page | A visual-only copy would be faithful but uneditable. | Edits produce validated JSON patches and one undo step; an inspector-selected captured node never enters authored-node commands. Save, undo, export and re-import read the same updated tree. | `src/core/capture/edits.ts`, `src/editor/capture/selection.ts` |
| Opaque browser paint | Canvas, video frames, closed shadow trees and inaccessible frames are not in ordinary HTML serialization. | Record an accessible DOM subtree where possible; otherwise save a same-moment image fallback with provenance and expose only image/box editing. Report inaccessible inner DOM precisely. | Capture media work, still open |

## Import algorithm

1. Observe the live browser at each requested width. Save HTML DOM order, actual selected image candidates, source sheet positions, computed runtime attributes, resources and layout evidence together. Do not infer a missing width from a desktop body index.
   A response marked [`cf-mitigated: challenge`](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) is an access gate, not the requested site. The Companion refuses it and offers the user's own Chrome tab and extension as the route after verification; the automatic corpus substitutes a documented same-kind public source when the site's challenge cannot be completed in automated Chrome.
2. Parse the saved HTML in an inert browser document, reject scripts, event attributes and executable URL schemes, and encode safe nodes as JSON. Keep unknown HTML tags and SVG/MathML namespaces. [DOMParser security guidance](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString) warns that inert parsing alone does not make later insertion safe.
3. Persist the captured variants and resource bytes once. Keep CSS as authored, including inline declarations and source order; [CSS Cascade Level 5](https://www.w3.org/TR/css-cascade-5/) makes these properties observable and rules out equivalent reconstruction with later generic selectors.
4. Render the exact observed variant in the canvas and exported page. At an unobserved width, choose the nearest stored variant and label it approximate. A generated Builder bootstrap may choose a variant, but no wrapper may alter the source's child or sibling selectors.
5. Apply edits to the captured JSON, validate before committing, and retain only the selected node ID in editor view state. [React's state-structure guidance](https://react.dev/learn/choosing-the-state-structure) recommends deriving the selected object from its ID rather than storing a duplicate; the authored selection remains reserved for authored nodes.
6. Export the localized resources and snapshot package with the page. Re-import must recover the same variants and edits. The project save uses the versioned document JSON directly.

## Required closure evidence

The audit is executable: `npm run capture:audit -- <site-id>` reads saved evidence in seconds, and the completed corpus command runs it for all sites. It writes `.cache/logs/capture-import-audit.md` and `.json`, plus one `import-audit.json` beside each site's photographs. Each row names the failing boundary and DOM path, distinguishes exact from ambiguous matches, checks localized CSS/media files and reports geometric/style divergence without altering the acceptance score.

- A controlled Chrome page with text/media/text, custom elements, root class, SVG and ordered layered CSS must retain DOM order, computed styles, canvas pixels, exported pixels, edit/undo and project reopen. The mixed-media case was red before the new model and has passed after it; the complete matrix is still open.
- A controlled responsive page must add, remove, reorder and restyle nodes on fresh phone navigation and survive all four exported widths.
- Frames, video, canvas and shadow content need explicit browser evidence. A fallback's editability limit must be visible in the app, not hidden in a score.
- The unchanged 20-site corpus is accepted only after all live references are stable or an evidence-backed same-kind replacement is recorded, and all exported widths reach the user's current 100% target. R6, R7 and the corpus target remain open until this proof exists.
