# Behaviour specs

The behaviour a feature must show, written before its scenarios (manifest/features/*.json) and kept
beside them: one section per spec, anchored by its id, so a manifest entry points at a section of this file
instead of at a file of its own. Every section keeps the spec's parts: the behaviour, the files and lines
of the old application it was read from, and its "Problems in Pager" corrections, which are requirements.

## absolute-anchors

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test: an absolutely positioned Heading (`left: 122px; top: 130px`), selected, canvas focused.

### Trigger

- `Alt+Shift+ArrowLeft/Right/Up/Down` toggles the anchor on that edge, when exactly one positioned (absolute/fixed) child is selected and not locked or hidden (`src/features/input/index.js:708-713`, `boxChildSelected` `src/features/resize/index.js:62-65`).
- Four round **anchor tabs** on the selection outline: a click (press and release on the same tab) toggles that edge (`resize/index.js:351-358`).
- Command-bar commands `Anchor horizontally to the centre` / `vertically to the centre` (`resize/index.js:395-400`); they have no key and no tab.

### Hit zones and thresholds

- Tabs are 14 × 14 px circles centred just outside the middle of each edge (observed positions for a 100 × 19 px element: left at x−26, right at x+112, top above, bottom below), shown only for a positioned child (`resize/index.js:379-385`).
- Toggling never moves the element: the current box is measured and re-expressed with the new anchors (`resize/index.js:254-276`, `nwPlaceBox`).
- Horizontal anchors: left, right, both (left + right, width `auto`), centre. Vertical: top, bottom, both, centre.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Positioned child selected | Four tabs; filled = anchored (left and top by default), hollow = free. The top tab sits under the selection chip. | ![tabs](img/absolute-anchors--01-anchor-tabs.png) |
| After Alt+Shift+ArrowRight and Alt+Shift+ArrowDown | All four tabs filled; status `Anchored left and right · top and bottom.` | ![both](img/absolute-anchors--02-right-bottom.png) |

### Result in the document

Observed writes:

| Key | Styles written |
|---|---|
| Alt+Shift+ArrowRight | `left: 122px; right: 1218px; width: auto; height: 19px; bottom: auto; translate: none` — status `Anchored left and right · top.` |
| Alt+Shift+ArrowDown | adds `bottom: 491px; height: auto` — status `Anchored left and right · top and bottom.` |

The element's measured box did not change (446, 218, 100 × 19 px before and after). Anchoring the centre stores `left: 50%` with a `translate` (`src/model/position.js`, `boxPlacement`).

### Undo and redo

Each toggle is one history entry.

### Nested elements

The distances are measured from the containing block (see `absolute-free-drag.md`: in Pager this is the page when the parent was never made relative, which is why `right: 1218px` was computed against the 1440 px page).

### Zoom other than 100 %

Values are CSS px; tabs keep their screen size.

### Keyboard equivalent

`Alt+Shift+Arrow` is the keyboard door; centre anchors are only in the command bar.

### Problems in Pager

1. **Anchor distances are computed against the page** when the parent is static (see `absolute-free-drag.md` problem 1), so "anchored right" means "right of the page". Required: anchors are relative to the parent, which rule 1 of `absolute-free-drag.md` makes the containing block; after resizing the parent the element keeps its distances to the anchored edges (manifest feature `absolute-anchors`).
2. **Centre anchors have no key and no tab.** Required: the Inspector's anchor control offers left / centre / right / both and top / centre / bottom / both, running the same command as the keys (manifest intent: "Use the anchor control in the inspector to anchor horizontally to the centre").
3. **The top tab is hidden under the selection chip.** Required: anchor tabs are never covered by other canvas chrome.
4. **`height: 19px` is frozen when anchoring left and right,** turning an auto-height text box into a fixed height. Required: toggling a horizontal anchor never changes the vertical size mode, and vice versa.
5. **A tab said nothing of its state to assistive technology** (the audit's U-051: "Anchor left" on an element anchored left by default answered "anchored right · top", with no pressed state to warn). Required: each tab is a toggle that says whether its edge is anchored (`aria-pressed`, the filled tab), the start edges of an element that holds no inset reading as anchored.
6. **Toggling could change the element after all** (the audit's AUD-35: a one-line paragraph 232.45 px wide, anchored
   on both edges, got two insets rounded apart, 0.42 px too close, and its text wrapped to two lines). Required: the
   insets and sizes written are whole px and never leave the box smaller than it is drawn: on both edges the start inset
   is rounded and the end inset is what the drawn distances leave, rounded down; a size an edge takes back is rounded
   up. The canvas measures exactly (fractions kept) and each writer rounds.

## absolute-free-drag

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: Section (`padding: 56px 40px; height: 400px`, position static) > [Heading, Paragraph].

### Trigger

- Make the element absolute: Inspector → Layout → Position → **absolute** (or `position` in any property door).
- Drag the element like any element (press, 4 px threshold, release; `src/app/boot.js:449-516`). When every dragged node is absolutely or fixed positioned and the pointer is inside its parent's padding box (or inside the element's containing block while only climbing out of the parent), the proposal is a **free position** instead of a flow insertion (`src/features/drag/drag.js:475-484`, `canvasProp` `:679-708`).
- Ctrl during the drag duplicates and suspends snapping (`drag.js:307-311`); `Escape` cancels.

### Hit zones and thresholds

- The element keeps the grab offset: the pointer stays at the same point of the box during the drag (`drag.js:917-918`, `:685`).
- The box is clamped inside its containing block (`src/platform/box-geometry.js:100-106`, `boxMove`).
- Coordinates are measured from the **containing block's padding edge** (the nearest positioned ancestor, or the page when there is none; `src/platform/measure.js:270-286`) and rounded to whole CSS px (`drag.js:694`).
- With Snap on, edges and centres snap within the snap distance to targets (see `snap-while-moving.md`); Ctrl suspends (`drag.js:689`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Heading after clicking "absolute" | Only `position: absolute` is written; the Heading shrinks to its content width (99.7 px) and stays where the static layout put it; the Section stays `position: static`. | ![absolute](img/absolute-free-drag--01-absolute-selected.png) |
| Dragging 60 px right, 40 px down | The element itself moves live under the pointer (temporary `translate`, `drag.js:896-911`); the receiver (Section) is tinted; dashed alignment lines appear only when a snap engaged; distance markers show the gap to the nearest thing above (`96px`) and to the left (`124px`) (`src/platform/overlay.js:250-259`); the label chip reads `Free position · Section · x:124 y:120`; the status bar reads `Coordinates (124, 120)`, read-out "Absolute child of Section; overlap allowed, alignment guides active." | ![dragging](img/absolute-free-drag--02-dragging.png) |
| Released | Status `✓ Free position · Section · x:124 y:120`. | ![dropped](img/absolute-free-drag--03-dropped.png) |

### Result in the document

- Release writes `left` and `top` in px (and keeps `right`/`bottom` constraints consistent when they are set; `measure.js:291-306`) on the active breakpoint/state layer. Observed: `position: absolute; left: 124px; top: 120px`.
- The measured offset relative to the **Section** was 100 × 96 px; the stored 124 × 120 px are relative to the **page body**, because the Section was never made `position: relative` (observed: the Heading's `offsetParent` is `BODY`).
- Dragging past the parent's edge keeps the free proposal while the pointer is inside the containing block (`drag.js:477-484`); it does not reparent (observed: 60 px below the Section the proposal was still `Free position · Section · x:124 y:474`).

### Undo and redo

The drop is one history entry: Ctrl+Z removed `left`/`top` (back to `position: absolute` only).

### Nested elements

The containing block decides the coordinates; the label always names the DOM parent.

### Zoom other than 100 %

Coordinates are screen movement ÷ zoom (`drag.js:681`, `:694`).

### Keyboard equivalent

Arrow-key nudges (see `absolute-nudge.md`).

### Problems in Pager

1. **Making a child absolute does not make its static parent `position: relative` and does not store its current position.** The element jumps to its content width and later coordinates are relative to the page, not the parent. Required: setting `absolute` on a child of a static parent sets the parent to `position: relative` and writes `top`/`left` computed from the child's old place, so it does not move visually (manifest feature `absolute-free-drag`); both writes are one undo step.
2. **The label says `Section` while the numbers are page coordinates.** Required: the label and the status bar show coordinates relative to the element's containing block, which is its parent after rule 1.
3. **Ctrl duplicates while dragging** (the ghost reads `Copy of …`) and also turns snapping off. Required: the modifiers come from the one declaration in `manifest/interactions.json` (the `free-drag` gesture): holding **Ctrl** suspends snapping for that gesture, as it does while resizing (`snap-while-moving`), and Ctrl never duplicates; duplication-by-drag, if it is ever added, uses a modifier that is not a snap switch.

## absolute-nudge

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test: an absolutely positioned Heading at `left: 124px; top: 120px`, selected, canvas focused.

### Trigger

- ArrowLeft/Right/Up/Down without Alt, with the canvas focused, when every selected element is absolutely or fixed positioned in the same parent and none is locked or hidden (`src/features/input/index.js:719-726`, `boxNudgeArmed` `src/features/resize/index.js:67-72`). Otherwise the arrows walk the tree (see `keyboard-tree-walk.md`).
- Shift multiplies the step.

### Hit zones and thresholds

- Step: **1 px**, Shift **10 px** (`BOX_NUDGE_PX`, `BOX_NUDGE_SHIFT_PX`, `src/platform/box-geometry.js:6-7`), in CSS px regardless of zoom.
- The box is clamped inside its containing block (`box-geometry.js:237-239`).
- Several selected positioned siblings move together (`resize/index.js:284-312`).

### Visual feedback

The element moves at once; the selection outline follows; status `Moved to 125, 120.` (observed, single element); for several elements the message is `Moved 2 elements by 1, 0.` (`canvas.positioning.nudgedMany`, `resize/index.js:310`).

### Result in the document

Observed from `left: 124px; top: 120px`:

| Key | left, top |
|---|---|
| ArrowRight | 125px, 120px |
| Shift+ArrowDown | 125px, 130px |
| ArrowLeft ×3 (quickly) | 122px, 130px |

Only `left`/`top` (or `right`/`bottom` when those are the set constraints) are rewritten, on the active layer (`resize/index.js:278-282`, `src/platform/measure.js:291-306`).

### Undo and redo

**Every key press is its own history entry:** after the three quick ArrowLeft presses, one Ctrl+Z went back to `left: 123px`, a second to `124px` (observed).

### Nested elements

Only the selected positioned elements; their children move with them.

### Zoom other than 100 %

The step is in CSS px; on screen it is step × zoom.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **A burst of nudges is many undo steps.** Required: arrow presses in a quick burst on the same selection, with no other command in between, are one undo step (manifest feature `absolute-nudge`); the burst window is a named constant in the history owner.

## accessibility-checks

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no checks panel.** Its i18n catalogue holds the texts of a "Design review" panel (`panel.aesthetics.title`, `src/core/i18n.js:571`) with rules such as colour contrast (`panel.aesthetics.rule.colorContrastText`, `:2469`), and an icon is registered for it (`src/platform/icons.js:183`), but no panel is registered (the only `registerPanel` calls are `layers`, `palette`, `readout`, `inspector` and `provenance`), so nothing lists issues at runtime (observed: Ctrl+K `open` offers no such panel).

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

None in Pager.

### Undo and redo

Not applicable: checks never change the document.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable: the panel is outside the canvas.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No accessibility or structure checks.** Required (manifest feature `accessibility-checks`):
   - The Checks panel lists each issue (for example an image without alt, a skipped heading level, low-contrast text, a link without text) with its rule, the element and a suggested fix.
   - Clicking an issue selects the element on the canvas and in Layers.
   - The list updates after every command.
   - Checks never block editing or export.
2. **An issue's row was a button centred in a 28 px box** (the audit's U-037). Required: an issue's row (the door that selects its element) is laid out from its start, as tall as what it says, its words wrapping.
3. **An image with no source vanished from the exported site without a word** (the journey "site", 2026-10-01: the Card template's image showed its 800 × 300 placeholder on the canvas and nothing in the export, the card 130 px shorter). The placeholder stays an editor-only aid (spec export-zip, Problems 8). Required: an image with no source is an issue of the Export category, "Image without a source in {name}: the exported page shows nothing in its place", its fix "Choose its Source in Settings". An element's issues share its row, one under the other, so each row is the one door that selects its element (an image with no alt and no source is one row).
4. **A form a visitor could not send was exported without a word** (the audit's AUD-22, 2026-10-02: the `motion` fixture's form held one field and no button, an html-validate error, WCAG technique H32). Required: a form with no submit control (a button whose Button type is submit or says nothing, which the export writes as submit; a submit or image input) is an issue of the Accessibility category on the form, "Form without a submit button in {name}", its fix "Add a button inside it, or set a button's Button type to submit". Every fixture's export passes html-validate's recommended rules, but for an error Checks reports on the same element with the same rule (`src/core/export/validity.test.ts`).
5. **The checks named a fix and made none** (the plan's stage 6 asked for automatic fixes; the helper that wrote a page's language and a button's type went in `89cefa2` and nothing came in its place: the audit's AUD-16). Required: an issue whose rule has a fix (manifest/checks.json `fixes`) draws its door of `checks.applyFix` under its row, with the element and the rule (`src/editor/checks/fix.ts`), and the fix is made by the owner of what it changes: a form with no submit button takes a button at its end (element.insert, its placement, lock and content-model rules; the export writes it as the form's submit), "Add a submit button"; a heading that skips a level takes the level after the heading before it (element.setTag), "Use the next level"; an image with no Alt, an image with no Source, a frame with no Title and a link with no address select the element and open that field in Settings with the focus in it (inspector.reveal), "Write the Alt text", "Choose the Source", "Write the Title", "Choose the address". A fixed issue leaves the list; an issue the document no longer has is refused as stale. A page's language, a button's type and an input's type are no issues: the export always writes them (spec export-clean), so nothing is left to fix there; the contrast has no automatic fix (the colours are the person's to choose).

## align-distribute

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no align or distribute command.** Its i18n catalogue still holds the labels (`free.action.alignLeft`, `free.action.alignCenterX`, `free.action.distributeH`…, `src/core/i18n.js:2183-2190`), but no code uses them: no command, menu row, quick-panel control or key runs an alignment.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

None in Pager.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No alignment of positioned elements.** Required (manifest feature `align-distribute`):
   - With several absolutely positioned elements selected, Align left, Align centre and Align top (and the other edges) work on the selection's bounds; with one element selected, on its parent's box.
   - Distribute horizontally makes the gaps between the selected elements equal.
   - The commands are in the quick panel and the Arrange menu; top and left are written for each element as one undo step, and the measured positions in the iframe match.
2. **Distribute looked available with one or two elements and borrowed Align's reason** (the user's real-use audit, A3.23: "Align left: 1 elements." and a disabled Distribute saying "Align works on…"). Required: Distribute is available only for three positioned elements or more (predicate distributableSelection); disabled, it says its own reason: status.distribute.needsPositioned for elements that are not positioned, status.distribute.needsThree for fewer than three; the messages name their count with its plural ("1 element", "3 elements").

## app-menu

Jornada 03 correction: the shared [nonmodal layer contract](#nonmodal-layers-j8) supersedes the legacy shielding behavior described below.

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Click the logo button (`#appBtn`): the app menu opens with **File, Edit, Arrange, View, Help, Theme**, each opening a submenu to its right (`src/features/workspace/dock.js:298-364`, `:375-387`).
- In this editor's top bar, a single click on a neighbouring application menu replaces the one already open; the backdrop still closes it when pressed elsewhere.
- Keyboard (`dock.js:318-340`, `:352-363`): Enter or ArrowDown on the logo button opens the menu with focus on its first enabled item; ArrowDown/ArrowUp move (wrapping), Home/End jump; Enter on a row that opens a submenu opens it with focus on its first item; `Escape` closes every open menu and returns focus to the logo button (observed). A click outside closes.
- Menu rows run commands (`dock.js:446-493`): rows bound to key rows call `runKey`; Duplicate, Copy and Paste **dispatch a synthetic keydown** (`:474-479`).

### Hit zones and thresholds

- Submenus open at the right of the app menu, clamped to the window (`dock.js:311-317`).
- Rows marked `data-needs-selection` are disabled when nothing is selected (`dock.js:495-506`), with the title `Select an element first.`

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| App menu open | Six rows: File, Edit, Arrange, View, Help, Theme. | ![app menu](img/app-menu--01-app-menu.png) |
| Edit submenu | Each row shows its shortcut on the right. | ![edit](img/app-menu--02-edit-submenu.png) |

Observed contents:

| Menu | Rows (shortcut) |
|---|---|
| File | Save project (JSON), Open project (JSON), Export page (HTML), New blank page, Commands (Ctrl+K) (`index.html:37-50`) |
| Edit | Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), Duplicate (Ctrl+D), Copy (Ctrl+C), Paste (Ctrl+V), Delete (Del), Clear the selection (Esc), Why is it laid out like this? (?) |
| Arrange | Move up (Alt+↑), Move down (Alt+↓), Wrap in a row (R), Wrap in a column (C), Promote out of the parent (P), Take into the hand (M), Rename (F2) — all disabled with nothing selected |
| View | Elements, Layers, Properties, Inspector, Engine read-out, Guides & Grids (checkable), Elements / Layers (Ctrl+B), Inspector (Ctrl+Alt+B), Developer tools, Reset workspace |
| Help | a list of shortcuts (Undo, Redo, Duplicate, Delete, walk keys, Edit the text, Move up, R, C, P, M, ?) as runnable rows |
| Theme | Light, Dark, System |

### Result in the document

Each row produces the same document JSON as its shortcut (same code path, or a synthetic key event).

### Undo and redo

As for the underlying commands.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

As described in Trigger.

### Problems in Pager

1. **Rows are missing:** File lacks Open folder and Import HTML; Edit lacks Cut and Select all in container; Arrange lacks Remove wrapper and Make child of previous layer; View lacks Explorer, Code, Timeline, Workbench, Canvas tools, Collapse every dock (Ctrl+\) and Developer tools as described; Help lacks a Keyboard shortcuts row; there is no Language submenu. Required: the rows listed in manifest feature `app-menu`, in that order; rows whose feature is not built yet are disabled and labelled "not available yet", read from the one feature registry.
5. **Edit has "Why is it laid out like this?" and View has "Engine read-out",** doors to Pager's engine read-out. Required: neither row exists; the new app has no layout read-out.
2. **Menu rows dispatch fake keyboard events** for Duplicate, Copy and Paste. Required: every row calls its command directly (the same command its shortcut calls).
3. **Help is a list of runnable shortcuts** rather than a door to the shortcuts panel. Required: Help → Keyboard shortcuts opens the shortcuts panel (see `shortcuts-panel.md`).
4. **Disabled rows give no reason other than a generic title.** Required: a disabled row's tooltip says why (`Select an element first`, `Needs a single selection`, `not available yet`).
6. **The menu bar could not be walked from the keyboard** (the audit's U-033: no Left/Right between menus, no keys into a submenu). Required: F10 opens the first menu (File), its first item focused; in a menu ArrowRight opens the next menu and ArrowLeft the previous one, in a ring (`focus.menuBar`, `focus.nextMenu`, `focus.previousMenu`); on an item that leads to a submenu ArrowRight opens it with its first item focused, and inside a submenu ArrowLeft closes it, the focus back on its item.
- **Each application menu wanted its own click** (the dogfooding pass, 2026-09-30). Required: while an application menu is open, the pointer moving onto another menu's button in the top bar opens that menu instead, as a desktop menu bar does; with no menu open, hovering a button opens nothing.
- A menu the pointer opened on its way to its button stays open under the click that follows (the person moved there to click it); a click on a menu a click opened closes it, as before.
- **The pointer crossing another menu's button on its way into the open menu switched menus** (the journey "site", 2026-10-01: File open, the pointer going down-right to Save project passed over Edit, Edit opened, and the click landed on Undo: the last change was undone and nothing was saved). Required: the switch waits until the pointer rests on the other button for `menus.hoverSwitch` (interactions.json); leaving it sooner switches nothing, so a pointer crossing a button on its way to an item clicks that item. Movement farther than `menus.hoverTolerance` from the last resting point restarts that wait, including inside the same button: a slow continuous crossing must not switch. Movement within that tolerance counts as pointer jitter and does not restart the wait.

## autosave-corruption-recovery

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager. The versions are those of `autosave-crash-recovery.md`.

### Trigger

- Pager: when the saved record cannot be read, it opens the newest previous version that can, on its own (`src/features/documents/index.js:124-129`); when none can, it blocks saving, keeps the bad bytes and shows "Recovery required" with a toast (`:208-213`).

### Our rule

- At start, a saved record the project reader refuses (it cannot be read, or the model refuses it) is **left untouched** in storage. The editor opens the empty project, the status bar reads **Recovery required** (`status.save.recoveryRequired`), and the **recovery dialog** opens, listing the earlier versions IndexedDB keeps, the newest first, each with the time it was saved and its **Restore** button (`project.restoreVersion`, the version by its revision). With no version, the dialog says there is none.
- **Restore** loads exactly that version's document (read through the project reader every open uses), the selection and the history empty, the status bar saying so (`status.save.restored`); autosave then writes it, and it becomes the current record.
- Until a version is restored, or another project replaces the document (File › Open, File › New blank page), autosave writes nothing, so the corrupted record stays as it was. Closing the dialog changes nothing of that.

### Refusals

- A version the project reader refuses is refused naming why (`status.open.invalidArchive`), and nothing changes.

### Problems in Pager

1. **Pager picks a previous version on its own,** without saying which or letting the person choose. Required: the dialog lists the versions with their times, and the person restores one.
2. **"Recovery required" offers nothing to act on** but a reload. Required: the dialog and its Restore buttons.

### Undo and redo

Not undoable: restoring replaces the document, the history starting empty, as File › Open does.

## autosave-crash-recovery

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager. Our autosave is `autosave-restore.md` and `unsaved-work-guard.md`.

### Trigger

- Pager keeps, with each saved record, the payloads it replaced: the five previous versions (`src/features/documents/index.js:100-110`, `previous … .slice(0, 5)`), with their save times.
- At start it opens the current record, or, when that cannot be read, the newest previous one that can (`:124-129`), and says the work was recovered (`toast(t("panel.documents.recovered"))`, `:206`).

### Our rule

- Every write IndexedDB holds is also kept as a **version**: the document, the selection and the time it was saved. The **last 10 versions** are kept, the oldest dropped first (`autosave.versions`).
- A **crash** is a session that ended before IndexedDB held its last change: the journal left in localStorage holds a newer revision than IndexedDB's record. At the next start the journal's work is restored (it is the last change the person made), written to IndexedDB, and the status bar says the work was recovered (`status.save.recovered`).
- A clean session (IndexedDB holds the last change) restores silently, as autosave-restore says.

### Refusals

None.

### Problems in Pager

1. **Only five versions, kept inside the record they belong to,** so a record that cannot be read takes its history with it. Required: ten versions, each its own entry, with its time.
2. **A change made just before the browser died is lost** when its delayed write had not run. Required: the journal written with every change brings it back, and the notice says so.
3. **A project too large for localStorage lost its crash journal without a word** (the audit's AUD-38: the journal's write met localStorage's 5 MiB quota, the error was swallowed, and a crash kept only the last idle write of IndexedDB). Required: a journal localStorage refuses moves to IndexedDB, beside the record under its own key, written at every change of the document rather than when the browser is idle; the older journal in localStorage is dropped; the status bar says so once (`status.save.journalInDatabase`); the next start reads the newest of the record and the two journals, a journal newer than the record restored with the recovered notice.

### Undo and redo

Not affected: the history starts empty after a start, as always.

## autosave-restore

Jornada 03 J23: canvas text (including inline marks) and the four value-field families keep their unconfirmed draft in session storage after every input and programmatic text change. Reload restores the same edit, target, style context and caret without confirming it or adding document history. If a selection-only autosave has not reached idle when the first draft is written, its revision and selection enter the synchronous journal once, so the draft still names the saved project after a reload or crash. Confirmation clears the journal and makes the ordinary undo step. Cancellation, project replacement and a stale saved revision discard it. A read-only tab never restores a copied draft. The leave-page guard warns while a draft exists; persistence does not depend on an unload event.

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: a fresh profile, then a Section inserted from Elements.

### Trigger

- Every committed change of the document or of the project (`onDocChange(docAutosave)`, `onProjectChange(docAutosave)`, `src/features/documents/index.js:334`) schedules a write; a change that leaves the saved text as it was schedules nothing (`docAutosave` compares a snapshot, `:296-305`).
- The write happens **1000 ms** after the last change (`docSaveDelay`, `:214`; `setTimeout`, `:304`), one write at a time through a queue (`docEnqueue`, `:253-257`); a write that fails re-arms the timer (`:283-291`).
- Leaving the page (`pagehide`, `visibilitychange` to hidden) asks for a flush of the pending write (`:340-341`); the flush is an asynchronous IndexedDB write that the unload may cut short.
- The selection and the breakpoint and state are stored apart, in the preferences (`localStorage["base-editor-context"]`), on every selection change (`docRememberWorkspace`, `:220-226`, `:338`).

### Storage

- IndexedDB database `base-document-v1`, store `documents` (key path `id`), record `working`: `{ id, payload, name, saved, previous }`, where `payload` is the saved project text (`saveProject`, the same text File › Save project writes, with `format` and `app`), observed after inserting a Section (`:267-278`).
- The selection lives in `localStorage["base-editor-context"]` as `{"selection":[<uid>…],"context":{"state":null,"breakpoint":null}}` (observed).

### Restore

- At start the body is inert and the status reads `Loading…` (`:313-316`); the record is read, validated (a newer format refuses, an older one is migrated, a broken one falls back to an earlier revision, `:242-252`), opened, the selection and context restored from the preferences, and the history cleared (`:323`).
- Observed: a Section inserted and selected; reload; the Section is back and still selected, and the undo history is empty.
- A fresh profile with no record shows the empty page and `Not saved` (`:326`).

### Visual feedback

| Stage | What is drawn |
|---|---|
| Fresh profile | The status bar's save chip reads `Not saved`. |
| After a change | The chip reads `Saving…` until the write completes, then `Saved` (`docMarkSaved`, `:258-266`). |
| A write failed | `Save failed`, and the chip keeps its unsaved look. |
| After a reload | `Loading…`, then `Saved` once the record is restored. |

### Result

- The work (every page tree and project setting) and the selection are what they were before the reload; the undo and redo history starts empty.

### Undo and redo

- Autosave records nothing in the history. An undo or a redo is a change like any other and is saved; after a reload the history is empty.

### Keyboard equivalent

None: saving needs no action.

### Problems in Pager

1. **A change made less than a second before a reload can be lost.** The write waits 1000 ms after the last change; on leaving the page Pager only starts an asynchronous flush, which the unload can abort. Required: a committed change is written to the store as soon as it is committed (no waiting period), so the document survives an immediate reload.
   Stage 4 (the plan's "salvamento"): the record is written as soon as the browser is idle, at most
   `autosave.idleWait` (1 s) after the change, so no input waits for the whole document to be serialised; a reload, a
   closing tab or a hidden tab writes the journal at once (synchronously, before the page can unload), so an immediate
   reload still keeps the change. Only a browser process that dies within that second can lose the last change. A
   change of the selection alone does not serialise the document again unless a new unconfirmed draft needs that
   selection's revision before the idle save; then one synchronous journal write binds them before unload.
2. **The selection is stored apart from the document** (the document in IndexedDB, the selection in `localStorage`, written at different moments). After a crash between the two writes the restored selection can name nodes of another revision, or nothing. Required: the document and the selection are one record, written together in one IndexedDB transaction, and restored together.
3. **The record's format is Pager's file format mixed with record fields** (`payload` text plus `name`, `saved`, `previous`). Required: the record carries the format version of the saved project from the first save, the same version `project.json` carries (project-save-json), so every future migration is exercised on the real loading path.
4. **"Saved" is the only proof shown**, and it is a label. Required (tests): the proof is the document and the selection read back after an immediate reload, never the label.

## base-style

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph].

### Trigger

- Pager writes a small reset into the page's own style element when the frame mounts (`src/features/canvas/reset.css`, injected at `frame.js:88-104`).

### Hit zones and thresholds

Not applicable (no control of its own).

### Visual feedback

Not applicable: the base style changes the page's own layout, not the editor's chrome.

### Result in the document

- The reset is not part of the project file: it is written into the frame and into every export, so a project that is opened elsewhere keeps the same layout.

### Undo and redo

Not affected: the base style is not a document change.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Not applicable.

### Problems in Pager

1. **The reset is content-box** (`* { box-sizing: content-box }` is the browser's default and Pager never changes it): a hero given `height: 100vh` with padding grows past the screen (observed: 900 px of content plus the padding). Required: the project's base style is `border-box`, written into the canvas and exported, so a height or a width the person sets is the size the element takes on screen (the user's real-use audit, item 2.4).
2. **The reset lives only in the editor's frame** (`frame.js` injects it, the export writes none of it): the exported page and the canvas disagree. Required: one owner writes the same base text into the canvas and at the head of every exported stylesheet (`src/core/render/base.ts`).

### Our rule (the user's real-use audit, item 2.4)

- The base is one text, `baseCss()` in `src/core/render/base.ts`: the canvas writes it as the page's first style element
  (`src/editor/canvas/render/render.ts`, `data-base-style`) and every exported `css/styles.css` carries it at its head
  (`src/core/export/export.ts`). What the canvas shows is what the site does, for a rule of the base as for every other.
- It holds `box-sizing: border-box` for every element and its pseudo-elements. Its neutral presentation defaults cover
  the body font and margin, heading hierarchy, text spacing, links, lists, quotes, code, tables, form controls and media.
  The presentation selectors use `:where()` so an element's or class's own styles take precedence.
- A captured page's base text is placed in the first `__builder_base` cascade layer in both canvas and export; its
  residual sheet declares that layer before the captured site's own layers. Thus a site's layered normal rules outrank
  neutral Builder defaults, while the person's generated element and class rules remain later unlayered rules. Adding
  or removing the capture sheet updates the canvas base layer as well.

## breakpoint-overrides

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager.

### Trigger

- Pager stores each breakpoint's values in its own bag on the node (`n.bp[key]`), and reads a value at a breakpoint through the cascade of the breakpoints from the largest down to it (`bpStyleBags`, `src/model/style-layers.js:27-38`). Its CSS writes the base rule, then one `@media (max-width: Wpx)` block per breakpoint (`src/model/css.js:233-357`).

### Our rule

- Desktop is the base. With another breakpoint active (breakpoints-switch), every style write goes to that breakpoint's layer of the element (`styles → breakpoint → state → property`): `style.set`, the fields' steps and resets, the handles.
- What a field shows at the active breakpoint is its value there, else the value it inherits from the larger breakpoints above it (Tablet from Laptop, then Desktop). A field whose value is set at the active breakpoint shows a badge naming it (the origin "here"); an inherited one names where it comes from (the origin "breakpoint", with that breakpoint's name).
- The canvas draws the page at the active breakpoint's width, so its media queries apply: at Tablet and Phone a Tablet override shows, at Desktop and Laptop the base does.
- **Reset** of a field at a breakpoint removes that breakpoint's value only (`style.reset`): the inherited value shows again.
- The export's `styles.css` holds the base rule, then `@media (max-width: 1180px)`, `(max-width: 834px)` and `(max-width: 390px)` blocks in that order (the cascade order), each with the overrides of its breakpoint; the widths are the breakpoint table's.

### Refusals

As style.set's: a value the browser does not take, a locked element.

### Problems in Pager

1. **An inherited value and an override look the same** in the inspector. Required: the badge and the origin.
2. **Resetting at a breakpoint is not possible** from the field. Required: Reset removes that breakpoint's value only.

### Undo and redo

Each write and each reset is one undo step, as at Desktop.

## breakpoints-switch

### Continuous responsive preview

The viewport width field (in the Breakpoints dialog, View ▸ Breakpoints…: the frame's row holds only the breakpoints' tabs, as the canonical frame does) accepts 320–7680 CSS pixels, rounded to the nearest integer. Its range control changes
the same store-owned width continuously. The current cascade is the narrowest non-base breakpoint whose maximum
width includes the viewport, or the base above all media queries. The frame, Fit zoom, camera and preview use the
temporary width; fields edit the matching cascade. No document change or undo entry is created. Choosing a breakpoint
tab clears the temporary width. Reload restores the selected breakpoint at its reference width. Invalid or non-finite
widths are refused without changing the viewport. The frame's right edge drags the width too (`view.resizeViewport`):
the edge follows the pointer (the frame stays centred, so the width changes by twice the travel over the zoom), clamped
to 320–7680, the zoom held at the press's while the drag lasts. A project may define its own breakpoints (see project-breakpoints);
the tabs, the cascade and the media queries then read the project's table.

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager.

### Trigger

- Pager: a segmented control of Desktop, Laptop, Tablet and Phone in the top bar (`src/features/workspace/dock.js:133`, `:607`) calls `setBreakpoint(name, width)` (`src/features/workspace/camera.js:262-276`): the page's width becomes the breakpoint's, the canvas re-centres, and the inspector reads and writes that breakpoint's layer from then on. The widths are the breakpoint table's (`src/model/style-layers.js`).

### Our rule

- The frame's tabs (`view.setBreakpoint`, one door per breakpoint of properties.json's `breakpoints`): the active one pressed, its tooltip naming its width.
- The page inside the frame takes the breakpoint's width in CSS px: Desktop 1440, Laptop 1180, Tablet 834, Phone 390; in Fit mode the canvas refits the zoom, at a manual zoom the zoom stays.
- The status bar shows the active breakpoint and its width.
- The active breakpoint is a workspace preference, restored after a reload. It changes nothing in the document and records nothing.
- The tabs, the frame's widths and the export's media queries read the one breakpoint table (properties.json `breakpoints`).

### Refusals

None.

### Problems in Pager

1. **The breakpoint is a global (`window.BP`)** kept apart from the store, and lost at a reload. Required: editor state, a preference restored after a reload.
2. **The widths are written in three places** (the buttons' `data-w`, the page style, the export). Required: one table.

### Undo and redo

Not affected: switching the breakpoint records nothing.

### Our rule: the screen height, the fold lines and the width the site gives the page (the user's real-use audit, items 2.3 and A3.22)

- **Each breakpoint has a screen, width and height** (`properties.json`: Desktop 1440 × 900, Laptop 1180 × 800,
  Tablet 834 × 1194, Phone 390 × 844). The canvas gives the page inside the frame that height as its viewport, so
  `vh`, `svh` and `dvh` measure the screen whatever the zoom — a hero at Height 100vh measures 900 px on Desktop and
  844 px on Phone, at 100 %, at Fit and at 25 % — and the **export keeps 100vh**, which the site resolves to its own
  window the same way ("Screen height" is the name the Height field gives the value: the first item of its unit menu,
  "Screen height · 100vh", which a number field's suggestions head — the project's variables of its kind, then its
  door's presets — instead of a list under its text, whose arrow Chrome reserved inside a narrow value until it took
  no typed character at all).
- **The fold lines** mark where each screen ends: one at every whole screen (a 3000 px page on a 900 px screen has
  three, at 900, 1800 and 2700), each labelled "Fold 2 · 1800 px", drawn in the canvas chrome and never exported. They
  are a page setting (`foldLines` on the page root, like the layout grids), turned on and off in Guides & Grids, saved
  with the document and undone in one step.
- **The page lays out at the width a real browser gives it**: the canvas draws no scrollbar inside the frame (the stage
  scrolls the page), and the renderer keeps the browser's own scrollbar width free on the page's root
  (`scrollbarWidth()` in render.ts, measured once in the editor's document), so the Section on the canvas measures what
  the exported page measures in a window of the breakpoint's width, at any zoom (A3.22).

## canvas-grid-editor

The user's real-use audit, item 8.2 ("Editor de grade no canvas"): enter with a double click or Enter, leave with
Escape; line numbers; resizable tracks; add and remove a track; drop into a cell; span from the corner; merge
(Ctrl+M) and split (Ctrl+Shift+M) cells; draw and name areas; a responsive grid; everything per breakpoint and
undoable. The grid's own data belongs to the owners that already have it: the tracks are
`src/core/style/tracks.ts` (style.setGridTracks: a track's size, the repeat form, the track editor's add and remove)
and an item's place is `src/core/style/grid-item.ts` (style.setGridItem: its start and its span). This feature adds
the canvas editor over them — one editing mode of the canvas, its own key context, its own chrome — and nothing of
the document shape of its own.

### Trigger

- **Enter**: a double click on a grid container on the canvas (`grid.enterEdit#canvas-double-click-grid-container`).
  A container is a grid when the page computes `display: grid` for it (the value predicate `gridContainer`,
  properties.json); anything else is refused with its name (`status.gridEdit.notGrid`).
- **Leave**: `Escape` in the key context `grid-edit` (interactions.json), which the keymap takes for the canvas's
  while the editor is on (the same rule as the Edit on canvas modes, `src/editor/canvas/edit-mode.ts`
  `keyContextIn`).
- While it is on the canvas draws (`src/editor/canvas/grid-editor.tsx`): the number of every column at its start, a
  grip on the boundary between each two columns, and a grip at the bottom-right corner of the selected item. The
  grips are canvas handles: the boundary grip is the door `style.setGridTracks#handle-grid-track`, the corner grip
  `grid.spanItem#handle-grid-span`, so the pointer owner drags them as any other handle.

### What the editor writes

| Gesture | Command | Written through |
|---|---|---|
| Drag a boundary grip | `style.setGridTracks#handle-grid-track` | the track list of the axis, the track before the boundary taken as the px the drag makes (`withTrackSet`, the repeat form kept for equal tracks) |
| `Shift+=` / `Shift+-` in the editing context | `grid.addTrack` / `grid.removeTrack` | the same owner: one track added (equal to the others while they are equal) or the last taken away |
| Drag the corner grip | `grid.spanItem#handle-grid-span` | the item's grid-column: the width the drag makes divided by the width of one track — read from the item's own box (the layout port) and its current span — as its start and span, through style.setGridItem |
| `Ctrl+M` | `grid.mergeCells` | the same: the item's span on the axis one greater, refused where a child of the grid already covers the next cell (`status.gridEdit.cellTaken` naming it) |
| `Ctrl+Shift+M` | `grid.splitCells` | the same: the item's span one smaller, refused when it covers one cell (`status.gridEdit.nothingToSplit`) |

Every write goes through style.set's own reader and writer at the breakpoint and state the editor edits, so a grid
edited at the Phone is written at the Phone, and one undo step is one gesture or one command.

### Not built yet (the audit's remaining half of 8.2)

- **Dropping an element into a cell** (writing the item's grid-column/grid-row from the cell under the pointer): the
  drag's proposal knows the receiving parent and the index among its children, not the cell under the pointer, so a
  drop inside a grid still lands as an insertion among its children. The item's place is set from the corner grip,
  the item fields of the Style panel (A1.3) or the merge keys above.
- **Drawing and naming areas** on the canvas: `grid-template-areas` is edited in the Style panel's field, and an
  item names one of the parent's areas in its Area field (A1.3); the canvas does not draw areas yet.

### Problems in Pager

1. **The grid is edited in the Style panel only.** Pager sizes a grid's columns by typing the list, with no canvas
   editor, no line numbers and no grip on a track. Required: the editor above, on the canvas, over the owners of the
   tracks and of an item's place.
2. **A track written by the editor must keep the value's form.** Required: the editor writes what the track owner
   writes — the repeat form while the tracks are equal — so three equal columns sized by hand do not turn into three
   separate tracks by accident.
3. **A merge only where the cells are free.** Required: the keys refuse a merge with a reason naming the element in
   the way, and change nothing.

## canvas-outlines-zones

How Pager behaves, read from its source (`reference/Pager`) and its shell. Source references are `path:line` inside Pager.

### Trigger

- Two toggle buttons in the canvas tools: **guides** (`#tggBtn`, `index.html:105`) and **Zones** (`#tgzBtn`), each flipping a hidden checkbox (`#tgg`, `#tgz`) and drawing its `aria-pressed` state (`src/app/boot.js:109-118`).
- Guides adds the class `guides` to the editor's body and to the canvas page's body, projects the page again and repaints the selection (`boot.js:123-129`).
- Zones calls `setZones` (`boot.js:120-121`, `src/platform/overlay.js:332-336`), which draws the drop zones of the selected node (`zonesPreview`, `overlay.js:337-349`; `drawZones`, `:351-380`).

### Hit zones and thresholds

- Guides: every node gets a 1 px dashed outline, inset by 1 px (`style/06-canvas-chrome.css:16`, `.guide-outline`); an empty container is marked (`style/04-panels.css:37`).
- Zones: for the selected node only, the bands a drop would use: before and after (the edge band) and, for a container, inside (`overlay.js:363-378`), each labelled ("before", "inside", "after"). With nothing selected, or the page selected, nothing is drawn and the status explains it (`zones.atRest`, `zones.pageItself`, `src/core/i18n.js:73-74`).

### Visual feedback

Dashed outlines on every element (guides); tinted labelled bands around the selection (Zones). Neither draws in the exported page.

### Result in the document

None. The two switches are not stored: after a reload both are off.

### Undo and redo

Not undo steps.

### Nested elements

Guides outline every level. Zones show the selected node's bands only.

### Zoom other than 100 %

The outlines and bands follow the page's geometry at the zoom.

### Keyboard equivalent

None.

### Problems in Pager

1. **Guides re-project the whole page** (`render()` in `boot.js:126`), and the outline class is written into the canvas page's own body. Required: the outlines are drawn by the canvas chrome over the page, never written into the page, so they cannot reach the export (manifest feature `canvas-outlines-zones`).
2. **Zones show only the selection's drop bands.** Required: Zones show the padding of every container and the empty drop area of every empty container, so the places a drop can land are visible at rest.
3. **The switches are not stored.** Required: both choices are preferences, restored after a reload.
4. **The toggle's name ("guides") is the name of another feature** (manual guides). Required: the switch is named Outlines.

## clipboard-copy-paste

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > Heading, and an empty Container after the Section.

### Trigger

- `Ctrl+C` / `Ctrl+V` with something selected, focus on the canvas or panel chrome (`src/features/input/index.js:675-678`).
- Other doors: context menu Copy / Paste, Edit menu (synthetic key events, `src/features/workspace/dock.js:406-407`).

### Hit zones and thresholds

- Copy stores a JSON clone of the **primary** selected node in a module variable (`src/features/layers/layers-panel.js:658-664`). It never touches the system clipboard; a multi-selection copies only the primary node.
- Paste target (`layers-panel.js:665-680`): if the selection is a container, the copy is appended as its last child; otherwise it is inserted right after the selection.
- Refused with a message when the target is locked or the nesting rules refuse it (`fitsInWhy`, `ancestorBad`, `siblingBad`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Ctrl+C on the Heading | Nothing on the canvas; status `Copied: Heading`. | — |
| Ctrl+V with the Container selected, then with the Section selected | Each paste appears and is selected; status `Pasted: Heading 2`, then `Pasted: Heading 3`. | ![after two pastes](img/clipboard-copy-paste--01-after-two-pastes.png) |

### Result in the document

Observed: `Container.children = [Heading 2]` (appended into the empty container) and `Section.children = [Heading, Heading 3]` (the Section is a container, so the paste was appended inside it). The pasted nodes have new keys (`heading`, `heading-2`), new unique root names, and the same text and styles as the source.

### Undo and redo

Each paste is one history entry. Copy is not.

### Nested elements

The whole subtree of the copied node is pasted.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

`Ctrl+C`, `Ctrl+V`.

### Problems in Pager

1. **Copy takes only the primary node of a multi-selection.** Required: copy takes every selected root; paste inserts them in document order (see `multi-select-actions.md`).
2. **The clipboard is an in-memory variable,** lost on reload and invisible to other tabs and apps. Required: Ctrl+C writes the element to the system clipboard in the app's element format and Ctrl+V reads it from there (manifest feature `clipboard-copy-paste`). The text/html format for other applications is covered by `clipboard-cut-system.md`.
3. **Pasting with a container selected always goes inside it,** even when the person wanted a sibling of the container. Required: behaviour as the manifest intent states (container selected → last child; non-container → right after it), plus a status message that says which of the two happened (`Pasted Heading 3 into Section, position 2 of 2.`).
4. **Reading the system clipboard is not always allowed** (the user's real-use audit, item 3.8): the browser's prompt, once refused, makes Ctrl+V fail with "The browser did not allow access to the clipboard.", and a browser policy can refuse it silently. Required: the editor keeps its own copy of what the last copy or cut wrote (src/editor/clipboard.ts, the reader and the keeper), and a paste falls back to it whenever the system clipboard holds nothing readable — refused or empty — so copying and pasting works inside the editor whatever the browser allows. The system clipboard stays the complement: written on every copy, and read first when it holds something (what the person last copied anywhere, an application's HTML or text included, `clipboard-paste-external.md`).

## clipboard-cut-system

How Pager behaves, read from its source and checked by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- `Ctrl+C` / `Ctrl+V` exist (see `clipboard-copy-paste.md`) but use an **in-memory** variable, not the system clipboard (`src/features/layers/layers-panel.js:658-680`). No `navigator.clipboard` or `copy`/`paste` event handling exists for elements (the only clipboard writes in Pager are the export fallback, `src/app/boot.js:768-775`).
- **`Ctrl+X` is not bound** (no key row, no command). Observed: with the Heading selected and the canvas focused, `Ctrl+X` changed nothing (outline identical, status unchanged).

### Hit zones and thresholds

Not applicable.

### Visual feedback

None for Ctrl+X.

### Result in the document

Ctrl+X: none. Copy/paste across tabs: impossible (the clipboard variable is per page instance).

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not applicable.

### Keyboard equivalent

Not applicable.

### Problems in Pager

1. **No Cut.** Required: `Ctrl+X` copies and deletes the selection as one undo step (manifest feature `clipboard-cut-system`); Cut appears in the context menu and the Edit menu.
2. **No system clipboard.** Required: the app's element format on the system clipboard is covered by `clipboard-copy-paste.md`. This entry adds that Copy also writes `text/html` of the element's exported markup with its CSS rules, next to the app format, and that `text/html` has no editor attributes, ids or inline styles (manifest feature `clipboard-cut-system`).

## clipboard-paste-external

How Pager behaves, read from its source (the canvas paste path) and observed by running it from `.cache/pager-run` (the in-text paste path; Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- `Ctrl+V` on the canvas pastes only the editor's in-memory copy (`src/features/input/index.js:677-678`, `src/features/layers/layers-panel.js:665-680`). With nothing copied inside the editor it does nothing; content copied from outside the app is ignored. There is no `paste` event handler for the canvas.
- Inside an element being edited in place, a paste inserts the clipboard's `text/plain` only (`src/app/boot.js:661-665`); observed: pasting `text/html` `<b>RICH</b> <i>x</i>` inserted `RICH x` as plain text (see `text-inline-formatting.md`).
- Pager has no HTML importer (the File menu comment says "Importing HTML is not a current capability", `index.html:40-43`).

### Hit zones and thresholds

Not applicable.

### Visual feedback

None.

### Result in the document

External HTML or text pasted with an element selected: nothing changes.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not applicable.

### Keyboard equivalent

Not applicable.

### Problems in Pager

1. **External clipboard content cannot be pasted as elements.** Required: `text/html` from the system clipboard goes through the HTML importer (same cleaning and nesting rules) and is inserted into the selection as one undo step; multi-line `text/plain` becomes one Paragraph per line; anything the importer drops is reported in the status bar (manifest feature `clipboard-paste-external`).
2. **One paste door per source.** Required: `Ctrl+V` reads the system clipboard once and chooses in this order: the app's own element format, then `text/html`, then `text/plain`; external content uses the same placement rule as internal paste (selected container → appended as last children; otherwise inserted right after the selection).

## code-panel-selection-sync

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

**Pager has no Code panel.**

- Its workspace names one: the bench is described as "read-out, code, history, timeline" (`src/features/workspace/shell.js:57`), and the Panels menu has a slot for `code` (`src/features/workspace/camera.js:665`).
- But no such panel is registered. The only registered panels are `layers`, `palette`, `readout`, `inspector` and `provenance` (`registerPanel` calls in `src/features/workspace/dock.js:692-694` and `src/features/inspector/properties.js:3536-3539`), plus the Guides & Grids, Properties and Keyboard shortcuts panels.
- Observed: Ctrl+K `open` lists Layers, Elements, Engine read-out, Guides & Grids, Properties, Inspector and Keyboard shortcuts. The workbench tabs are `Engine read-out` and `Keyboard shortcuts`.
- The generated HTML/CSS can only be seen through Export (see `app-menu.md`), not next to the canvas.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager: there is no view of the markup to highlight.

### Result in the document

Not applicable: selection sync changes the selection only, never the document.

### Undo and redo

Selection changes are not undo steps.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No Code panel, so nothing follows the selection.** Required (manifest feature `code-panel-selection-sync`):
   - Selecting an element on the canvas or in Layers highlights its markup lines in the HTML tab and its rules in the CSS tab, and scrolls them into view.
   - Clicking a line inside an element's markup in the HTML tab selects that element on the canvas and in Layers, through the same selection command as a canvas click. For nested markup, the innermost element whose markup contains the clicked line is selected.
2. **The lines that select their element stood 28 px among 18 px ones, and every one was named "Select"** (the audit's U-023). Required: every line of the pane is as tall as the others (a line that is a door keeps a line's height, padding and type), and a line that selects its element is named after its number ("Select line 12").
3. **A text file showed the HTML, CSS and JS tabs with none selected, its editor named "the markup of the selected element"** (the audit's U-053). Required: a file that is none of the page's three parts shows one tab of its own, its extension (TXT), selected, and its editor is named after the file ("The text of notes.txt").

## color-picker-oklch

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager. It extends `color-picker.md`.

### Trigger

- In the colour picker, the format menu offers HSB, RGB, Hex, OKLCH and OKLab (`src/features/inspector/properties.js:152`); choosing OKLCH shows the fields L, C, H and α, OKLab the fields L, a, b and α (`:155`).
- The picker's text field takes any CSS colour text (`:218`, `applyTypedColour`).

### Hit zones and thresholds

- OKLCH: L from 0 to 1, C from 0 to 0.4, H from 0 to 360; OKLab: L from 0 to 1, a and b from −0.4 to 0.4 (`:162`, the ranges of the area's axes).

### Result in the document

- A channel field changed writes `oklch(L C H / α)` or `oklab(L a b / α)` with the four field values as typed (`:156`), the alpha always written, even when it is 1.
- A colour read from the stored text (`src/model/values.js:256`, `colorCoordinates`) shows its channels with up to five decimals (`:155`).
- A text typed in the text field is stored as typed when it is a colour.

### Undo and redo

As `color-picker.md`: every change inside the session is one undo step when Apply keeps it.

### Problems in Pager

1. **A channel value out of range is taken silently or dropped**: `change` runs for any finite number (`:156`), so C = 0.9 or L = 1.5 is written, and a text that is no number changes nothing without a word. Required: a value out of the channel's range (L 0–100 %, C 0–0.5, H 0–360, a and b −0.5–0.5) is refused with a message naming the channel (`status.colorPicker.invalid`), and the colour stays as it was.
2. **The alpha is written even for an opaque colour** (`oklch(0.7 0.15 260 / 1)`). Required: " / α" only when the colour is not opaque.
3. **L is shown and typed from 0 to 1**, while CSS and the other editors show a percentage. Required: L as a percentage from 0 to 100, written `oklch(70% 0.15 260)`.
4. **A colour outside sRGB is shown clamped with no word**: the area and the swatches can only show sRGB. Required: the colour is kept as written (a chroma beyond sRGB stays), and the picker says that it shows the nearest sRGB colour (`colorPicker.outOfGamut`).
5. **One reader of colours for every syntax**: named colours, hex with 3, 4, 6 and 8 digits, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() and color() are read by one owner (`src/core/style/color.ts`), the channels of every format coming from the same colour; a named colour is the one the page computes.

## color-picker

Jornada 03 correction: the shared [nonmodal layer contract](#nonmodal-layers-j8) supersedes the legacy shielding behavior described below.

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test element: a Container with `background-color: #dbeafe`. The picker is `openColorPicker` (`src/features/inspector/properties.js:174-250`); every colour field (Paint → Colour, Text → Colour, gradient stop colour, shadow colour) opens this same component (observed for all four).

### Trigger

- Click the colour field (`button.field.colorfield`: swatch + value text) in the Inspector. It opens a modal popover titled `Color`, 304 px wide, anchored at the field (`properties.js:181`), with a shield over the rest of the app.
- Inside the popover:
  - **Area** (saturation × brightness): press and drag (`properties.js:159-172`); the value follows the pointer from the pointerdown on, clamped to the area.
  - **Hue strip** and **alpha strip**: press and drag horizontally (`:168-169`, `:241-247`).
  - **Text field** (`aria-label` "Color value"): any complete CSS colour is applied live while typing; incomplete text is ignored (`applyTypedColour`, `:186-201`).
  - **Format select** `HSB | RGB | Hex | OKLCH | OKLab` and one number field per channel plus `α` (`colorPickerChannels`, `:150-158`); a radio beside each of the first three channels picks which channel the strip controls (the area then shows the other two).
  - **Previous / Current** swatches at the top; clicking Previous restores the colour the picker opened with (`:214-215`).
  - **Library:** tabs `Saved` (up to 48, `Save current` button, `×` to remove) and `Recent` (up to 12, filled by Apply), stored in the preferences `workspace.colors.saved/recent` (`properties.js:133-148`).
  - **Eyedropper** button ("Pick color from screen"), using the browser `EyeDropper` (`:222`).
  - **Cancel** and **Apply** (`:223`); the popover's `×`, Escape, or Ctrl+Z also close it (they cancel).

### Hit zones and thresholds

| Part | Size (observed) | Mapping |
|---|---|---|
| Area | 254 × 168 px (painted from a 128 × 96 canvas) | x → saturation 0…1, y → brightness 1…0, clamped (`:163-165`) |
| Hue strip | 254 × 12 px | x → hue 0…360 (`:169`) |
| Alpha strip | 254 × 12 px | x → alpha 0…1 rounded to 0.01 (`:246`) |
| Drag start | immediate on pointerdown, pointer captured (`trackGesture(…, true)`) | `:169`, `:244` |

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Open | Previous and Current swatches, the area with a ring dot, the hue strip with a knob, the alpha strip over a checkerboard, the text field, the format select and channel fields, the gamut line (`sRGB gamut`, or `Outside sRGB · wide gamut color preserved`, or `Linked token · …`), the library, then eyedropper, Cancel, Apply. | ![open](img/color-picker--01-open.png) |
| Dragging in the area | The dot follows the pointer; Current, the text field, the channels and **the canvas element** update live (observed: `#dbeafe` → `#145fcc`, computed `rgb(20, 95, 204)`). | ![area](img/color-picker--02-dragging-area.png) |
| Dragging alpha | The knob follows; the text becomes `rgba(20, 95, 204, 0.6)`; the canvas shows the transparency. | ![alpha](img/color-picker--03-dragging-alpha.png) |
| Previous vs Current | After a change, Previous keeps the opening colour and Current shows the new one. | ![previews](img/color-picker--04-previous-current.png) |

### Result in the document

- While the picker is open, every change is written to the node's style (the canvas preview is a real write inside an open history group, `ports.begin()`, `:178`).
- **Apply** closes the group (`ports.end()`) → one undo step with the final value; the value is added to `Recent`.
- **Cancel**, `×`, **Escape** and **Ctrl+Z** cancel the group (`ports.cancel()`, `:181`) → the stored value is back to the opening value (observed for Cancel, Escape and Ctrl+Z; the undo count went back).
- A click outside the popover does **not** close it (the modal shield takes the click; observed: the picker stayed open with the live value).
- Output format: hex when alpha = 1, `rgba(r, g, b, a)` otherwise (`ppColourOut`, `properties.js:132`); OKLCH/OKLab write `oklch(…)`/`oklab(…)`.
- Channel fields:
  - RGB 999 or −5 were **accepted and stored** as `rgb(255 999 254 / 1)` and `rgb(255 -5 254 / 1)`.
  - HSB S = 250 was clamped to 100 silently.
- Text field `nonsense` + Enter: nothing written and no message; the field keeps showing `nonsense`.

### Undo and redo

One Apply = one undo step (observed: Ctrl+Z → `#dbeafe`, Ctrl+Shift+Z → `rgba(20, 95, 204, 0.6)`). Cancel leaves no history entry.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the picker is outside the canvas).

### Keyboard equivalent

- Focus goes to the popover container when it opens. The text field, the format select and the channel number fields are keyboard-operable; Escape cancels.
- The area and the two strips have **no tabindex, role or key handling** (observed: `tabindex` null, `role` null), so they cannot be operated from the keyboard.

### Problems in Pager

1. **Invalid channel values are stored** (`rgb(255 999 254 / 1)`, `rgb(255 -5 254 / 1)`). Required: invalid channel values are rejected and the field shows the last valid value (manifest feature `color-picker`).
2. **Dragging from a colour with alpha < 1 stores unrounded channels**, e.g. `rgba(35.70001628905948, 41.93642646917034, 51.00000926426479, 0.6)` (the rgb from HSB is not rounded before `ppColourOut`). Required: RGB channels are integers 0–255 in the stored value.
3. **Invalid text in the text field gives no feedback** and stays displayed. Required: on Enter or blur, an invalid colour is rejected with a message and the field shows the current colour again.
4. **The area and sliders are mouse-only.** Required: they are focusable sliders (`role="slider"` with value text); arrow keys move 1 % (Shift 10 %) on their axis.

### Our rule: what the picker says, and a pick over a transparent colour (the user's real-use audit, items 6.5 and A3.29)

- **A pick over a fully transparent colour is opaque.** The colours the element holds (or the page shows) may be fully
  transparent (`transparent`, `rgba(0, 0, 0, 0)`); a hue, a saturation, a brightness, an RGB channel or the area
  pressed then writes the colour **opaque** — its alpha goes to 1 — because `rgba(…, 0)` over a transparent background
  is an invisible colour. One owner (`core/style/color.ts` `pickedAlpha(shown, carried)`: the alpha the write carries,
  made 1 when the shown alpha is 0 and the write keeps it), used by the area (`src/editor/input/pointer.ts` pickColor),
  by the picker's own writes (`src/editor/shell/color.tsx` `write`) and by the channel fields (`editedColour`). A write
  that *sets* the alpha — the alpha slider, the alpha channel of HSB, RGB, OKLCH and OKLab — is kept as it is written.
- **The picker names what it edits**: its header says the property and the element, "Background · Button 5" (or the
  property and how many elements are selected), never just "Colour". `src/editor/shell/color.tsx`, from the property's
  word (`propertyWord`) and the primary selected element's name.
- **Every colour field shows its colour.** Where the colour is the whole value of a property (`background-color`,
  `color`, `fill`, `border-color` as its own field, `column-rule-color`), the field draws the swatch that opens the
  picker. Where the colour is a **part of a larger value** — a border's colour, a shadow layer's, a gradient's stop —
  the field draws the colour as a **sample chip** (`.field__sample`): those values are typed in their own field and the
  picker, whose parts write a whole property, does not open there yet (the open finding in PROGRESS.md names the work:
  the picker's parts would have to carry a write target).
5. **The picker was a 304 px panel whose channels stacked their names over their fields, and a format that made it taller pushed Apply out of the window** (jornada02 GENERALISATION, colour picker). Required: the picker is the canonical popover — 240 px wide, 8 px inset, radius lg, the floating shadow; each channel field holds its key inside (H S B A, R G B A, # and A, L C H A, L a b A), its name its accessible name and tooltip; Cancel and Apply are the small buttons; and it is placed again whenever it changes size, so it stays inside the window. (The area's colours follow its width: a press 4 px into the 224 px area of `#ff0000` writes `#f9f4f4`.)

## color-swatches-eyedropper

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager. It extends `color-picker.md`.

### Trigger

- The colour picker shows two tabs, Saved and Recent (`src/features/inspector/properties.js:147`), each a list of colour swatches; a click on a swatch uses its colour.
- Apply remembers the colour it applies as the first recent colour (`:223`, `colorPickerRemember('recent', …)`).
- The eyedropper button (`:222`) opens Chrome's `EyeDropper` and uses the `sRGBHex` it returns; without the API the button is disabled.

### Result in the document

- Saved and recent colours are kept in the browser's preferences (`:133-135`, `workspace.colors.saved`, `workspace.colors.recent`), at most 48 saved and 12 recent, the newest first, each once.
- A swatch or the eyedropper writes the colour through the picker's session, as any part of it: Apply keeps it as one undo step, Cancel puts back the opening colour.

### Problems in Pager

1. **Saved colours belong to one browser, not to the project** (`:133`): another person, or the same project opened elsewhere, has none of them. Required: saved colours are stored with the project (the document's `swatches`), saved with Save current [colorPicker.saveCurrent] (`colors.saveSwatch`, one undo step with the picker's session) and taken away with a swatch's × (`colors.removeSwatch`); recent colours stay a person's own (the preferences): the last 10 applied, the newest first, each once.
2. **The saved and recent lists are hidden behind tabs**, one at a time. Required: both lists are drawn in the picker, the saved colours with Save current, the recent ones under them.
3. **The eyedropper is drawn disabled where the browser has no EyeDropper**, a control that looks usable but can never work there. Required: without the API the eyedropper is not drawn.
4. **Save current saves whatever text the picker holds, a colour already saved again** (`:135` dedupes only by text). Required: a colour already saved is not saved twice and records nothing.

## command-bar-set-property

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

In the command bar (`Ctrl+K`), a query of the form `<property> <value>` (regex `^([a-z][a-z-]*)\s+(\S.*)$`) whose property matches a catalogue property id or its kebab-case name, with something selected, adds a first entry `Set <property> to <value>` (`src/features/workspace/camera.js:760-766`). Enter runs it through the quick-panel commit (`setPropertyTyped`, `src/features/inspector/quick-panel.js:430`) or, for bound properties, the Inspector's writer.

`Edit property <css-name>` entries reveal the property in the Inspector (`revealProperty`, `camera.js:689-690`).

### Hit zones and thresholds

- The value is **not validated before it is offered**: `width abc` offered `Set width to abc`.
- On Enter, invalid values are refused by the commit with a status message.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| `gap 24` | First entry `Set gap to 24` with the hint `set`. | ![gap](img/command-bar-set-property--01-gap-24.png) |

Enter → status `Gap set to 24px.` `width 50%` → `W set to 50%.` `width abc` → offered, then on Enter refused: `W: "abc" is not a value this field takes.` `border-color` → `Edit property border-color`.

### Result in the document

`gap: 24px` and `width: 50%` were written to the selected element (observed on the selected Page root) in one transaction each, on the active breakpoint/state layer.

### Undo and redo

Each `Set …` is one history entry.

### Nested elements

Writes to the whole selection (the quick-panel commit writes every selected element).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

This is keyboard-only.

### Problems in Pager

1. **Invalid values are offered** and only refused after Enter. Required: `Set <property> to <value>` is offered only when the value is valid for that property (manifest feature `command-bar-set-property`).
2. **The quick-panel wording leaks into the status** (`W set to 50%.` for `width`). Required: the status names the CSS property (`width set to 50%.`).

## command-bar

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `Ctrl+K` toggles the bar (`workspace.commandBar`, `src/features/workspace/dock.js:611-612`); File → Commands opens it (`dock.js:640`). While editing text, `Ctrl+K` is the link shortcut (the text editor stops the event, `src/app/boot.js:695-701`).
- In the bar's input: ArrowDown/ArrowUp move the highlight (wrapping), Enter runs it and closes, `Escape` closes, Tab keeps focus in the input (`dock.js:623-634`); a click on a row runs it; a click on the backdrop closes (`:635-639`).

### Hit zones and thresholds

- Entries (`cmdCommands`, `src/features/workspace/camera.js:680-692`): `Open <panel>` for every registered panel; every defined command whose `when` accepts the selection (with its shortcut hint); `Insert <element>` for every palette type; `Edit property <css-name>` for every property when something is selected.
- Matching (`camera.js:732-770`): substring of the label or of the hint; ranked label-prefix, word-prefix, substring, hint-only; at most **12** results. With an empty query, up to 5 recently run labels come first.
- A query `<property> <value>` adds `Set <property> to <value>` at the top (see `command-bar-set-property.md`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Ctrl+K with a Paragraph selected | A centred bar with an input and the first 12 entries: `Open Layers`, `Open Elements`, `Open Engine read-out`, `Open Guides & Grids`, `Open Properties`, `Open Inspector`, `Open Keyboard shortcuts`, `Toggle left panels Ctrl+B`, `Toggle right panels Ctrl+Alt+B`, `Undo Ctrl+Z`, `Redo Ctrl+Shift+Z`, `Save project JSON`; each with its hint at the right. | ![open](img/command-bar--01-open.png) |
| Typing `wrap` | Only `Edit property flex-wrap` and `Edit property overflow-wrap` — **no Wrap in a row / column**, because those are key rows, not commands. | ![wrap](img/command-bar--02-wrap.png) |

Enter on `Edit property flex-wrap` ran it and closed the bar; reopening showed it first (recent). `insert hero` → `Insert Hero` (highlighted after ArrowDown; Escape closed the bar). `layers` → `Open Layers`.

### Result in the document

The bar runs the chosen command; it never changes the document by itself.

### Undo and redo

As for the command run.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **Structural commands are missing** (wrap, promote, move, hand, rename, delete, select all in container are key rows or other code paths, not commands). Required: the bar lists every command of the keymap and the menus, each with its shortcut, from the one command registry (manifest feature `command-bar`: typing `wrap` and Enter wraps).
2. **Commands that cannot apply are not always filtered:** `Edit property …` is offered for every property, including properties that do not apply to the selected element. Required: commands that cannot apply to the current selection are not offered.
3. **Fuzzy search is substring-only.** Required: fuzzy matching (initials and out-of-order words, e.g. `insert hero`, `ins hero`).
4. **The bar was a narrow box of the inspector's width, its rows the height of a toolbar button, the keyboard's row told apart from a hovered one only by the same fill, and a search nothing matched showed an empty box.** Required: the canonical palette — 640 px wide (never wider than the window less 32 px on each side), 72 px from the window's top, centred; its input 48 px high in the input type role with a line under it; entries 32 px; the keyboard's entry in the accent's soft fill with a 1 px accent ring, a hovered one in the hover surface; a search no entry matches says so in the bar (manifest feature `command-bar`: at a 1440 px window the palette is 640 wide at x 400). The field's row draws the search glyph before the query and the key that closes the bar (Esc) after it; an entry marks the parts of its label the query's words match in the accent, and a command names the menu it stands in after its label (Export project (ZIP), File); the keys the menus and the palette show are written as key caps (Alt+↑, ↓, Esc: the arrows as arrows), the chord itself unchanged; the palette leaves the editor undimmed behind it (design/final .palette). The entries stand under their scope's title (Commands, Insert, Panels, Properties, Pages, layers and classes), each group where its best entry stands, so the first entry is still the best match; a title is no option. A top menu shows the keys of the canvas, where its commands act (Arrange: Wrap in a row R), as the context menu does.
5. **The scopes were only a line of hints to type** (jornada02 pairing 5.1). Required: under the field the palette draws its scope pills — All, Commands >, Insert +, Panels /, Properties # — the one the query's prefix keeps pressed (All with no prefix); a press puts that scope's prefix before the words typed (All takes it away) and gives the field the focus back.
- **A panel opened from the bar left the focus on nothing** (jornada03 plan, stage 5: "foco vai ao painel aberto"): Open
  Layers closed the bar and the page body held the focus. Required: **Open …** puts the focus in the panel it opens, as
  the activity bar's buttons do (`workspace.setPanelOpen` with `focus`): on its first control of content (a sidebar
  panel's search field, never its header's Close first), the Layers on their row that takes Tab, a panel with no
  control on the panel itself.
- **A command that cannot run now vanished without a word** (the dogfooding pass, 2026-09-30): "dup" with nothing selected answered only that nothing matched. Required: it is still not offered (Problem 2), and when nothing is offered the bar names the best-matching command that cannot run now and its reason (`commandBar.unavailable`: "“Duplicate” cannot run now: …"); with none, `commandBar.none` as before.
- **The palette's footer and its panel entries said other things than the canonical palette** (the audit's AUD-28: the footer listed every key's command, "↓ Next item ↑ Previous item Enter Run the focused item Esc Close", and Open Explorer drew no icon). Required: the footer says what the canonical palette says — the arrows `choose`, Enter `run`, Tab `filter` (Tab takes the focus from the field to the scope pills), and `Also` the bar's other chord (Ctrl+Shift+K; the top bar's search shows Ctrl+K); Escape stands at the field's end, so the footer leaves it out. An open-panel entry draws its panel's own icon (layout.json's, as the activity bar and the View menu draw it: Open Explorer with the Explorer's files).

## context-menu

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `contextmenu` on an element in the canvas selects it (if not already selected) and opens the row menu at the pointer (`src/features/layers/layers-panel.js:620-640`).
- `contextmenu` on a Layers row does the same (`layers-panel.js:610-619`).
- On the Page root the canvas handler returns without calling `preventDefault` (`layers-panel.js:631-632`), so the **browser's native context menu** opens instead.
- The menu closes on a click of an item, on any `pointerdown` outside it (`:646`) and on `Escape` (`:652`).
- Pager has a **second, separate list of element actions**: the `⋯` (More actions) button of the quick panel opens a strip of icon buttons (`src/features/selection/selection.js:167-202`, run by `runSelbarAction`, `src/app/boot.js:262-346`). Its buttons, in order: drag · move up · move down · wrap in a row · wrap in a column · promote · remove wrapper · take into the hand · duplicate · lock · hide · remove (`selection.js:121-137`). The new app has no such strip: these actions are items of this menu, and the quick panel's More actions opens this menu (manifest feature `context-menu`, `quick-panel`).

### Hit zones and thresholds

- Menu position: `left = min(clientX, innerWidth − menuWidth − 8)`, `top = min(clientY, innerHeight − menuHeight − 8)` (`layers-panel.js:616-618`, `:635-639`). Measured menu size: 200 × 259 px. A right-click on the last Layers row (y ≈ 735) opened the menu at y = 633, so it stays inside the window.
- Items are full-width buttons in a `role="menu"` container; there is no keyboard navigation inside the menu: ArrowDown with the menu open did nothing and focus stayed where it was (observed).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Right-click on a Paragraph on the canvas | The Paragraph is selected; a popup menu opens with its top-left at the pointer: **Rename, Copy, Paste, Move up, Move down, Make child of previous layer, Move out of parent**, a separator, **Delete** (danger colour). No item shows a shortcut and no item is ever disabled. | ![canvas menu](img/context-menu--01-canvas.png) |
| Right-click on a Layers row near the bottom | Same menu, shifted up to stay inside the window. | ![layers menu](img/context-menu--02-layers-row.png) |
| Pager's separate strip (quick panel → More actions) on a Container | An icon strip under the quick panel; the strip's lower row draws the quick panel's Margin, Padding and More… buttons on top of each other. Only five of its tooltips name a shortcut; remove wrapper is hidden (not disabled) unless the selection is a container with children. | ![strip](img/unwrap--01-more-actions.png) |

### Result in the document

Each item runs a Layers handler (`layers-panel.js:513-589`):

| Item | Handler | Notes |
|---|---|---|
| Rename | inline input in the Layers row (`:561-581`) | see `rename-element.md` |
| Copy / Paste | editor-internal clipboard (`:659-680`) | see `clipboard-copy-paste.md` |
| Move up / Move down | move by one index in the parent (`:515-528`) | silent at the ends |
| Make child of previous layer | append to the previous sibling if it is a container (`:530-544`) | see `nest-into-previous.md` |
| Move out of parent | insert after the parent in the grandparent (`:545-558`) | see `promote-out.md` |
| Delete | remove the primary node (`:582-589`) | no toast; ignores the rest of a multi-selection |

Observed: "Make child of previous layer" on a Paragraph after a Container → `Container > [Paragraph]`, status `Placed. Paragraph in Container, position 1 of 1.`

### Undo and redo

Every item that changes the document is one history entry.

### Nested elements

The menu acts on the right-clicked element, which becomes the selection.

### Zoom other than 100 %

The menu is window chrome; its position is the pointer's screen position at any zoom.

### Keyboard equivalent

None in Pager (no `Shift+F10` / ContextMenu key handling). The same commands exist as shortcuts on the canvas (Alt+Arrows, R, C, P, M, F2, Ctrl+D, Ctrl+C, Ctrl+V, Delete).

### Problems in Pager

1. **The menu is incomplete.** Missing: Cut, Duplicate, Wrap in a row, Wrap in a column, Remove wrapper, Take into the hand, Lock, Hide. Required: at least, in this order, Rename, Copy, Cut, Paste, Duplicate, Move up, Move down, Wrap in a row, Wrap in a column, Remove wrapper, Make child of previous layer, Move out of parent, Take into the hand, Lock, Hide, Delete (manifest feature `context-menu`); later features may add items.
2. **No shortcuts are shown and nothing is ever disabled.** "Make child of previous layer" on an element without a previous sibling stays enabled and silently does nothing (observed). Required: each item shows its shortcut where it has one and has a tooltip naming its action and that shortcut; the menu draws only the items that apply to the selection — an item that cannot apply, or whose feature is not built yet, is left out, never drawn enabled to do nothing (the interface contract, PRODUCT.md §5.3; the menu bar keeps its items in place, disabled with their reason).
3. **The items run different code than the shortcuts** (e.g. Move up here moves only the primary node and is silent at the edges, while Alt+ArrowUp moves the whole selection and reports). Required: every item runs the same command as its shortcut and produces the same document JSON.
4. **No keyboard operation.** Required: the menu opens with focus on its first enabled item; ArrowUp/ArrowDown move between items (wrapping), Home/End jump, Enter runs, Escape or a click outside closes it and returns focus to where it was.
5. **Right-click on the Page root shows the browser's own menu.** Required: the editor menu opens for the Page root too, with the items that apply to the root (the items that do not are left out, as item 2 says).
6. **Two lists of the same actions** (this menu and the More actions strip) with different items, tooltips and availability rules; the strip hides actions that cannot apply instead of disabling them, overlaps its own text and is out of the Tab order. Required: no separate action strip; the quick panel's More actions opens this menu at the button (manifest feature `quick-panel`). The strip's drag button has no counterpart: an element is moved by dragging it (`drag-reorder-canvas.md`) or with Take into the hand.
7. **Paste style drew no icon** while Copy style draws the palette (the audit's AUD-28). Required: Paste style draws the brush, so the two read as a pair; the layout tool's item says Layout, the name the activity bar gives it.

## copy-paste-styles

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no copy-style or paste-style command.** The i18n catalogue holds the labels (`command.copyStyle` "Copy style", `selbar.action.copystyle`, `src/core/i18n.js:2277`, `:328`), but no command, menu row or key uses them. `Ctrl+Alt+C` and `Ctrl+Alt+V` are not bound (they are not in `KEYMAP`, `src/features/input/index.js:660-833`, or in any command chord).

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

None in Pager.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **Styles cannot be copied from one element to another.** Required (manifest feature `copy-paste-styles`):
   - Ctrl+Alt+C (Copy style) puts every style value of the selected element on the system clipboard in the app format.
   - Ctrl+Alt+V (Paste style) replaces the target's style values with the copied ones as one undo step; text, children and attributes stay.
   - Both commands are in the context menu and the Edit menu with their shortcuts.

## css-variables-tokens

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager.

### Trigger

- Pager keeps the project's variables in its state as `variables: Record<name, { kind, value }>` (`src/core/state.js:44`) and names a variable in a style value as `var(--name)`, optionally with a fallback (`src/model/provenance.js:23-27`, `tokenReference`).
- The Styles view lists the variables; a value typed as `var(--name)` in a field uses one.

### Result in the document

- A variable is stored once in the project, with its kind (colour, length) and value; an element that uses it stores `var(--name)` in its style, and the page resolves it.
- The provenance of a field shows the token a value names (`provenance.js:40-44`).

### Problems in Pager

1. **Variables are not written to the export.** Required: the export's stylesheet declares every variable in `:root` (`--name: value;`) and the elements' rules keep `var(--name)` where they use one.
2. **Renaming a variable leaves its uses pointing at a name that no longer exists.** Required: `tokens.rename` renames the variable and every `var(--name)` that uses it, in every page, as one undo step.
3. **A variable can be deleted while elements use it**, which leaves their values unresolved. Required: `tokens.delete` of a variable in use is refused, naming how many values use it (`status.token.inUse`); an unused one is deleted.
4. **Fields do not offer the variables.** Required: a colour field offers the colour variables, a length field the length variables and the font size field the font-size variables, as `var(--name)` next to the typed values; a value typed as `var(--name)` of a variable the project has is kept as written, and of one it does not have is refused.
5. **A variable's name and value are not checked.** Required: a name is a CSS custom property name without its dashes (letters, digits and `-`, starting with a letter), unique in the project (`status.token.nameTaken`, `status.token.badName`); a value is one the browser takes for its kind (a colour for a colour variable, a length for a length or font-size variable), else it is refused naming it.
6. **Changing a variable** changes every element that uses it at once, one undo step: the page draws the new value wherever it is used.
- **A new variable left the focus on nothing** (jornada03 plan, stage 5: "nova variável rola até ela e foca"). Required:
  the variable New variable makes is scrolled into view and its name field takes the focus with the name selected, so
  the name typed next replaces it (Enter keeps it, as every name).
- **The list of kinds could not be reached from the keyboard** (the audit's AUD-26: the + opened it and kept the
  focus). Required: New variable's + opens the kinds as a listbox in the editor's popover, and the first kind takes the
  focus; the arrows move it among the kinds (wrapping), Home and End reach the ends, Enter makes a variable of the
  focused kind, and Escape or a press outside closes the list and gives the focus back to the +, with nothing made.
- **A variable was reached only through the field's menu, or by typing its whole name** (WISH-10: a bare `--name`
  was read, but nothing was suggested while it was typed; the browser's own list could not be read nor reached by the
  editor's keys). Required: while a value field's text is `--` or `var(` and the start of a name, the field lists the
  project's variables of its kind whose names start with what is typed (else those that hold it), the first one
  active, under the field — as Webflow's value editor suggests variables. The field is then a combobox (the WAI-ARIA
  pattern, as the command bar's search field): the arrows move the active variable, Enter writes it, Escape closes the
  list and keeps the text, a press on a variable writes it; the focus stays in the field and typing goes on there.
  Each item is the field's own door with the variable as its value, so a variable chosen is one undo step, as a value
  typed is. The browser's list keeps the keywords and presets only.

### Undo and redo

Creating, changing, renaming and deleting a variable are one undo step each.

## delete-element

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `Delete` or `Backspace` with the canvas (or the page body) focused and something selected (`src/features/input/index.js:679-680`). The row carries no `focus` flag, so it does not fire while focus is on a panel control or in a text field (`keyAllowed`, `input/index.js:486-491`).
- In the Layers tree, `Delete`/`Backspace` on a focused row deletes the selection (`src/app/boot.js:150-159`).
- Other doors: the selection bar's Remove button, the context menu's Delete, the Edit menu's Delete (`boot.js:342`, `src/features/layers/layers-panel.js:582-589`, `src/features/workspace/dock.js:408`).

### Hit zones and thresholds

Not a pointer gesture. With a multi-selection, every selected root is removed; descendants of other selected nodes are skipped (`input/index.js:604-627`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After Delete on the first Paragraph | The element disappears; **the selection is cleared** (no outline, Inspector shows "Nothing selected"); the status bar reads `Removed: Paragraph`; a toast `Removed: Paragraph` with an **Undo** button appears at the bottom (`input/index.js:622-626`). Toasts stack: three deletes left three toasts on screen. | ![after delete](img/delete-element--01-after-delete.png) |
| Delete with the Page root selected | Nothing is removed; status tag turns to `REFUSED` with `The page root cannot be deleted.` (`input/index.js:606-608`). | — |
| Delete inside a locked ancestor | Refused with `Unlock “Section” before deleting it.` (`input/index.js:609-612`). | — |

### Result in the document

- Observed: Section > [Heading, Paragraph, Paragraph 2]; Delete on Paragraph → [Heading, Paragraph 2]. Backspace on the Section → the Page is empty.
- The node and its whole subtree leave the document JSON in one transaction (`input/index.js:616-621`).

### Undo and redo

One Ctrl+Z restored the Section with its children; a second restored the Paragraph at index 1 with its original id (`new-paragraph`), observed. After each undo the selection is the one saved with the snapshot (the node that was selected when it was deleted).

### Nested elements

Deleting a container deletes everything inside it. Locked ancestors block the delete (see `lock-element.md`).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The keys are the primary door.

### Problems in Pager

1. **After a delete nothing is selected,** so the next keyboard command has no target. Required: after a delete the selection moves to the next sibling, else the previous sibling, else the parent (manifest feature `delete-element`).
2. **Toasts pile up** (one per delete, each with its own Undo). Required: at most one delete toast is visible; a new delete replaces it, and its Undo undoes the most recent delete only.

## dock-toggles

Jornada 03 correction: activity icons open and focus their panel without toggling it closed or moving it from its current placement. The active icon names Collapse (Ctrl+B); that shortcut and the panel close button still close it. Ctrl+B, Ctrl+Alt+B and Ctrl+\ act the same with the focus in a plain text field (the Insert panel's search an icon puts the focus in, the Layers search, a number field): a field keeps its other keys, and the text edited in place keeps Ctrl+B as Bold (the user's decision of 2026-10-02).

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

| Input | Effect | Source |
|---|---|---|
| `Ctrl+B` | hide / show the left dock (Elements + Layers) | `src/features/workspace/dock.js:551`, `toggleDock` `:174-187` |
| `Ctrl+Alt+B` | hide / show the inspector | `dock.js:552` |
| `Ctrl+\` | collapse every dock; the second press restores what was open | `dock.js:576-595` |
| Panel `×` button | close that panel (Elements or Layers) | `src/features/windows/index.js:488`, `:523-525` |
| Top bar **Elements** / **Layers** toggles | show / hide each panel | `windows/index.js:334-342` |
| View menu rows (panels, Toggle left dock, Toggle inspector) | the same | `dock.js:535-549` |

While a text element is being edited, `Ctrl+B` is taken by the text editor as bold (observed: the Heading became `<strong>New heading</strong>` and the left dock stayed open), because the text editor stops the event (`src/app/boot.js:695-701`).

### Hit zones and thresholds

Not pointer gestures. Measured layout at 1600 × 900 (independent-panel mode):

| State | left dock | canvas stage | inspector |
|---|---|---|---|
| default | 0-280 px | 300-1299 px (999 px) | 1300-1600 px (300 px) |
| after Ctrl+B | hidden | 20-1299 px (1279 px) | unchanged |
| after Ctrl+Alt+B | unchanged | 300-1600 px (1300 px) | 0 px wide |
| after Ctrl+\ | hidden | 20-1600 px (1580 px) | 0 px wide |

The canvas refits in Fit mode (`refit`, `src/features/workspace/camera.js:618-635`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Ctrl+B | Left dock gone; canvas grows; status `Elements / Layers hidden.` (then `… shown.`). | ![ctrl b](img/dock-toggles--01-ctrl-b-left-hidden.png) |
| Ctrl+\ | Every dock collapsed; status `Every dock collapsed — Ctrl+\ puts back what was open.`, then `The docks are back as they were.` | ![ctrl backslash](img/dock-toggles--02-ctrl-backslash-all-collapsed.png) |

Ctrl+Alt+B says `Inspector hidden.` / `Inspector shown.` Closing Layers with its `×` and reopening it from the top bar toggle wrote **no** status message (observed).

### Result in the document

Never changes the document. The dock and panel state is saved in preferences (`workspace.independent-panels.v1`, `persistLayout`).

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

The zoom is kept; in Fit mode the canvas refits.

### Keyboard equivalent

The chords above.

### Problems in Pager

1. **Closing or reopening a single panel says nothing.** Required: the status bar reports each change (`Layers closed.` / `Layers opened.`), for every door (manifest feature `dock-toggles`).
2. **Two parallel panel systems** (independent Elements/Layers groups and the older dock layout) decide visibility; `Ctrl+B` goes through one or the other depending on a body class (`dock.js:174-180`). Required: one workspace owner for docks and panel visibility.
3. **With the dock closed, the Checks were out of sight** (the audit's U-026; the plan's 5.5 asked for a strip kept when collapsed). Decided (jornada03 plan, stage 5: follow the canonical design/final): closed, the dock keeps its 28 px strip — Timeline, Checks and Motion as tabs that open the dock on their panel, then the first issue of the Checks list, then show/hide and maximize. The Checks tab carries the number of issues the document has, as a badge and in its name ("Checks: 3 issues"), closed or open. The status bar draws no dock panel (A3.18's icons are retired: the strip is where the panels are).

## drag-autoscroll

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: a page three screens tall, with the Layers panel full enough to scroll.

### Trigger

- While a drag goes on (an element's or a palette tile's), the loop the drag runs every animation frame (`src/features/drag/drag.js:954`, `:1054-1083`) asks each of its scrollers — the stage and the Layers panel (`dragState.scrollers`) — whether the pointer is within **4 px across / 16 px beyond** its box (`:1055-1056`), and scrolls the ones the pointer is over.
- The scroll arms only once the pointer has been **properly inside** the stage, more than `MEASURE_LIMITS.SCROLL_ZONE` from its edges (`:1057-1059`, `dragState.arrived`): a drag that starts on the palette, outside, scrolls nothing until it has come in (UX-003).
- A side offer being held (the wrapper pill's axis) suspends the scroll along that axis (`:1060`, `:1088-1089`).

### Hit zones and thresholds

- The zone is `MEASURE_LIMITS.SCROLL_ZONE` = **56 px** inside each edge of the scroller (`src/platform/measure.js:48`).
- The step grows as the pointer nears the edge: `ceil((1 − distance / 56) × 22)` px per frame, `SCROLL_MAX` = **22** (`drag.js:1063-1070`).
- A scroller scrolls on an axis only when it has room: the stage when the page overflows its box, the Layers panel when its content overflows it (`:1061-1062`).
- The proposal follows: every frame that scrolled reruns the drop proposal at the pointer's place (`:1076`), so the insertion line tracks the page.

### Visual feedback

The drop indicator (the line, the receiver's outline, the label) moves with the page; nothing else is drawn for the scroll itself.

A proposal already taken stays while the pointer stands still (the drag's hysteresis keeps a jittering pointer from flipping between two slots), but a scroller that moved carried the page under it: the proposal is taken again there, so the release lands on what the scroll brought under the pointer, never on what stood there before.

### Result in the document

The scroll changes no document by itself; what it changes is where the release lands, because the node under the pointer after the scroll is a different one (a page that has scrolled up brings lower rows under the same pointer).

### Undo and redo

Not applicable: no document change of its own.

### Nested elements

The Layers panel scrolls even while the pointer is over the page and the reverse: both scrollers are asked each frame.

### Zoom other than 100 %

The zone and the step are screen pixels (`drag.js:1063`, screen coordinates), so the page moves `22 / zoom` page pixels a frame at another zoom.

### Keyboard equivalent

None.

### Problems in Pager

1. **The scroll is a loop of its own and belongs to the drag's owner.** Required: one autoscroll, in the pointer owner (src/editor/input/pointer.ts), registered in the manifest as the feature `drag-autoscroll`, with scenarios: the zone, the step and the arming rule are the constants `drop.autoscrollZone` and `drop.autoscrollMaxStep` of interactions.json.
2. **Only the page scrolls.** Required: the Layers panel scrolls the same way while the pointer is over it, so a row below the fold can be reached by dragging: its own visible box, its own scroll. Its band is at most a fifth of its own height (`drop.autoscrollTreeShare`), and over a row it scrolls only once the pointer has rested in the band for `drop.autoscrollTreeDwell` — a drag aimed at a visible row near the edge and released there keeps that row under the pointer; past the rows it scrolls at once. (LA1, found by AUD-35: the tree scrolled only past its rows, so a tree taller than its panel, whose bottom edge always holds a row, never scrolled down.)
3. **A drag that starts at the edge scrolls at once.** Required: the scroll waits until the pointer has been properly inside the scroller, beyond the zone, at least once during the drag (spec drag-layout, row 8).

## drag-drop-inside

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. The gesture, threshold, ghost, line and label are the ones in `drag-reorder-canvas.md`; this file covers what differs when the receiver is a container.

### Trigger

Same as a canvas move drag: press on an element, move at least 4 px (`src/core/pointer.js:3`, `src/app/boot.js:507`), release to commit the last drawn proposal (`src/features/drag/drag.js:1118-1245`).

### Hit zones and thresholds

- **Empty container.** On the canvas an empty container keeps a visible minimum height of 40 px (editor-only; the iframe element carries the class `empty`). Its aim area is widened to at least 40 × 40 px, centred and shared with its neighbours, when the real box is smaller (`src/platform/measure.js:148-214`, `EMPTY:40`). The whole aim area is **inside** except an edge band of `min(8, 0.25 × extent)` px at both ends along the parent's axis, which means before/after the container (`src/platform/overlay.js:15-21`, `EMPTY_EDGE:8`). Measured: a 1392 × 40 px Container → aim `348, 263, 1392 × 40`, inside everywhere except the outer 8 px.
- **Container with children.** Edge band `min(clamp(0.25 × extent, 8, 32), 0.4 × extent)`; between the bands the pointer resolves to the nearest slot between children (inside), or, over a child, to that child's before/after halves (`drag.js:238-260`, `src/model/layout.js:12-39`).
- **Leaves are never receivers.** A leaf (heading, paragraph, image, input…) has no centre zone: its halves are before/after (edge band = extent/2). Measured: the Heading dragged over the exact middle of a Paragraph gave `before`/`after` that Paragraph, never `inside`.
- **The dragged element and its descendants are not targets.** The hit test skips them (`drag.js:405`), so the pointer over them resolves to the nearest ancestor that is not dragged. The validator also refuses any receiver that is the dragged node or one of its descendants with "An element cannot be placed inside itself or one of its descendants" (`drag.js:746-748`), but on the canvas that refusal is never reached because of the skip; it only shows in Layers (see `layers-drag.md`).
- Locked or hidden containers, or containers inside a locked/hidden ancestor, are not receivers (`drag.js:452-455`, `:749-753`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Over an empty Container | The container's box gets a 1.5 px **dashed** accent outline with no fill (`#hl.scope`, `style/06-canvas-chrome.css:96`); the label chip is green (`#lbl.ok`, `:136`) and reads `Move to position 1 · Container`; no insertion line. The status bar reads `Into Container (first child)`; the read-out adds "Empty container: aim widened to 40px, dotted fill." Every empty container whose aim area is larger than its real box shows a dashed aim box for the whole drag (`drag.js:1001-1018`, `.aimbox` `:128`). | ![into empty](img/drag-drop-inside--01-into-empty.png) |
| Dropped | The Heading is the Container's only child and is selected; the container loses its empty minimum height. | ![dropped](img/drag-drop-inside--02-dropped.png) |
| Over the upper half of the Heading inside the Container | Insertion line above the Heading, the Container tinted as receiver, label `Move to position 1 · Container · before Heading`. | ![above heading](img/drag-drop-inside--03-above-heading-in-container.png) |
| The Container dragged over its own Paragraph | No refusal: the proposal is the Container's current place in the Page (`Move to position 2 · Page`, status `Into Page · index 1`). Release leaves the document JSON unchanged. | ![own descendant](img/drag-drop-inside--04-onto-own-descendant.png) |

### Result in the document

- Heading dragged onto the empty Container → `Container.children = [Heading]`; the Section loses it.
- Paragraph dragged over the upper half of that Heading → `Container.children = [Paragraph, Heading]`.
- The dropped node keeps its id and its styles; flow coordinates (grid cell, absolute offsets) are cleared when it enters a flow parent (`drag.js:1217-1225`).
- The Container dragged onto its own child → no change.

### Undo and redo

One drop is one history entry; `Ctrl+Z` puts the node back in its old parent at its old index with the same id.

### Nested elements

Moving into a container nested several levels deep uses the same zones at each level; near an ancestor's real edge the escape ladder offers the outer level (see `drag-reorder-canvas.md`), and ArrowUp/ArrowDown change the level explicitly (see `drag-level-keys-escape.md`).

### Zoom other than 100 %

The 40 px minimum aim and the 8 px empty band are measured in screen px on the zoomed boxes (the aim box is computed from `getBoundingClientRect` after mapping), so at 50 % a 40 CSS px empty container is 20 screen px tall and its aim is widened back to 40 screen px.

### Keyboard equivalent

With something in the hand (`M`), ArrowDown/ArrowRight step through every insertion slot, including the first slot inside an empty container, and Enter places it (see `hand-keyboard-move.md`).

### Problems in Pager

1. **No refusal when the pointer is over the dragged element's own subtree on the canvas.** The indicator silently falls back to the element's current place in its ancestor. Required, as the user corrected it on 2026-09-27 (a refusal there, the first thing a drag drew and what a release a few pixels away met, blocked every small move): over the dragged element or its descendants the proposal is the element's current place, drawn as any other (the line between its neighbours, the label naming them), and a release there leaves the document as it is.
2. **The empty-container label says `Move to position 1 · Container`,** which reads like a reorder. Required: the label reads `Into <container name>` for an empty container (manifest feature `drag-drop-inside`), and `Into <container name> · position N of M` for a non-empty one.
3. **The status line and the label use different words** (`Into Container (first child)` vs `Move to position 1 · Container`). Required: the label and the status bar use the same sentence for the same decision.
4. **Stale overlay text survives in the DOM** (`#why` still held `✚ <li> will be created here` from an earlier drag while hidden). Required: every indicator element is cleared when the drag ends, so assistive technology and tests never read a previous decision.
5. **An empty container is too small to aim at when zoomed out** (the user's real-use audit, item 2.2: an empty footer column measured 179 × 11 screen px at 27 %). Required: an empty container shorter or narrower than drop.emptyAimMin screen pixels is aimed at through a box widened to drop.emptyAimMin on that axis around its centre; where the pointer lies in that box over the container itself or one of its ancestors (never over another element), the container is the target, and its edge bands are taken on the widened extent. The page does not change: the widened box exists only for the drop. At 25 % a tile released 10 screen px below the middle of an empty container, over its parent's bottom padding (outside the container's own box), lands inside it.

## drag-duplicate

How Pager behaves, read from its source and its duplicate spec (`spec/behavior/duplicate.md`, "Trigger"): **Ctrl held during a pointer drag** duplicates: the ghost reads `Copy of <name>`, and the release inserts a copy at the drop point while the original stays (`src/features/drag/drag.js:307-311`, `:358-367`, `:1166-1170`). This editor gives Ctrl to the selection (a Ctrl+click toggles an element in it) and follows Webflow and DESIGN.md "Canvas", drag (spec drag-layout, row 12): the key is **Alt**.

### Trigger

- An element drag on the canvas (drag-reorder-canvas, drag-drop-inside) with **Alt held at the release**. While the drag goes on, Alt belongs to the duplicate: pressing or releasing it changes nothing but what the release will do, and the drop label and the status bar say it ("Duplicate · …").
- The canvas toolbar's key hint of a drag reads "↑↓ level · Esc cancels · Alt duplicates".

### Result in the document

- The dragged elements (the selection's roots) stay where they are; a copy of each, made as `element.duplicate` makes it (fresh ids, new names, spec duplicate), lands where the drop label says, in document order: `element.duplicate` then `element.moveTo` of the copies to the parent and index drawn, through the drag's one gesture.
- Where the copies may not go (the drop is refused, spec drag-layout, Problems in Pager 4), the release does what the proposal drawn says; a refused release changes nothing.
- The copies become the selection.

### Undo and redo

One undo step takes the copies away and gives back the selection from before; redo puts them back.

### Problems in Pager

1. **The modifier is Ctrl, which the selection needs** (Ctrl+click toggles an element in the selection, spec multi-select-click). Required: Alt duplicates, as in Webflow; Ctrl keeps its selection meaning.
2. **Nothing but the ghost says a copy will be made.** Required: the drop label and the status bar begin with "Duplicate ·" while Alt is held, and the toolbar's key hint names Alt.

## drag-layout

This spec gathers what the drag and drop of a professional page builder offers so that a layout is built by dragging,
quickly and without detours, and names the feature of the manifest that owns each behaviour. The single drag
behaviours stay in their own specs (drag-reorder-canvas, drag-drop-inside, drag-level-keys-escape, palette-drag-insert,
layers-drag, wrap-row-column); this one is the whole picture and the requirements the separate specs lacked.

### What the reference builders do

- **Webflow Designer**: while dragging, one colour marks the parent the element goes into and another the position
  inside it (an insertion line); holding Alt (Option) while dragging drops a duplicate and leaves the original; the
  Navigator (Layers) takes the same drags for precise nesting. Sources: Webflow Help Center, "Navigator" and "The Add
  panel"; Webflow shortcut references.
- **Elementor (Flexbox containers)**: a container has a drag handle on its toolbar; an empty container shows a "+"
  drop zone; a row container lays its children side by side, and dropping beside a child adds a column.
- **Framer**: layers are wrapped in a Stack with one shortcut (Shift+A); a wrapper is removed keeping its children;
  a modifier drag moves a layer through others.
- **Pager** (reference/Pager, documented in wrap-row-column): a drop in the side band of an element that fills its
  parent's width offers "create a row" with the element and the dragged one side by side.

### Behaviours (requirements)

| # | Behaviour | Feature |
|---|---|---|
| 1 | A press on an element and a move past drag.threshold drags the selection's roots; below it the press is a click. | drag-reorder-canvas |
| 2 | One proposal per pointer position: before/after a leaf by its halves, before/after/inside a container by its bands, the slot nearest the pointer inside it; a new proposal only after the pointer moved drag.hysteresis (12 screen pixels) from where the drawn one was taken, so a tremor never changes it. | drag-reorder-canvas, drag-drop-inside |
| 3 | The indicator names both things: the receiving parent (its outline and soft fill) and the position (the insertion line along the parent's flow: horizontal in a vertical flow, vertical in a row), with a label next to the line: "Drop in Hero · position 2 of 3". | drag-reorder-canvas |
| 4 | A ghost chip with the dragged element's icon and name follows the pointer at drag.ghostOffset, for an element drag as for a tile's creation drag; the source keeps its place with a dashed outline and its selection handles hidden. | drag-reorder-canvas (Problems 1), palette-drag-insert |
| 5 | **Positioning first; a side drop builds a row or a column** (the user's corrections, 2026-09-25: no surgical pointing, and a drag positions first). Over any element the drop positions it (rows 2 and 3). Only in a narrow strip at the left or right edge (top or bottom in a row flex) of the element right under the pointer, min(wrap.sideBandMax 40, wrap.sideBandFraction 0.12 × its extent) screen pixels, clear of its other edges by min(wrap.sideEdgeExclusion, a quarter of it), does the drop put the dragged element beside it in a new Row (vertical flow) or Column (row flow). Never over an ancestor's edge (the element under the pointer decides), never for a band of the page (an element right in the page root), never for a child of a grid or a wrapping flex; the element must be at least wrap.sideTargetMin across and fill wrap.sideFill of its parent. The strip confirms at once (wrap.sideDwell 0); the indicator then shows the side drop instead of a position: a line along the element's side edge, the element outlined in the drop colour, the label "Side by side: Paragraph beside Card" (a Column in a row parent reads "Stacked": the label names the visible result, the user's remark of 2026-09-27), and under the ghost a pill with the wrapper's glyph. The side drop drawn holds while the pointer stays by that side of its element within drag.hysteresis (a tremor never moves it), and yields to a deeper element's own strip. The release wraps (element.wrapBeside), one undo step, the new wrapper selected. The same for a palette tile's creation drag. | drag-side-wrap |
| 6 | In a row (a flex row parent) a drop beside a child is an ordinary before/after along x: it adds a column to the row; no wrapper. | drag-reorder-canvas |
| 7 | An empty container is a drop target at least drop.emptyAimMin tall on the canvas (not exported), drawn with a dashed placeholder while a drag is over it. | drag-drop-inside, empty-container |
| 8 | Near an edge of the stage (drop.autoscrollZone) the canvas scrolls by up to drop.autoscrollMaxStep per frame, faster nearer the edge, once the pointer has been inside the stage; the proposal follows the scrolled page. | drag-autoscroll |
| 9 | A proposal whose line lies outside the visible stage (drop.outsideStageTolerance) is refused and drawn refused. | drag-autoscroll |
| 10 | The dropped elements flash for drop.flashDuration and stay selected; the status bar says where they went. | drag-reorder-canvas |
| 11 | Arrow keys change the drop level, Escape cancels, a refused target is drawn refused with its reason. | drag-level-keys-escape, nesting-grammar |
| 12 | Alt held at the release drops a duplicate and leaves the original (Webflow), in one undo step: the gesture element-duplicate-drag holds Alt, and the release runs element.duplicate then element.moveTo of the copies (spec drag-duplicate). | drag-duplicate |
| 13 | The same drops in Layers (rows' zones), with the row dwell expanding a collapsed row. | layers-drag |

### Problems in Pager

1. The side drop wraps on release even before its hint appears (wrap-row-column, Problems 2), and its bands take the
   edges of whole sections. Required: row 5 (a narrow strip of the element under the pointer only), and an indicator
   that shows which drop will happen.
2. The element drag has no ghost; only the dashed source outline says what moves. Required: row 4.
3. Autoscroll starts as soon as a drag begins near an edge, so a drag that starts at the stage's edge scrolls at once.
   Required: row 8's "once the pointer has been inside the stage".
4. **A refused target sent the drop far away, and side bands took small targets** (the user's real-use audit, A3.37): a Link dropped on a Link went two levels up to the Section, a Paragraph on a Paragraph left the list, nothing said why, and at 25 % a drop in the 7 px gap between two buttons created a Row. Required: where the element under the pointer refuses what the drag brings (its command's refusal, asked without running it, for a creation drag and an element drag alike), that element is drawn refused (outlined in the danger colour) and the proposal moves to the nearest valid place: before or after the refusing element, on the pointer's side of its middle along its parent's flow — the side follows the pointer on every move across the refusing element, not the side it entered by, and a pointer within drop.middleTie of the middle counts as before it —, and one level further up only when that too is refused; the label and the status bar read the refusal and then where it lands ("Refused. An interactive element cannot sit inside Link Block. · After Link Block · Page › Hero"), and the release drops there. A side band is at least wrap.sideBandMin screen pixels wide, and no side drop is offered on an element shorter than wrap.sideTargetMinCross screen pixels across its bands.

## drag-level-keys-escape

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: `Section > Container > Paragraph`, then a Heading after the Section. The pointer gesture itself is described in `drag-reorder-canvas.md`.

### Trigger

- During a live pointer drag every key goes to the drag first: a capture-phase `keydown` listener on `window` handles it and then calls `preventDefault` and `stopImmediatePropagation`, so no other shortcut runs (`src/app/boot.js:548-554`).
- `ArrowUp` raises the level counter by one, `ArrowDown` lowers it by one (not below 0), `Escape` cancels (`src/features/input/index.js:660-667`).
- The counter resets to 0 when a drag starts (`src/features/drag/drag.js:920`) and when it ends (`:1331`).
- Before the 4 px threshold is crossed (pending drag) `Escape` also cancels and every other key is swallowed (`boot.js:549-553`).

### Hit zones and thresholds

- With a level counter *n* > 0 the escape ladder is skipped; the proposal is computed from the zones of the target under the pointer and then climbed *n* times: `before X` becomes `before Parent(X)` and `after X` or `inside X` becomes `after Parent(X)`, stopping at the Page root (`drag.js:488-490`, `:713-724`).
- The counter is not clamped at the top: pressing ArrowUp at the root level keeps increasing it (observed `↑3` while the proposal stayed `after Section`), and ArrowDown then has to undo those extra presses before the level changes.
- Changing the level resets the hysteresis anchor (`input/index.js:665-667`), so the new level is drawn without moving the pointer.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Over the lower half of the Paragraph | Line below the Paragraph, Container tinted, label `Move to position 2 · Container · after Paragraph`. | ![level 0](img/drag-level-keys-escape--01-after-paragraph.png) |
| ArrowUp | Line after the Container, Section tinted, label `Move to position 2 · Section · after Container · ↑1`; status `After Container`; read-out "… · forced level ↑". | ![level 1](img/drag-level-keys-escape--02-arrowup-after-container.png) |
| ArrowUp again | Line after the Section, Page tinted, label `Move to position 2 · Page · after Section · ↑2`. | ![level 2](img/drag-level-keys-escape--03-arrowup-after-section.png) |
| ArrowDown, then release | The label returns to `Move to position 2 · Section · after Container · ↑1`; on release the Heading lands after the Container inside the Section (`Section > [Container, Heading]`), is selected, and the status reads `✓ Move to position 2 · Section · after Container`. | ![dropped](img/drag-level-keys-escape--04-dropped.png) |
| Escape | The line, tint, label and dashed source outline disappear at once; the ghost animates back to 8 px inside the source element's top-left corner and fades out in 140 ms (`drag.js:1304-1321`, `style/03-shell.css:46-47`). Status `Cancelled — nothing changed`; read-out "The ghost flew back to its origin." The selection chrome and quick panel come back. (Captured 40 ms after Escape.) | ![escape](img/drag-level-keys-escape--05-escape-ghost-returns.png) |
| Mouse released after Escape | Nothing happens; the document JSON is byte-identical to before the drag (observed). | ![after release](img/drag-level-keys-escape--06-after-release.png) |

Note on a second observed sequence: ↑ ↑ ↑ ↓ ↓ ↑ left the counter at 2 but the drawn proposal stayed `after Container` until the pointer moved 2 px, after which it switched to `after Section · ↑2`; the release then dropped after the Section (`Page > [Section, Heading]`). The drop always executes the last drawn proposal, so what the person saw is what happened, but the indicator lagged behind the key.

### Result in the document

Release inserts the dragged node at the drawn level. Pressing ↑ ↑ ↓ from `after Paragraph` and releasing places the Heading after the Container, inside the Section. Escape leaves the document JSON unchanged and no history entry is added.

### Undo and redo

A drop at a forced level is one history entry like any drop. A cancelled drag adds nothing.

### Nested elements

Each ArrowUp climbs exactly one ancestor of the resolved receiver; the root is the ceiling. ArrowDown only walks back down the same ladder (it never descends into a child that was not on it).

### Zoom other than 100 %

Keys do not depend on zoom.

### Keyboard equivalent

The same levels are reachable without a pointer with the hand: `M`, then ArrowUp climbs a receiver level and ArrowLeft descends (see `hand-keyboard-move.md`).

### Problems in Pager

1. **The level counter is not clamped.** ArrowUp at the root keeps counting (`↑3`, `↑4`…) with no visible change, and the next ArrowDown presses do nothing visible. Required: the level stops at the highest valid ancestor; an ArrowUp there is ignored and the status says `Already at the top level`; one ArrowDown always goes one level down from what is shown.
2. **The indicator can lag behind a level key** until the pointer moves (observed once in ↑ ↑ ↑ ↓ ↓ ↑). Required: every level key redraws the indicator and label in the same frame, without pointer movement.
3. **`↑N` counts key presses, not levels.** Required: the label names the level by its receiver (`Level: Section`), and the count shown is the number of levels actually climbed.
4. **The ghost's return animation is 140 ms and ends 8 px inside the source corner,** too fast to be noticed. Required: on Escape the ghost returns to the source element over 150-250 ms (design token for motion) and the status says `Drag cancelled — nothing changed`.

## drag-reorder-canvas

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 % unless stated) and read from its source. Source references are `path:line` inside Pager. Test document: a Section (padding 56 px 40 px) holding a Heading and two Paragraphs.

### Trigger

1. Primary-button press on an element (or on its selection/hover chip) arms the gesture: the element is selected and a pending drag is stored with the press point (`src/app/boot.js:449-502`, `dragArm` at `:497`, pointer captured at `:501`).
2. The drag starts on the first `pointermove` whose distance from the press point is at least **4 px** (Euclidean, screen pixels; `src/core/pointer.js:3`, check at `src/app/boot.js:507`). Below that nothing is drawn and release is a plain click that only selects (observed: press + 3 px + release left the document JSON unchanged and the element selected).
3. While dragging, a `requestAnimationFrame` loop resolves one drop proposal per frame from the pointer position (`src/features/drag/drag.js:945-997`).
4. Release commits exactly the last proposal that was drawn (`drag.js:1118-1245`); `Escape` or a lost pointer capture cancels (`drag.js:1304-1321`, `src/app/boot.js:540-554`).

### Hit zones and thresholds

The target is the deepest element under the pointer, skipping the dragged element, its descendants and locked elements (`drag.js:395-412`). For a target inside a parent whose flow runs on axis *A* (vertical for block and column flex, horizontal for row flex), with the target's extent *S* along *A* and the pointer at offset *pos* from its start (`drag.js:238-260`, `src/platform/overlay.js:15-21`, limits in `src/platform/measure.js:40-49`):

| Target | Edge band *e* | Pointer in band | Else |
|---|---|---|---|
| Leaf (text, image, input…) | *S*/2 | first half → **before** it, second half → **after** it | — (a leaf is never a receiver) |
| Empty container | min(8, 0.25·*S*) | before / after | **inside** as first child |
| Container with children | min(clamp(0.25·*S*, 8, 32), 0.4·*S*) | before / after | **inside**, at the slot nearest the pointer |

- Measured on the Paragraph (19.5 px tall): pointer 1 px above its middle → `before Paragraph`, 1 px below → `after Paragraph`.
- Measured on the Section (151 px tall, two paragraphs): top 0-31 px → before Section; 40 px (padding) → inside at index 0; over a child → that child's halves; 111 px (bottom padding) → inside at the end; last 32 px → after Section.
- Inside a container the insertion slot is the number of children whose centre lies before the pointer on axis *A* (`src/model/layout.js:12-39`); in wrapping and grid flows the row is chosen first, then the position within it.
- Escape ladder: when the pointer is within `min(12, extent/2 − 8)` px (plus 2 px slop) of an ancestor's real edge along its parent's axis, the proposal climbs to before/after that ancestor; the outermost matching ancestor wins (`drag.js:163-211`, `:506-526`). For a small container the band shrinks: on a 19.5 px container it is 1.75 px.
- Hysteresis: a new decision replaces the drawn one only after the pointer has moved **4 px** from where the drawn one was taken (`drag.js:975-985`, `HYST:4`).
- Lateral wrapper: see `wrap-row-column` for the side bands (≤ 26 px) that offer "create a row/column" instead of a reorder.
- Autoscroll: within **56 px** of a scroll container's edge the view scrolls by up to **22 px per frame**, only after the pointer has once been more than 56 px inside the stage (`drag.js:1054-1080`, `SCROLL_ZONE:56`, `SCROLL_MAX:22`).
- A proposal whose line lies outside the visible stage (tolerance 8 px) is drawn in the warning colour with arrow heads and is refused on release with "Not committed — the destination was outside the visible stage…" (`overlay.js:64-68`, `drag.js:1126-1130`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Pressed, under 4 px | Nothing new: the element is selected, no ghost, no line. | ![pressed](img/drag-reorder-canvas--01-pressed-under-threshold.png) |
| Dragging over the upper half of the Heading | **Insertion line**: 3 px accent line across the receiver's content width at the gap (`overlay.js:188-196`, `:276-280`), with round end caps. **Receiver tint**: the receiving parent's box (+2 px each side) gets a 1.5 px accent outline and a soft accent fill (`style/06-canvas-chrome.css:88`). **Label chip** at the receiver box's top-left, 20 px above it, clamped inside the stage (`overlay.js:283-294`): `Move to position 1 · Section · before Heading`. **Ghost chip** `⠿ Paragraph 2` follows the pointer at +14, +16 px (`drag.js:937`, `style/03-shell.css:44`). The source element keeps its place and gets a 2 px dashed accent outline (`style/06-canvas-chrome.css:30`). Cursor `grabbing`. The status bar reads `Before Heading`. | ![before](img/drag-reorder-canvas--02-before-heading.png) |
| Dropped | The element moves; it flashes for 0.9 s (`drag.js:1237`) and stays selected; the status bar reads `✓ Move to position 1 · Section · before Heading`. | ![dropped](img/drag-reorder-canvas--03-dropped.png) |
| Over the lower half of the last Paragraph | Line below it; label `Move to position 3 · Section · after Paragraph`. | ![after](img/drag-reorder-canvas--04-after-last.png) |

Label grammar (`overlay.js:311-330`): `Move to position N · <receiver name> · before|after <sibling name>`, with ` · escape` when the ladder climbed and ` · ↑N` when the level was forced with the arrow keys. N is 1-based among the siblings without the dragged element.

### Result in the document

On release the dragged node is removed from its parent and inserted at the proposal's `(parent, index)` (`drag.js:1162-1226`). Observed: dragging Paragraph 2 over the upper half of the Heading turned `[Heading, Paragraph, Paragraph 2]` into `[Paragraph 2, Heading, Paragraph]`; dragging the Heading over the lower half of the last Paragraph gave `[Paragraph 2, Paragraph, Heading]`. The dropped element is selected. A drop that lands where the element already is leaves the document JSON identical and adds no history entry (observed: the next `Ctrl+Z` undid the command before the drag).

### Undo and redo

Each drop is one transaction (`runEditorOperation`, `drag.js:1158`): one `Ctrl+Z` restored the previous order exactly, `Ctrl+Shift+Z` re-applied it (history counter +1 per drop, observed).

### Nested elements

The receiver is always the parent of the sibling under the pointer. Near a nested container's edge the escape ladder offers the outer level; the arrow keys change the level explicitly (see `drag-level-keys-escape`).

### Zoom other than 100 %

At 50 % the same gesture produced the same proposal (`before Paragraph 2` in the Section) and the same document result. Zones are computed from measured screen boxes, so bands in CSS px scale with the zoom while the 4 px threshold, the 4 px hysteresis and the 12 px escape band stay in screen px. Chips (label, ghost) keep their screen size. ![zoom 50](img/drag-reorder-canvas--05-zoom-50.png)

### Keyboard equivalent

`M` takes the selection into the hand and the arrow keys aim (see `hand-keyboard-move`); `Alt+ArrowUp`/`Alt+ArrowDown` move among siblings (see `move-up-down`).

### Problems in Pager

1. **The selection chrome stays on during the drag.** The dragged element keeps its selection outline, its eight handles and its tag chip, which sit under the ghost and next to the insertion line (visible in `drag-reorder-canvas--02-before-heading.png`). Required: while a drag is live, hide the selection handles, the tag chip and the quick panel; keep only the dashed source outline.
2. **The status texts disagree about the index.** The label says `Move to position 3`, the read-out says `Sibling in Section · index 2 of 2` (0-based, counted without the dragged node). Required: one wording everywhere, 1-based, e.g. `Position 3 of 3 in Section, after Paragraph`.
3. **The label chip is anchored to the receiver's top-left corner,** far from the pointer and the line when the receiver is tall. Required: the label stays next to the insertion line (or the pointer), inside the canvas viewport.
4. **The escape band collapses on small containers** (1.75 px on a 19.5 px container), so the outer level is practically unreachable by pointer there. Required: the level can always be changed with ArrowUp/ArrowDown during the drag, and the drop indicator names the level; the escape band is at least 6 px wherever the container is at least 12 px tall.
5. **A container's flow was read along one axis only** (the user's real-use audit, item 2.1): a grid was taken for a vertical column, a wrapping flex for one line, row-reverse and column-reverse were ignored and inline children were stacked; in a grid of three cards the second and third empty cells and the gap between cards 1 and 2 proposed position 1, and a card's side edge nested into it. Required: the insertion point is the one nearest the pointer by the real boxes, in two dimensions: the line (row, or column in a column flow) the pointer is on, then its place along that line in the order shown, turned into the document's order (reverse included); a grid flows along its auto-flow (rows: along x), a flex along its direction, any other container along x when every child is inline-level; the halves of a leaf and the bands of a container are taken along that flow, before and after as shown; the insertion line stands between the neighbours shown side by side (a neighbour on another line is none). In a grid of 3 columns, a drop in the gap between cards 1 and 2 lands at index 1, and one in the third, empty cell at index 2. Where the drop is before or after an ancestor of an element offering a side drop (the ancestor's escape band: a card's side edge in a grid, whose title fills it), the drop wins and no side drop is offered.
6. **Small targets were unreachable at small zooms** (the user's real-use audit, item 2.2): the Hero's row of buttons measured 12 screen px at the "fit" zoom and all of it was the row's escape band, so a drop over a button sent the element out of the row; the container bands were taken in CSS px and shrank with the zoom. Required: the edge bands of a container (the table above, and drag-drop-inside's empty container) are taken in screen pixels from the target's extent on the screen, so they keep their size at any zoom; an ancestor's escape band is at most a third of that ancestor's extent on each side (slop included; this caps the 6 px floor of item 4 on an ancestor shorter than 24 px on the screen); over a child of a flex or a grid the drop stays in that flex or grid, before or after the child by its halves, and never climbs the escape ladder (the level keys of drag-level-keys-escape still climb). Where an ancestor shares an edge with the ancestor inside it (a card whose top is its grid's), its band at that edge is never wider than the inner one's, so the innermost wins there (the user's real-use audit, item 3.3: a drop on a card's title at the fit zoom went before the grid). At the "fit" zoom a Link tile dropped on the centre of a Link in a flex row lands in the row beside it.
7. **The indicator looked like the selection** (the user's real-use audit, item 3.1): the insertion line was 2 px in the selection's colour, and the dragged element kept its lit selection outline. Required: the line is a bar --size-drop-line (3 px) thick in its own colour, --color-canvas-drop, never the selection's, with a round mark at each end; the receiving parent is outlined with a soft fill in the target colour; while an element is dragged its selection is off (a thin neutral dashed outline marks the source; no label, no handles); the drop label never lies under the ghost chip: a place the chip covers is not free, and with none free the label moves beside the chip. The label also never covers page content (the real-use audit of the canvas, 2026-09-28: "after Title" between two blocks of text put the label over the paragraph): the three places of the label rule are tried at the line's start and at its far end, and where none is free the place covering the least content wins.
8. **A lost release left a gesture open** (the user's real-use audit, A3.14): a handle's drag whose release never arrived stayed open, and the next drag threw "this gesture is closed" and recorded both. Required: once a gesture opens (past the drag threshold) its pointer is captured, so its moves and its release arrive wherever it goes; a cancelled pointer (pointercancel), a capture lost before the release, and a press while a gesture is still open end every open gesture with nothing recorded and no exception; with the focus in the canvas frame, a press on the canvas brings the focus back to the editor, so Escape and the level keys reach the gesture, and a focus that moves into the frame during a gesture ends it (the editor window's blur) with nothing recorded.
9. **Where the drop lands had to stay still under a resting hand** (the user's real-use audit, item 3.2, as the user corrected it on 2026-09-27: a preview that opened room in the page made the neighbours move under the resting pointer, flickered and made a place between elements impossible to hit, and a dashed overlay of the dropped size only got in the way). Required: no preview of the dropped element, neither in the page nor over it: the insertion line (item 7) says where the drop lands; while a drag goes on the page never moves and the document does not change, and the dragged element keeps its place; Escape takes every mark of the drag away. A pointer that rests between two elements, trembling a few pixels as a hand does, keeps one proposal, and the release lands where the line was drawn.
10. **The label counted positions and did not say where in words** (the user's real-use audit, item 3.3). Required: the drop label and the status bar read the same words for every drag, an element's or a tile's: the neighbours the drop lands between and the path to the receiver, "Between Card 1 and Card 2 · … › Plans › Grid", "Before <first>", "After <last>", "Inside <path>" into an empty one (a tile: "Insert Paragraph · between …"), with "· ↑N" when a level key climbed; the path names the receiver and at most two of its ancestors, the outer ones left out as "…". While a drag goes on, the canvas toolbar shows its keys: "↑↓ level · Esc cancels · Alt duplicates" (spec drag-duplicate). This replaces the "position N of M" wording of item 2 and of palette-drag-insert, Problems in Pager 1.
11. **Dragging one element of a selection of several moved only it** (the user's real-use audit, item 3.4): with two headings selected, dragging one moved it alone and left it the only one selected. Required (DESIGN.md "Canvas", drag): a plain press on an element that belongs to a selection of several keeps the selection until the release; a drag from it drags the whole selection (its roots, in document order), in one undo step; a release without a drag selects that element alone, as a click does.
12. **A press inside a selected container dragged the child** (the user's real-use audit, item 3.5): with a card selected, a drag started on its title moved the title. Required: a plain press inside a selected element other than the page root keeps the selection until the release; past the drag threshold it drags the selected element; a release without a drag selects what was pressed, as a click does (a click on a card's title with the card selected selects the title).

## duplicate

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph].

### Trigger

- `Ctrl+D` (declared as a command chord, `src/app/boot.js:228`, dispatched by `dispatchCommandChord`, `src/features/workspace/camera.js:693-703`). It runs with focus on the canvas or on panel chrome, not in text fields.
- Other doors: selection bar "duplicate", Edit menu Duplicate (which dispatches a synthetic `Ctrl+D` keydown, `src/features/workspace/dock.js:405`, `:476-479`).
- **Ctrl held during a pointer drag** also duplicates: the ghost reads `Copy of <name>`, and release inserts a copy at the drop point while the original stays (`src/features/drag/drag.js:307-311`, `:358-367`, `:1166-1170`).

### Hit zones and thresholds

- Every selected root is copied and each copy is inserted right after its original (`boot.js:325-336`).
- Refused when the selection is the Page root (`The page root cannot be duplicated.`), locked, or when the parent allows only one such child (`siblingBad`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After Ctrl+D on the Section | A second Section appears below the first and is selected; status `Duplicated: Section 2`. | ![after](img/duplicate--01-after-ctrl-d.png) |

### Result in the document

- A deep copy with fresh keys for every node (`duplicateNodes`, `drag.js:328-348`): observed keys `section`, `heading`, `paragraph` for the copy.
- Only the copy's **root** gets a new unique name (`Section 2`); its children keep the original names (`Heading`, `Paragraph`) — observed.
- DOM ids inside the copy are renamed with `-copy`, `-copy-2`… and `for`/`#fragment` references inside the copied group follow them (`drag.js:332-345`).
- Texts and styles are copied exactly.

### Undo and redo

One history entry for the whole duplication.

### Nested elements

The whole subtree is copied.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

`Ctrl+D`.

### Problems in Pager

1. **Descendants of a duplicated element keep their original names,** so the document has several `Heading` nodes that the BEM export must disambiguate later. Required: every node of the copy gets a new unique id **and** a unique name (manifest feature `duplicate`).
   The copy also gets fresh HTML `id` attributes across the project; `for` and fragment references within the copied group follow their copied targets.
2. **The Edit menu item dispatches a fake keyboard event** instead of calling the command. Required: every door calls the one duplicate command directly.
3. **Duplicating could not be part of a drag.** Required (spec drag-duplicate): element.duplicate records its step per gesture, as element.moveTo does: alone (Ctrl+D, the menus) it is one step, and inside a drag's gesture (Alt at the release) it makes one step with the move of its copies.

## elements-form-inputs-rules

This file covers the pointer and keyboard part of the entry: what happens when a person clicks into, types on, or double-clicks a form control on the canvas. The attribute rules are not gestures and are not described here. Observed by running Pager from `.cache/pager-run` (Chrome, window 1600×900) and read from its source; references are `path:line` inside Pager. Test document: Form > Input (text).

### Trigger

- Press on an input, textarea, select, button or image on the canvas: `preventDefault` on the `pointerdown`, so the control never receives focus, caret or a native dropdown; the press selects the element and arms a drag like any element (`src/app/boot.js:370-375`, `:458`).
- Controls are rendered `readonly` with `tabindex="-1"` in the canvas (observed: `readOnly: true`, `tabIndex: -1`).
- Clicks on links, buttons and labels never navigate or submit in the editor: `preventDefault` on `click` and `submit` inside the canvas outside preview (`boot.js:410-431`). Observed: clicking a Button inside a Form selected it and the URL did not change.
- **Double-click** (or Enter) on an input or textarea makes it editable: `readOnly=false`, focused, its value selected; Enter (input) or blur commits the value, Escape restores it (`boot.js:608-627`).

### Hit zones and thresholds

The control's whole box. The press threshold and drag behaviour are those of `select-click.md` and `drag-reorder-canvas.md`.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Click into the input, then type `abc` | The input is selected; no caret appears inside it; the value stays empty. The typed letters go to the canvas keymap: `c` ran **Wrap in a column** (status `Wrapped Text in a column. Column selected.`), `a` and `b` did nothing. | ![click](img/elements-form-inputs-rules--01-click-input.png) |
| Double-click, type `XYZ`, Enter | The input gets a caret and shows `XYZ`; after Enter it is read-only again. | ![double-click edit](img/elements-form-inputs-rules--02-after-double-click-edit.png) |

### Result in the document

- A click never changes the document; typed letters are canvas shortcuts (observed: the input was wrapped in a Column by `c`).
- Double-click + typing + Enter wrote the value: the node's `text` became `XYZ` (the value attribute), one history entry.

### Undo and redo

The value edit is one entry; the accidental wrap is its own entry.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Enter on a selected input starts value editing (same door as double-click).

### Problems in Pager

1. **Double-click (or Enter) lets the input take focus and text on the canvas.** Required: inputs on the canvas never take focus or text while editing; the value is edited in the Inspector (manifest feature `elements-form-inputs-rules`). Double-click on an input selects it and moves focus to its Value field in the Inspector.
2. **Typing on a selected input runs single-letter shortcuts without warning** (`c` wrapped the input). Required: keep the shortcuts (they are the canvas keymap), but when the selection is a form control the status bar hint says `Type in the Inspector's Value field to change the value`, so a person who starts typing learns why the letters did not go into the field.

## elements-lists

How Pager behaves, read from its source (this spec was written without running Pager). Source references are `path:line` inside Pager.

### Trigger

- The Elements panel's **Lists** group: Unordered (`ul`), Ordered (`ol`), Definition (`dl`), and also List item (`li`), Term (`dt`) and Description (`dd`) (`src/model/elements.js:32-38`). A click on a tile inserts the element (the rules of palette-click-insert: into a selected container, after a selected leaf, at the end of the page with nothing selected); a drag places it (palette-drag-insert).
- Items are added by duplicating an item (Ctrl+D or the context menu's Duplicate, the duplicate feature), or by inserting the List item, Term or Description tile.

### Result

- Each list tile makes an **empty** container (`src/model/templates.js:37-39`): a `ul` named **List** (its tile reads "Unordered"), an `ol` named Ordered list, a `dl` named Definition list, all with no children and no styles.
- The item tiles make empty containers too (`src/model/templates.js:40-42`): an `li` named **Item**, a `dt` named Term, a `dd` named **Definition** (its tile reads "Description").
- An item tile clicked where its list is missing is wrapped in a new list (`WRAP_IN`, `src/model/elements.js:125-127`; observed in nesting-grammar: the page root selected, List item makes a new `ul` holding the `li`). A Paragraph clicked into a list is wrapped in a new `li` (`adoptChain`, `src/model/grammar.js:70-76`).
- `ul` and `ol` accept only `li`; `dl` accepts only `dt` and `dd` (`src/model/elements.js:33-35`, `only`); `li` needs a `ul` or `ol`, `dt` and `dd` a `dl` (`src/model/elements.js:36-38`, `needs`).
- Names come from a counter per session (`src/model/templates.js:7`, `autoName`), not from the names the document holds.
- The ready-made lists with three items ("First item", "Second item", …) are templates (`src/model/templates.js:122-127`), which belong to templates-content.

### Visual feedback

| Stage | What is drawn |
|---|---|
| After a list tile click | An empty list: no marker, no text, only the canvas's minimum height for an empty container, selected with its label; the Layers row appears. |
| After an item tile click | An empty `li` (a marker with nothing beside it), or an empty `dt`/`dd`. |
| After Ctrl+D on an item | The copy right after its original; an ordered list numbers it on. |

### Undo and redo

Each insert is one undo step; each duplicate is one undo step.

### Keyboard equivalent

A focused tile inserts with Enter or Space (palette-click-insert). Ctrl+D duplicates the selected item (duplicate).

### Problems in Pager

1. **A new list is empty** (`src/model/templates.js:37-39`): an Unordered or Ordered list shows no marker and holds nothing to type into, and a Definition list holds no term; exported, it is an empty `<ul></ul>`. Required: a new list comes with its items, so it is never empty: an Unordered or Ordered list with one List item, a Definition list with one Term followed by one Description, from every door that inserts it (a tile's click, Enter or Space on it, its drag).
2. **A new item is empty** (`src/model/templates.js:40-42`): the `li` has no text, so it draws a lone marker. Required: each List item, Term and Description of a new list holds one Paragraph with the Paragraph's default text (`elements.json`: the natural child of `li`, `dt` and `dd` is the Paragraph; the same content natural-child-command gives a new `li`, its Problems in Pager 3).
3. **List item, Term and Description are palette tiles** (`src/model/elements.js:36-38`), so an item can be inserted where it cannot exist and Pager has to invent a list around it. Required: the Lists group offers Unordered, Ordered and Definition only (`elements.json` palette); an item is added by duplicating one (Ctrl+D, the context menu's Duplicate), whose copy goes right after its original, inside the same list, with a fresh name for it and for the Paragraph inside it (duplicate). No door of this feature places an item outside its list; the refusal of an item moved outside a list (`status.refused.requiresParent`) belongs to nesting-grammar.
4. **A Paragraph clicked into a list is wrapped in a new `li` without a word** (`src/model/grammar.js:70-76`), and so is a list clicked into a list. Required, as palette-click-insert (its Problems in Pager 1 and 2): an element a list does not accept is refused with `status.refused.onlyAccepts` naming the list's tag and the tags it accepts (`<ul>` and `<ol>` only `<li>`; `<dl>` only `<dt>`, `<dd>`, `<div>`), and nothing changes. A list is accepted inside a List item, a Term or a Description, so lists nest inside items.
5. **Names do not match the tiles and are counted per session** (`src/model/templates.js:7`, `:37`, `:40`, `:42`): the Unordered list is named "List", the List item "Item", the Description "Definition", and a second list is "List 2" even when the first was deleted. Required: every new node, the list and each node inside it, is named by its element label in the person's language (Unordered list, Ordered list, Definition list, List item, Term, Description, Paragraph), numbered only when the document already holds that name or an earlier node of the same insert took it (a Definition list's second Paragraph is "Paragraph 2").
6. **An empty list renders nothing a person can read on the page.** Required: the frame and the export write the standard tags (`ul`/`ol`/`li`, `dl`/`dt`/`dd`) with no style of the editor's own: the browser's defaults draw the markers (a disc for `ul`, a number for `ol`, a circle for a `ul` inside a list) and indent the Description.

## elements-structure

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- The Elements panel's **Structure and layout** group: Container, Header, Navigation, Main, Section, Article, Aside, Footer, Card and Link Block (`src/model/elements.js:11-21`, observed in the panel). A click on a tile inserts the element (the rules of palette-click-insert: into a selected container, after a selected leaf, at the end of the page with nothing selected); a drag places it (palette-drag-insert).
- The Link Block's link: the **href** text field of the inspector's Content section (`src/features/inspector/properties.js:2287`), shown for a Link Block.

### Result

- Each tile makes a container node (`src/model/templates.js:17-27`), named and styled:

| Tile | Tag | Layer name | Default styles |
|---|---|---|---|
| Container | `div` | Container | `padding: 0px` |
| Header | `header` | Header | `padding: 20px 40px; align-items: center` |
| Navigation | `nav` | **Nav** | `padding: 20px 40px; align-items: center` |
| Main | `main` | Main | `padding: 56px 40px` |
| Section | `section` | Section | `padding: 56px 40px` |
| Article | `article` | Article | `padding: 56px 40px` |
| Aside | `aside` | Aside | `padding: 24px` |
| Footer | `footer` | Footer | `padding: 20px 40px; align-items: center` |
| Card | `article` (the tile's hint says `div`) | Card | `padding: 20px` |
| Link Block | `a` | Link Block | none |

- The structure tags can be switched among each other afterwards (`src/model/tree.js:435`: div, section, header, main, footer, nav, aside, article).
- An interactive element (a link, a button, a form control, another Link Block) dropped or inserted inside a Link Block is refused with `An interactive element cannot sit inside a Link Block` (`src/model/grammar.js:47`, `:113`; `src/features/drag/drag.js:742`).
- The Link Block's href is stored as typed. Rendering and export pass it through `safeHref` (`src/model/urls.js:7-17`): a scheme other than http, https, mailto, tel or ftp becomes empty, and the export then writes `href="#"` (`src/features/export/index.js:159`). A Link Block with no href is exported with `href="#"` too.

### Visual feedback

| Stage | What is drawn |
|---|---|
| After a tile click | The new element on the canvas, selected, with its label; the Layers row appears. An empty container is drawn with the canvas's minimum height. |
| Link Block href typed | Nothing on the canvas (a link looks the same); an unsafe value is kept in the field and in the document without a word. |

### Undo and redo

Each insert is one undo step; each href change is one undo step.

### Keyboard equivalent

A focused tile inserts with Enter or Space (palette-click-insert). The href field takes the keyboard like any text field.

### Problems in Pager

1. **Card is a separate element type that is only an `article` under another name**, and its tile says `div` while it writes `article`. Required: there is no Card element type; the Structure group offers Container, Header, Navigation, Main, Section, Article, Aside, Footer and Link Block (`elements.json` palette), and cards come from templates.
2. **Navigation is named "Nav"** while its tile reads "Navigation". Required: a new element's layer name is its element label in the UI language (`Navigation`, numbered when taken, as palette-click-insert does).
3. **Header, Navigation and Footer get `align-items: center` without `display: flex`**, a declaration that does nothing and lands in the export. Required: an element's default styles are only declarations that act (the `defaultStyles` of `elements.json`: padding for the bands and bars); a Link Block is `display: block`, since it is a block link that holds other elements.
4. **An unsafe link is kept in the document and silently exported as `href="#"`**, and a Link Block without a link is exported as a link to `#`. Required: the Link field of the Settings tab (DESIGN.md `inspector-settings`, `element.setLink`) keeps a link on Enter or when the field loses focus, as one undo step, and the status bar names the element and the link (`status.link.set`); a value whose scheme is not http, https, mailto or tel is refused with `status.url.unsafe` naming it, and the document keeps its value; a Link Block with no link has no `href` (the export does not invent one).
5. **The refusal inside a Link Block is only in the drag's code path and its message names no element.** Required: every insert (tile click, Enter/Space on a tile, drag) of an interactive element (a Link Block, a link, a button, a form control) into a Link Block, or into an element inside one, is refused with `status.refused.interactiveInside` naming the Link Block, and nothing changes.
6. **An empty structure element would collapse** to no height on the canvas. Required (already true in the editor): an empty container keeps the canvas's minimum height (`canvas.emptyContainerMinHeight`), an editor aid never written into the document nor the export.

### Our rule: one rule for every address (the user's real-use audit, A3.2)

- **One owner decides what an address may be** (`src/core/elements/address.ts`, `readAddress`): every field that
  writes an address asks it — a link's `href`, a resource attribute (an image's Source, a form's action, a video's
  poster, an iframe's src), the page's own addresses (Canonical URL, Sharing image, Favicon), a background image and
  every `url(…)` inside a free declaration. No field carries a rule of its own.
- **Taken**: a relative path (`/about`, `about.html`, `img/logo.png`, `../x`), a fragment of the page itself
  (`#inicio`), a web address (`https:`, `http:`), `mailto:` and `tel:`; and a domain typed without its scheme
  (`example.com/about`), stored as `https://example.com/about` with the status naming both (`status.url.normalized`).
- **Refused with its reason beside the field**: what runs code or hands a document over inline — `javascript:`,
  `vbscript:`, `data:`, `blob:`, `file:` (`status.url.unsafe`) — and what names no address at all: a word alone
  (`nope`: no path, no extension, no scheme, `status.url.malformed`), a space inside a web address, an unknown scheme.
  The document keeps the address it had.
- **The same rule reads stored addresses** (`addressAllowed`): what the validator asks a document that arrived from a
  file, a paste or an import, so no road into the document is left unchecked (item A3.44).

### Our rule: the link picker (the user's real-use audit, item 7.4)

- **One place chooses what a link points at** (feature link-picker): the Link address field shows a choose button
  (`linkPicker.open`, ui.linkPicker keeps the node and the kind), and the picker opens over a shield with the five
  kinds as its segments (`linkPicker.setKind`: a web address, a page of the project, an element of this page — an
  anchor — an email address, a phone number), the current link shown, and the body of the kind: the address field for
  the three address kinds, the pages of the project as items (`element.setLink#link-picker-page-item`, each standing
  for one page's file), the elements of the page that carry an ID as items
  (`element.setLink#link-picker-anchor-item`). Its close button, a click on the shield and Escape (its own key context
  in the keymap) leave it.
- **Choosing a page or an element ends the choice** (the journey "site", 2026-10-01: after "Sobre" was chosen the
  picker stayed open, the click on the next link of the menu only closed it, and the next choice rewrote the first
  link): once an item sets the link, the picker closes; a typed address keeps it open until Enter, the close button,
  the shield or Escape.
- **A link to a page** stores the page's file path (what the export writes, `about.html`); **a link to an element**
  stores a reference: the fragment with the target's *node id*, and the page writes the target's `id` attribute as it
  stands (`#inicio`), so renaming the ID later leaves the link working (A3.4). An element the picker lists that has no
  ID attribute yet is given one when it is chosen.
- **Open in a new tab** says what it adds — `rel="noopener noreferrer"` beside `target="_blank"` (the field's label).

### Our rule: the references between elements (the user's real-use audit, A3.4)

- **A reference is kept by the target's node id** (`src/core/elements/references.ts`, the one owner): a label's `for`
  and a link's `#anchor`. The page's writers (the renderer and the export, through `core/files/values.ts`) resolve it to
  the target's `id` attribute at that moment, so renaming or re-numbering the ID follows in the canvas and in the site;
  a reference whose target holds no ID writes nothing.
- **The label's field shows the control it points at by name and ID** (`Button 24 · cta`), takes either when typed, and
  offers every form control of the page.
- **A delete says what it takes away and takes it away**: the message counts the references to the deleted subtree
  (`status.deleted.cited`) and the same undo step removes those `for`/`href` values, so nothing is left pointing at
  nothing; Undo gives back the element and its references together.
- **The validator refuses a project whose references name no element** and, with item A3.44, any document whose
  semantics are broken (an input type outside HTML's own, an address the one rule of an address refuses, an attribute a
  tag cannot hold): File › Open says which path and why, and nothing is opened.

## elements-svg-shapes

This file covers the pointer part of the entry: placing shapes and sizing them with the handles. Observed by running Pager from `.cache/pager-run` (Chrome, window 1600×900, clean storage) and read from its source; references are `path:line` inside Pager.

### Trigger

- Insert from the Elements panel (click or drag): **SVG/Icon**, **Rectangle**, **Ellipse**, **Line**.
- Size with the eight resize handles of the selection outline (the gesture of `resize-handles.md`).

### Hit zones and thresholds

- In Pager the **SVG/Icon is a leaf**: a fixed 32 × 32 px `<svg viewBox="0 0 24 24">` holding a triangle icon path. It cannot contain children; the model's validator rejects any tree with children under an `<svg>` ("<svg> cannot contain child nodes").
- **Rectangle, Ellipse and Line are standalone elements**, each its own `<svg viewBox="0 0 24 24">` with one shape inside, allowed in ordinary containers. Observed: with the SVG/Icon selected, clicking Rectangle placed it **after** the SVG in the Section (`Placed. Rectangle in Section, position 2 of 2.`).
- A new Rectangle is 160 × 100 px with `fill: #dbe7ff`, `stroke: #2b5fe3`, `stroke-width: 1.5px`, `border-radius: 4px` in its styles.
- The handles behave exactly as for any element: 4 px threshold, 8 px handles (`compact-handles` below 48 px — the 32 px SVG/Icon gets it), Shift/Alt/Ctrl modifiers.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| SVG/Icon selected | 32 px icon with the selection outline in compact-handle form and eight handles. | ![svg](img/elements-svg-shapes--01-click-in-svg.png) |
| Rectangle selected | Outline around the 160 × 100 px box. | ![rectangle](img/elements-svg-shapes--02-rectangle-selected.png) |
| Dragging its SE handle (+60, +40 px) | Live preview; label `Rectangle 2 · 220 × 140`. Release: `Resized to 220 × 140.` | ![resizing](img/elements-svg-shapes--03-rectangle-resizing.png) |

### Result in the document

- Resizing wrote `width: 220px; height: 140px` in the Rectangle's styles; the inner `viewBox` stayed `0 0 24 24` and the `<rect>` stayed `x=2 y=2 width=20 height=20`, so the drawing is stretched to the new box.
- The export writes one inline `<svg viewBox="0 0 24 24" role="img" aria-label="Rectangle">` per shape with its CSS class.

### Undo and redo

Insert and resize are one history entry each.

### Nested elements

Shapes cannot be nested in the SVG/Icon in Pager.

### Zoom other than 100 %

As for `resize-handles.md`.

### Keyboard equivalent

None beyond the Inspector's Size fields.

### Problems in Pager

1. **Shapes cannot go inside an SVG, and they can go anywhere else.** Required: Rectangle, Ellipse and Line are not palette items; they are added inside a selected SVG from the SVG's own controls and only go inside an SVG; moving a shape outside an SVG is refused by the nesting rules (manifest feature `elements-svg-shapes`, `nesting-grammar`).
2. **The viewBox never matches the size** (fixed `0 0 24 24`, content stretched when resized). Required: the SVG has a viewBox that matches its size; resizing the SVG updates its viewBox, and resizing a shape with its handles changes the shape's own geometry attributes (`x`, `y`, `width`, `height`, `cx`, `cy`, `rx`, `ry`, `x1`…`y2`) in the SVG's coordinate space, with the stroke width unchanged.
3. **A shape's handles resize its CSS box, not the shape.** Required: selecting a shape inside an SVG shows handles on the shape's own bounding box; dragging them rewrites the shape's attributes (stored in the document JSON and rendered/exported as `rect`, `ellipse`, `line` inside the one inline `<svg>`).
4. **An icon cannot be brought in as markup.** Required: markup typed or pasted into the SVG's markup field becomes the SVG's content, rendered and exported as written, with scripts and event attributes removed.
5. **Fill and stroke are inspector-only.** Required: the quick panel's Fill writes a shape's `fill` with the same command as the inspector.

## events-actions

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no interactions.** Its i18n catalogue holds trigger and action labels (`interaction.trigger.click`, `interaction.trigger.pointerenter`…, `interaction.action.show`, `interaction.action.hide`, `interaction.action.toggle`, `src/core/i18n.js:179-186`, `:269-271`), but no code uses them: no inspector section, stored field or export writes an interaction. Elements have no events in Pager's document.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

None in Pager.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **Elements cannot react to events.** Required (manifest feature `events-actions`):
   - An Interactions section in the inspector adds, edits and removes interactions on the selected element.
   - Triggers are click, hover (enter and leave), scroll into view, page load and form submit.
   - Actions are show, hide, toggle class, play animation, scroll to and open link.
2. **Targets and validity.** Required:
   - Targets are picked from the page or Layers, never typed ids.
   - Combinations that cannot apply (form submit on a non-form) are not offered.
3. **Storage.** Required:
   - Interactions are stored per element in the document JSON; each add, edit and remove is one undo step.
   - The editing canvas never runs them; preview and the exported page run them once they are exported as JavaScript (manifest feature `export-events-js`).
- **An interaction's card read as unfinished** (the dogfooding pass, 2026-09-30): its Applies to field stood empty when the interaction is the element's own, and Trigger and Action showed their values larger than every other value of the inspector. Required: an empty Applies to says what it means inside the field (`interactions.scope.element`, "This element"), and the card's values take the inspector's value size.
- **Trigger and Action showed their raw values** (`click`, `toggle-class`) while the card's head said "On click → Toggle class" (the dogfooding pass). Required: the two fields show their values in the editor's words and list the offered ones in words; a typed text is taken as the value it names, typed as the value itself or in its words, in any case.
- **The card had no Options row, and its "Options" field held the action's own value** (the audit's AUD-28; STG-5.10: the canonical card ends with Options, "Once · no delay"; Webflow's trigger settings carry the same play once and delay). Required: an interaction says whether it fires only the first time and how long its action waits. `once` absent is the trigger's own way — entering the screen and the page's load fire once, a click, a hover and a submit every time — and is stored only where the person chose otherwise; `delay` is in ms, 0 to 10 000, absent for none. The Options field (`interactions.update#inspector-interaction-options`, the card's last row) shows them in words ("Every time · no delay", "Once · 200 ms"), offers every time and once with no delay, 0.2 s, 0.5 s and 1 s, and takes a typed text of once or always and a duration (200ms, 0.2s, a bare number in ms), in the editor's words too (Uma vez · 200 ms); any other text is refused naming it (`status.interactions.badOptions`) and the document is unchanged. The action's own value — the class it toggles, the animation it plays, the address it opens — has its own field (`#inspector-interaction-value`) under Action, labelled Class, Animation or Address.

## explorer-assets-use

Jornada 03 correction: the shared [nonmodal layer contract](#nonmodal-layers-j8) supersedes the legacy shielding behavior described below.

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test page: Section > [Heading, Paragraph].

### Trigger

- **Image Source:** a plain text field for a URL (observed: one text input, no asset picker).
- **Dropping an image file on the canvas does nothing.** Observed by dispatching `dragenter`, `dragover` and `drop` with a `DataTransfer` holding `photo.png` (`image/png`) at a point between the Heading and the Paragraph:
  - on the shell (the target was the `IFRAME#paperFrame`) and inside the iframe (target `P`);
  - no handler called `preventDefault`;
  - the document was unchanged and no status message appeared.
- The only `drop` handler in Pager belongs to the in-place text editor and takes `text/plain` only (`src/app/boot.js:666-672`). Because `dragover` is never prevented, the page does not accept file drops at all; the browser's default handling applies.
- There are no assets to rename or delete (see `explorer-assets.md`).

### Hit zones and thresholds

None for file drops in Pager.

### Visual feedback

None in Pager: no indicator, no insertion line, no message.

### Result in the document

Unchanged.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **An Image cannot use an uploaded asset.** Required: the Image's Source field has an asset picker. Choosing an asset stores a reference to the asset in the document JSON and the canvas renders it (manifest feature `explorer-assets-use`).
2. **Image files dropped on the canvas are ignored.** Required:
   - While an image file is dragged over the canvas, the same drop indicator as a palette drag is shown (receiver tint, insertion line, label; see `palette-drag-insert.md`) at the same drop positions.
   - On drop, the file is uploaded as an asset and an Image that uses it is inserted at the indicated position, as one undo step.
3. **Renaming and deleting assets in use.** Required:
   - Renaming an asset keeps every Image that uses it working.
   - Deleting an asset in use, or a folder that holds one, asks for confirmation and lists where it is used.


### Our rule (the user's real-use audit, item 7.3)

- **The canvas draws a project file**: an attribute whose value names a file of the project (`src`, `poster`) draws as
  the object URL of its bytes, while the document keeps the path (`resolvedSource`), so what the canvas shows is the
  stored file.
- **The Source field picks files**: the images the project holds are suggested under the field, and the choose button
  beside it (`assetPicker.open`) opens the asset picker (`shell/asset-picker.tsx`) whose items
  (`element.setAttribute#asset-picker-choose`) write the field's attribute with the file's path — one undo step.
  Escape (the picker's own key context), the close button and a click on the shield leave it.
- **An image file dropped on the canvas** (`assets.insertImageFile`) is stored and placed where the drop proposal says
  (`parent` + `index`), as element.insert places an element; dropped on an image, the file becomes that image's source
  (`replace`) — the acceptance of item 7.3. The proposal the palette draws is drawn for it too (the pointer owner).
- **The export carries every file of the tree** at its path (feature export-assets), so the exported page shows its
  images, and the preview draws them from the stored bytes as the page's own data URLs (the preview frame's origin is
  opaque, where a blob: URL of the editor's origin does not load). An address a declaration names inside the stylesheet
  is written relative to it (`css/styles.css` stands one folder below the files), the way an attribute's address is
  written relative to the page that holds it, so `background-image: url("img/hero.png")` is written
  `url("../img/hero.png")` and loads. An image is never dropped for holding no address: its own alternative text is
  what a browser draws in its place, and `alt=""` draws nothing at all.

## explorer-assets

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

**Pager has no Explorer and no asset store.**

- The workspace menu reserves slots for `assets` and `explorer` (`src/features/workspace/camera.js:666`), and i18n has Assets strings (e.g. `panel.assets.empty.files`, `src/core/i18n.js:2544`).
- No such panel is registered (observed: Ctrl+K `open` lists no Assets or Explorer panel).
- An Image's `Source` is a plain text field for a URL, with no file picker and no asset button (observed on an Image: one text input, no buttons).
- Dropping a file on Pager is not handled. The only `drop` handler is the in-place text editor's, and it accepts `text/plain` only (`src/app/boot.js:666-672`).

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

Nothing is stored in Pager.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not applicable: the Explorer is outside the canvas.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No file uploads.** Required (manifest feature `explorer-assets`):
   - The Explorer uploads images and font files with the file picker and accepts image files dropped onto a folder.
   - Uploaded files are ordinary files of the file tree, stored in IndexedDB, placed in the folder they were uploaded or dropped into (img/ by default for images, fonts/ for fonts), and listed with a thumbnail for images, their name and size.
2. **Rename and delete.** Required:
   - Renaming a file changes its listed name; names stay unique per folder.
   - Deleting an unused file removes it from the tree and from IndexedDB, as an undo step.


### Our rule (the user's real-use audit, item 7.3)

- **The project holds its files in the document** (`files`): each at its path in the project, with the MIME type, the
  bytes as base64 and, for an image, the intrinsic size read when it was uploaded. The tree belongs to the document,
  so it is saved with the project (autosave, File › Save project), restored on reload and carried in the export; it has
  one owner (`src/core/files/files.ts`).
- **files.upload** (the Upload button and the folder drop): the files a chooser hands over, or an image file dropped
  onto the Explorer's Files region, land in the folder the door names or the one their type belongs to (`img/` for an
  image, `fonts/` for a font, `files/` otherwise); a name already taken gets a numeric suffix, so nothing is
  overwritten, and a file whose type is neither an image nor a font is refused
  (`status.files.unsupportedType`). One undo step; the status names the paths.
- **The Explorer lists them** with their name, path, size and, for an image, a thumbnail of the stored bytes.

## explorer-file-system

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no file explorer and no file tree.** Its i18n catalogue holds the texts of a "Files" panel (`panel.explorer.title`, `panel.explorer.action.newFolder`, `panel.explorer.action.openFolder`, `panel.explorer.prompt.move`, `src/core/i18n.js:216-228`) and the workspace menu reserves a slot for `explorer` (`src/features/workspace/camera.js:666`), but no such panel is registered (observed: Ctrl+K `open` offers no Explorer). Pager's project is one document; the only files it writes are the export and the project JSON.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

None in Pager.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable: the Explorer is outside the canvas.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No file tree.** Required (manifest feature `explorer-file-system`):
   - The Explorer shows the project's file tree (pages, CSS, JS, images, fonts) with folders: one .html per page, css/styles.css, js/interactions.js when the project has interactions (and js/forms.js, js/motion.js and js/lottie.min.js whenever the export writes them: the tree lists what the export's own writer writes, and opening one shows the text it writes), and every file the project holds.
   - Files and folders can be created, renamed, moved and deleted. Moving works by drag and drop and by a Move to… command. Names are unique per folder.
2. **Generated files and pages.** Required:
   - css/styles.css and the scripts the export writes (js/interactions.js, js/forms.js, js/motion.js, js/lottie.min.js: the export's own list, `src/core/export/paths.ts`) are generated from the document and keep fixed paths: they cannot be renamed, moved or deleted, neither can a folder that holds one of them, and creating or moving another file to one of them is refused, even before the script exists. An uploaded or imported file that arrives at one of them takes a free name beside it (js/motion-2.js), its links following it (the audit's AUD-11: js/motion.js and js/lottie.min.js were missing from the list, so a stored file there went into the archive twice).
   - Pages can be moved into folders; a page file is deleted by deleting its page, and a folder that holds a page file cannot be deleted; renaming a page file renames its page and moving it moves the page; a page stores its file name, so a renamed or imported file keeps its exact name (Contact Us.html stays Contact Us.html) while a new page still gets a file name derived from its name (about-us.html); page names are unique within each folder, and pages in different folders may share a name (about/index.html and blog/index.html); the home page's index.html cannot be renamed or moved out of the root.
3. **Safety and history.** Required:
   - Deleting a folder that holds files asks for confirmation.
   - Every operation is one undo step.
4. **Integration.** Required:
   - Clicking a page file or css/styles.css opens it in the Code panel; the tree updates when pages or files change.
   - The tree is stored with the project in IndexedDB and restored after reload.
   - File > Save project and Open project include every file of the tree.
   - The product is new, so there is no earlier saved format to open. The saved format carries a schema version from the first save (project.json in the archive and the IndexedDB record alike), and every future migration is tested on the real loading path: Open project, and the autosaved project and its saved versions when the app loads them.
5. **A file row said nothing of what the file is, nor that the editor writes it** (the audit's U-016, jornada02 pairing 4.2: an icon for every file, the generated page file like any other). Required: a code file's row shows its kind as a tag in place of the icon (HTML, CSS, JS), an image its thumbnail, any other file its icon; a file the editor writes (a page's file, the stylesheet, the interactions' script) shows a "generated" pill whose tooltip says why it cannot be deleted; a file's name is drawn in the mono type, a path.


## explorer-pages

The project's pages: the Explorer's Pages list (add, rename, duplicate, delete, switch) and the top bar's page switcher.
A duplicate opens at once and its name field takes the focus with the name selected, as a page the + adds does
(jornada03 J20). Pages made from a page and a list of names, or one per item of a collection: spec data-pages.
The manifest's feature `explorer-pages` holds the scenarios; this section holds what the switcher must do.

### Problems in Pager

1. **The top bar's page switcher drew a chevron that opened nothing** (the audit's U-011). Required: the switcher shows the page on the canvas, and a press opens the list of the project's pages (its name and its file), the page shown checked; choosing one runs `pages.switch` for it and closes the list; Escape and a press outside close it as every menu's do.
2. **A click on another page's name put it in edit and left the canvas where it was** (the dogfooding pass: only the small page icon switched pages). Required: in the Pages list only the page on the canvas has its name as an editable field; another page's name reads as text, and a click on it opens that page (`pages.switch`), its name then editable in place.
3. **The + made one page and refused the next, and what was typed after it went nowhere** (the journey "site", 2026-10-01: + then "Sobre" and Enter left a page named "Page", and Enter ran the + again: "A page named Page already exists"). Required: with no name given, `pages.add` takes the next free default name ("Page", "Page 2", "Page 3"…); only a name the person gave is refused when another page holds it. The new page's name field takes the focus with its name selected, so typing names it and Enter keeps it (`pages.rename`, its file following: "Sobre" → `sobre.html`).
4. **A renamed page's root kept its old name** (the journey "site", 2026-10-01: on the page Contato the Layers' root, the breadcrumb and the status bar read "Page 3": "Placed Form with fields in Page 3"). Required: `pages.rename` gives the page's root the new name too, unique among the pages' roots ("Contato", or "Contato 2" when another root holds it); an undo gives both back.
5. **Two copies of a page lined up newest first** (the audit's AUD-27, 2026-10-02: Home, Unidade Praia, Unidade Centro). Required: a copy (`pages.duplicate`) goes right after its page and after the copies of it that already follow it, so copies line up in the order they were made (Home, Home 2, Home 3).
- **A long page name's file ran over the name** (jornada03 plan, stage 5: `.row__meta`; "Planos de assinatura mensal e
  anual" wrote planos-de-assinatura-mensal-e-anual.html across its own row, and the Files list cut the name under its
  HTML badge). Required: a row's name, a page's file name and a file's name end in an ellipsis where the row has no
  room for them, each whole in its tooltip; a kind's badge keeps its size.

## export-bem-css

How Pager behaves, read from its source (`reference/Pager`). Source references are `path:line` inside Pager.

### Trigger

The export (spec export-zip): **Export** in the top bar, File › Export page HTML.

### Result

- Every node gets generated classes (`compileClasses`, `src/model/css.js`): a class shared by every node with the same
  declarations (`s-…`, a hash of the declarations), a key class and a paint class named after the element type
  (`src/features/export/index.js:101-162`), beside the author's classes.
- The stylesheet holds one rule per generated class; a change anywhere can renumber the shared classes.
- The file is written with the time of the export.

### Undo and redo

Exporting records nothing.

### Problems in Pager

1. **Hashed, shared classes** (`s-3f9a…`) make the CSS unreadable and change when an unrelated node changes. Required:
   an element with styles of its own gets a class in BEM form: an element outside any styled element is a block (Hero →
   `hero`); a styled element inside a block is an element of it, named after the outermost styled ancestor below the
   page, its role and never its modifier (Title inside Hero → `hero__title`, "Call to action" →
   `hero__call-to-action`); an element with an author class and styles of its own is a modifier of its first class
   (`card` named "Plano assinatura" → `card--plano-assinatura`); the author's classes are kept beside it (manifest
   feature `export-bem-css`).
2. **Unstyled nodes carry classes and rules.** Required: `css/styles.css` holds one rule per styled element and none
   for the others; no selector uses an id or a data attribute; the product name appears in no class and no rule.
3. **The same page exports to different files.** Required: two exports of the same document are byte-identical: the
   archive's entries carry a fixed time, not the time of the export.
4. **Tablet and phone styles were lost in the export** (the audit's AUD-02, 2026-10-02): the elements' rules were
   written one element at a time (its base rule, then its media rules), and merging identical bodies moved one
   element's media rule up to another's, before its own base rule, which then won at that width (Marina's sections kept
   their 64 px padding and the plans grid its three columns at 834 and 390, while the canvas drew them right). Required:
   the stylesheet writes every element's base rules first, then one media block per breakpoint in cascade order, widest
   first, each holding every element's rules for that breakpoint, as Webflow's export does; identical bodies merge only
   inside one block; a media query the breakpoints do not name is refused, never placed by guess. At every breakpoint
   the exported page has the canvas's computed styles (`tests/e2e/export-cascade.spec.ts`).
5. **Class names in the person's words and numbered** (the audit's AUD-14, 2026-10-02, Marina's export:
   `barra-de-navegacao`, `hero__coluna`, `section__sanfona` beside `hero` and `title`; `section-2`,
   `section__card-3`, `section__title-2`). Required (DEC-07, STG-6.4): a class says the element's role in the
   project's code language (`src/core/export/names.ts`): a name the vocabulary knows takes its role (Título → `title`);
   a name the editor gave, in whatever interface language, takes the editor's own name for it in the code language
   (Sanfona → `accordion`, Barra de navegação → `navigation-bar`, Coluna → `column`); a name the person typed is kept
   when the project's language is the code language (Pricing Pro → `pricing-pro`); anything else says what the element
   is (a div by its layout: `grid`, `row`, `column`, `container`; another element by its type). The same role with
   the same styles is one class across the pages; a second look of a name takes a BEM modifier that says how it looks
   beside the first one, read from its declarations at the base breakpoint (another heading level `title--h3`; a
   background `--dark`, `--light` or `--accent`; a background image; a text colour; a larger or smaller font size or
   weight; a shadow `--raised`; a border `--outlined`; more or less padding `--spacious`/`--compact`; a wider or
   narrower width; another layout), never a number; `--alt` when none of these differs, and a number only once every
   word is taken (`--alt-2`). The words are in the code language (roles.json).

## export-zip

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- **Export** in the top bar (`#bE`, wired in `src/app/boot.js:751`).
- **File › Export page HTML** (`index.html:45`, `data-file-action="export"`), which runs the same export.
- No shortcut.

### Result

- Pager downloads **one HTML file**, `page.html` (`boot.js:751-759`: a `text/html` blob clicked through a temporary link, revoked 4 s later; the diagnostics readout says `Exported: page.html`).
- The text comes from `exportHTML` (`src/features/export/index.js:166-173`):
  - `<!DOCTYPE html>`, then `<html lang dir>` from `pageLangOf` and `pageDirOf`, which fall back to `en` and `ltr` when the project never set them (`src/model/tree.js:66-76`);
  - `<meta charset="UTF-8">`, `<meta name="viewport" content="width=device-width,initial-scale=1">`, and `<title>` = the page root's layer name, or "Page";
  - the whole stylesheet inside one `<style>` element: the editor's base rules (`EXPORT_CSS`, `src/model/css.js:78-80`) and the compiled rules of the page;
  - `<body class="canvas-export-host">` wrapping the page root, which is written with its own tag (a `div` by default) and the class `canvas-export-root`.
- Every node is written with its tag (`exportNode`, `export/index.js:101-162`) and a class list made of a generated class shared by every node with the same declarations (`compileClasses`), a key class, a paint class named after the element type, and the author's classes. Text is escaped (`htmlesc`); inline runs go through `inlineToHtml`; a link goes through `safeHref` (`#` when refused).
- A hidden node is written like any other; its generated class carries `display:none!important` (`src/model/css.js:9`).
- Image sources are written as they are; no file is packed with the page.

### Visual feedback

| Stage | What is drawn |
|---|---|
| After Export | The browser's download of `page.html`; the diagnostics readout (a developer panel) reads `Exported: page.html`. The status bar says nothing. |

### Undo and redo

Exporting changes nothing in the document and records nothing in the history.

### Keyboard equivalent

None beyond File › Export page HTML through the menu's keys and the command bar.

### Problems in Pager

1. **One HTML file with the CSS inside a `<style>` element**: the stylesheet cannot be cached, edited or shared on its own. Required: the export is one archive, `site.zip`, written by the one ZIP writer, holding the page's file at its path in the project (`index.html` for the home page) and the stylesheet `css/styles.css`. The HTML links the stylesheet with `<link rel="stylesheet" href="css/styles.css">` (a path relative to the page's folder). No `<style>` element and no `style` attribute anywhere.
2. **The page is wrapped in editor scaffolding** (`<body class="canvas-export-host">`, a root `div.canvas-export-root`, the editor's base rules copied into the page). Required: the page root is the `<body>` itself (the root's tag), carrying only its own classes, and nothing of the editor reaches the files: no `data-*` attribute of the renderer (`data-node`, `data-container`, `data-hidden`), no node id written as an `id`, no editor class, no editor rule, no product name.
3. **Generated classes** (`s-…` shared by equal declarations, key classes, paint classes) make the CSS unreadable and change when unrelated nodes change. Required: an element with styles of its own gets a class derived from its layer name (lower case, words joined by `-`: Hero → `hero`); its author classes are kept as they are; an element with no styles and no author class has no `class` attribute. `css/styles.css` holds one rule per styled element, in document order, one declaration per line indented by two spaces (`  padding-top: 56px;`), a breakpoint's values in an `@media (max-width: …)` block and a state's values under its pseudo-class. The full naming (BEM element classes, name collisions, the Element chip) belongs to export-bem-css.
4. **A hidden element leaks into the page**, hidden only by a generated class. Required: a hidden element is written with the `hidden` attribute, its subtree inside it, so the exported page hides it without any CSS, as the canvas does; no `display: none` rule is written for it.
5. **The head's values are invented**: a page never given a language is declared `lang="en" dir="ltr"`, and the title is the root layer's name ("Page"). Required: `<html>` carries `lang` and `dir` only when the page settings hold them (page-properties); without a title setting, `<title>` is the page's name (the page switcher's name, "Home"). The head holds, in this order: `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>…</title>`, the stylesheet link.
6. **Nothing tells the person the export happened** except a developer readout. Required: the status bar says the site was exported and under which file name (`status.export.done`).
7. **Text** must survive as text: `&`, `<` and `>` in a text are written as `&amp;`, `&lt;` and `&gt;`, `"` in an attribute value as `&quot;`, and a line break kept in a text (`\n`, text-edit-inline) is written as `<br>`.
8. **The exported page must look like the canvas.** Required: opened in Chrome, every element of the exported page has the same computed styles as on the canvas, apart from editor-only aids (the minimum height of an empty container, the selection chrome); a browser test opens the exported files and compares.
9. **The export's line breaks drew spaces the canvas does not** (the journey "site", 2026-10-01: in the exported contact form each label's text stood 5 px further from its field, and every later field and the button moved right; the canvas, built without whitespace, drew none, and item 8's test compared styles, not places). Required: an element with two neighbouring children that run on in the line (HTML's phrasing content: a span and an input, two links, two images) is written whole on one line, `<label><span>Name</span><input></label>`, so no whitespace parts them; an element that lays its children out as a flex or a grid in every layer of its own styles, or whose children are blocks, keeps one element per line, indented.

## floating-panels

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

Pager has two panel-window systems:

- **Elements and Layers** ("independent panels", `src/features/windows/index.js:259-799`): press on a panel's bar (title or tab) and drag (`drag`, `:589-791`). Threshold **4 px** (`:662`).
- **Every other panel** (Inspector tabs, workbench tools, code): press on the panel header (`data-panel-drag`) and drag (`panelWindowDrag`, `:142-165`). Threshold 4 px.

`Escape` during either drag cancels and restores the previous arrangement (`:648-650`, `:163`).

### Hit zones and thresholds

Elements/Layers drag (`:708-753`):

| Pointer position | Drop |
|---|---|
| within **12 px** of the workspace frame's left, right, top or bottom edge (and not over a panel header) | dock to that edge (a new edge dock if none existed) |
| over another panel's header (its top 26 px) | combine as tabs, inserted before the tab under the pointer (see `panel-combine-tabs.md`) |
| over another panel's body | stack above (upper half) or below (lower half) |
| anywhere else | float at the drop point |

Other panels (`:154-160`): within **80 px** of the window's left or right edge → `Dock left` / `Dock right` (a text hint covering the dock area); over another panel → `Combine as tabs` (upper 45 %) or `Stack panels`; elsewhere → floating window.

Floating windows are kept inside the viewport: 240-280 px wide, 180-520 px tall, top ≥ 44 px (`:31-35`, `:247-251`); a floating Elements/Layers group gets eight resize handles (`:551-552`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging the Layers bar over the canvas | The panel follows the pointer (translated, semi-transparent to pointer events, z-index 300); no hint while over the canvas. | ![dragging](img/floating-panels--01-dragging-layers.png) |
| Released | A floating Layers window (280 × 360 px) at the drop point, with its own bar and `×`. | ![floating](img/floating-panels--02-floating.png) |
| Near the right edge | A **3 px accent line** along the right edge of the workspace (no text). | ![right hint](img/floating-panels--03-right-edge-hint.png) |
| Released there | Layers docked in a new right dock. | ![docked right](img/floating-panels--04-docked-right.png) |

### Result in the document

Never changes the document. The arrangement is saved in preferences (`workspace.independent-panels.v1`, observed after each drop) and restored after reload.

Observed sequence: float at (772, 284.5) → right edge → `edge: "right"` → left edge → `edge: "left"`; a further drag cancelled with Escape left the stored arrangement byte-identical.

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

Canvas zoom does not affect panels.

### Keyboard equivalent

None (panels can only be moved with the pointer).

### Problems in Pager

1. **For Elements and Layers the edge hint is a 3 px line with no words.** Required: near the left or right edge a `Dock left` / `Dock right` hint appears, and release docks the panel there (manifest feature `floating-panels`), the same for every panel.
2. **Two different panel-window implementations** with different thresholds (12 px vs 80 px edges), hints and limits. Required: one workspace owner and one drag behaviour for every panel.
3. **Edge docking can create top and bottom docks** for Elements/Layers (12 px from the top or bottom edge), which the layout does not otherwise expect (the manifest intent lists left dock, right dock and the bottom workbench). Required: panels dock to the left dock, the right dock, or the bottom workbench, and nowhere else.
4. **A floating panel had no way back but a drag to the edge** (jornada03 plan, stage 5: the floating window's header
   with its name, a dock button and ×). Required: while a panel is away from its place (floating, or docked right), its
   header draws **Put back in its place** before Close (`workspace.movePanel#panel-header-dock`, to the left dock: a
   sidebar view or section returns to the sidebar, a dock panel to the dock's tabs); in its place the button is not drawn.

## gradient-editor

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test element: a Section. The editor is `ppGradient` (`src/features/inspector/properties.js:1351-1525`), shown in Paint → Gradient (`data-prop="background"`).

### Trigger

- **Add a gradient** (shown with `No gradient` while there is none) writes the default `linear-gradient(135deg, #4f46e5 0%, #22d3ee 100%)` and shows the editor (`properties.js:1371-1374`, `:1418-1425`).
- **Type:** segmented `Linear | Radial | Conic` (`:1376-1382`).
- **Stops:**
  - Each stop is a round button under the bar (`grad__stop`, `aria-label` "Stop N, at P per cent").
  - Press a stop and drag horizontally to move it (`startDrag`, `:1501-1512`).
  - Press an empty spot of the bar to add a stop there (`:1513-1517`).
  - Release a dragged stop far from the bar to remove it (`:1509`).
- **Fields and buttons:**
  - `Stop colour` opens the colour picker for the selected stop (`:1518-1519`).
  - `Position` is 0–100 % (`:1390-1392`).
  - `Angle`, in deg with a scrub glyph, is hidden for Radial (`:1395-1397`, `:1432`).
  - Footer: `Reverse the stops`, `Distribute evenly`, `Add a stop` (at 50 %), `Remove this stop` (`:1402-1412`), and the CSS read-out.
  - `Reset` in the header removes the gradient (`:1358`).

### Hit zones and thresholds

| What | Value | Source |
|---|---|---|
| Bar | 267 × 34 px (full Inspector width) | measured |
| Stop handle | 12 × 12 px, centred 33 px below the bar's centre line | measured |
| Stop drag | offset = (pointer x − bar left) / bar width × 100, clamped 0–100, starts on pointerdown | `:1506` |
| Drag-off removal | on release, if \|pointer y − bar centre y\| > **46 px** the stop is removed (only when more than 2 stops) | `:1509`, `:1495` |
| Minimum stops | 2 (`removeStop` refuses below) | `:1495` |
| New stop colour | copies the colour of the nearest stop at or before the click position | `:1487-1491` |
| Stop keys | ArrowLeft/ArrowRight ±1 %, Shift ±10 %; Delete/Backspace removes | `:1466-1471` |

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| No gradient | `No gradient` and `Add a gradient`. | ![empty](img/gradient-editor--01-empty.png) |
| Added | The bar paints the gradient over a checkerboard; stops under it (selected stop ringed); type, stop colour, position, angle, footer with the CSS read-out. | ![added](img/gradient-editor--02-added.png) |
| Dragging a stop | The stop follows the pointer; the bar, the read-out and the canvas update live (observed 100 % → 67 %). | ![drag](img/gradient-editor--03-dragging-stop.png) |
| Stop added by clicking the bar | A new stop at the click position (observed 40 %), selected. | ![add stop](img/gradient-editor--04-stop-added.png) |
| Dragging a stop off the bar | **Nothing changes on screen:** the stop stays at its last position and gives no sign that releasing will delete it. | ![off](img/gradient-editor--05-dragging-stop-off.png) |

### Result in the document

- Every change writes the **`background` shorthand** of the node: `linear-gradient(135deg, #4f46e5 0%, #22d3ee 100%)`, `radial-gradient(circle at 50% 50%, …)`, `conic-gradient(from 180deg at 50% 50%, …)` (observed in the stored styles). The iframe's computed `background-image` matches it.
- Because it is the shorthand, it **resets the element's background colour**: with `backgroundColor: #fde68a` stored, adding a gradient left the stored colour in place but the computed `background-color` became `rgba(0, 0, 0, 0)`; Reset brought it back (observed).
- Switching type changes the angle: Linear 135deg → Radial → Conic (`from 180deg`) → Linear gave `180deg` (observed).
- Reverse mirrors the positions (0/40/67 → 33/60/100); Distribute spreads them evenly (0/50/100).
- Position 150 + Enter: refused silently (max 100).
- Reset removes the `background` value (observed: computed `background-image: none`).

### Undo and redo

- Each change is one undo step: a stop drag (the whole gesture), a bar click, a type switch, the angle, Reverse, Distribute, a picker Apply (observed with Ctrl+Z / Ctrl+Shift+Z on the stop colour).
- Escape during a stop drag cancels it (the Inspector gesture, `properties.js:619-621`).

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the editor is in the Inspector).

### Keyboard equivalent

Stops are buttons with key handling: ArrowLeft/ArrowRight ±1 % (Shift ±10 %), Delete/Backspace removes the focused stop (observed with the stop focused: Delete removed stop 2; with two stops left it did nothing, and the canvas selection was not deleted). But the stops have `tabindex="-1"` (the region seal, see `keyboard-panel-navigation.md`), so Tab never reaches them. There is no key to add a stop other than the `Add a stop` button.

### Problems in Pager

1. **The gradient is written to `background`, which erases the background colour.** Required: the gradient is written to `background-image` only; `background-color` is kept and shows under a transparent gradient; removing the gradient takes the `background-image` declaration away, so the element shows its default again (`none`) and the export holds no dead declaration (manifest feature `gradient-editor`; the removal is `removeStyle`, see Our rule).
2. **Dragging a stop off the bar deletes it with no warning,** and the limit (46 px from the bar centre, only 13 px below the stop row) is easy to cross by accident. Required: while the pointer is beyond the removal distance, the stop is drawn detached and faded with a "Release to remove" hint; moving back cancels the removal.
3. **Switching the type changes the angle** (135deg became 180deg after Linear → Radial → Conic → Linear). Required: each type keeps its own angle when switching; switching back restores it.
4. **A new stop copies the colour of the stop before it,** which changes the look of the gradient (a flat band appears). Required: a new stop takes the colour the gradient already has at that position, so adding a stop does not change the rendering.
5. **Gradient changes have no single writer that other controls reuse.** Required: every gradient change is written by one command, which the quick panel's Fill (the same fill editor) also uses (manifest feature `gradient-editor`, `quick-panel`).

### Our rule (the user's real-use audit, item A3.31)

- **Remove the gradient takes the declaration away.** The door hands `style.setBackgroundImage` the edit `reset`, and
  the command handles it before reading any other edit: the property leaves the styles of every selected element
  through the one owner of taking a declaration away, `removeStyle` (`src/core/style/reset.ts`). The document and the
  export hold no `background-image` at all, never a `background-image: none` left in its place; the colour under the
  gradient stays. The status bar names the reset, not a write, and the change is one undo step.

### Our rule: the background layers (the user's real-use audit, item A3.34)

- **A background image holds several layers** (`core/style/codecs.ts` `splitLayers`, read by the image codec): the
  commas outside parentheses part them, each a gradient the browser checks or an image address of the page, none of them
  `none`. The gradient editor edits the first layer that is a gradient (`gradientLayer`), the layers around it keeping
  their order; **Add a gradient** prepends one over them, so an image added first stays under the gradient the person
  adds next; **Remove the gradient** takes the gradient's layer away and leaves the rest, and only when nothing is left
  does the declaration itself go (the command keeps `removeStyle` for that).

## guides-manual

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Press on the **top ruler** and drag down: a **horizontal** guide (axis `y`) is created at the press and follows the pointer; press on the **left ruler** and drag right: a **vertical** guide (axis `x`) (`src/features/rulers/index.js:372-382`, `beginGuideDrag` `:292-368`).
- Press on an existing guide and drag: moves it (`:384-395`). Locked guides do not move.
- With a guide active (last created, moved or clicked): `Delete`/`Backspace` removes it, `L` locks/unlocks it, arrows move it by 1 px (Shift 10 px) along its axis, `Escape` deactivates it (`:396-422`).
- Clicking the value label on a guide opens a typed field (`:227`).
- `Escape` during a guide drag cancels; a newly created guide is then removed (`:314-335`, `:396-399`).

### Hit zones and thresholds

- No drag threshold: the guide appears on press.
- The guide line is 1 px; its value label sits at the ruler end.
- Values are page CSS px = (pointer − page edge) ÷ zoom, clamped to 0 … page width/height (`:260-270`). **A guide dragged onto its ruler is clamped to 0, not deleted** (observed: the vertical guide dropped on the left ruler became `x: 0`).
- With Snap on, a guide being dragged snaps to page edges/centre, element edges, other guides and grid lines within the snap distance; Ctrl suspends (`:301-311`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging from the top ruler | A 1 px accent horizontal line across the canvas with a value chip at its left end (`170`), the guide marked active. | ![drag](img/guides-manual--01-drag-from-top-ruler.png) |
| Two guides | Horizontal guide `170` and vertical guide `270` (value chip at its top end). | ![two](img/guides-manual--02-two-guides.png) |
| Vertical guide dragged onto the left ruler | It stays at `0` on the page's left edge. | ![onto ruler](img/guides-manual--03-vertical-dragged-onto-ruler.png) |

### Result in the document

- Guides are stored per page in the project as `{o: "h"|"v", at, locked}` (`:172-188`) through `editProject`, once per completed gesture; they are never exported.
- Observed sequence: create `y:170`, create `x:270`, move the horizontal guide +60 px → `y:230`, drag the vertical guide onto its ruler → `x:0`, Delete → only `y:230` left.

### Undo and redo

Guide changes are project edits: Ctrl+Z after the Delete restored the `x:0` guide (observed).

### Nested elements

Not applicable.

### Zoom other than 100 %

Values are page px; the guide stays on the same page coordinate at any zoom.

### Keyboard equivalent

Arrows / Shift+arrows move the active guide, Delete removes it, L locks it; the Guides & Grids panel adds a guide at a typed position.

### Problems in Pager

1. **Dropping a guide on its ruler does not delete it** (it is clamped to 0). Required: a guide released over its own ruler is deleted (manifest feature `guides-manual`); the ruler shows a delete hint while the guide is over it.
2. **A guide appears on press, before any movement,** so a click on a ruler creates nothing but flickers a guide. Required: the guide is created after 4 px of movement out of the ruler (the shared drag threshold).
3. **The guide keyboard handler captures arrows, Delete, Backspace, L and Escape globally while a guide is active,** even when the person has moved on to the canvas selection (it deactivates only on a press outside rulers and guides). Required: guide keys act only while the guide has focus; the canvas keys work as usual otherwise.
- **A guide thrown past its ruler stuck at 0** (the dogfooding pass, 2026-09-30): carried out of the canvas beyond its ruler (onto the toolbar above the top ruler), a guide was clamped to the page edge and stayed. Required: a guide released over its own ruler **or past it** (above the top ruler's bottom edge, left of the left ruler's right edge) is deleted, and the ruler shows the delete hint while it is there; a new guide is made only once the pointer has left the ruler onto the page.

## hand-keyboard-move

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph], and a Container after the Section.

### Trigger

- `M` with the canvas focused and exactly one element selected takes it into the hand (`src/features/input/index.js:758-759`, `takeIntoHand` `:136-149`). The Page root, locked and hidden elements are refused.
- While something is in the hand, the canvas keymap is replaced by the hand keymap (`src/app/boot.js:566`, `input/index.js:694-705`):

| Key | Action |
|---|---|
| ArrowDown or ArrowRight | aim at the next insertion slot in document order (`moveAim(1)`) |
| ArrowUp | climb one receiver level (`climb(1)`): the aim moves to the **end** of the next containing ancestor |
| ArrowLeft | descend one receiver level (`climb(-1)`) |
| Enter | place the element at the aim (same commit as a drop, `commitHand` `:173-184`) |
| Escape | drop the hand; nothing changes (`dropHand` `:166-172`) |

- Other doors: selection bar "take into the hand", Arrange menu "Take into the hand".

### Hit zones and thresholds

- The slots are every legal `(container, index)` in reading order, skipping the element's own subtree and locked containers (`input/index.js:49-61`). The first aim is the element's current slot.
- Each aim is validated with the drop validator; a refused aim is announced with `Refused. <reason>` and Enter does nothing (`:63-72`, `:176`).
- The ladder is the list of containing ancestors of the current aim; `Level N of M` counts it (`:84-94`).
- `moveAim` clamps at the last slot; there is **no key that moves the aim backwards** (no binding calls `moveAim(-1)`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After `M` on the Heading | The same indicator a mouse drag draws (receiver tint, insertion line, label chip) at the Heading's own slot; the receiver's row in Layers is marked; status `Holding Heading. Arrows aim, Enter places, Esc drops. Section will receive. Position 1 of 2. Level 1 of 2.` | ![after M](img/hand-keyboard-move--01-after-m.png) |
| ArrowDown, ArrowUp, ArrowLeft | ArrowDown → `Section will receive. Position 2 of 2. Level 1 of 2.`; ArrowUp → `Page will receive. Position 3 of 3. Level 2 of 2.`; ArrowLeft → `Section will receive. Position 2 of 2. Level 1 of 2.` The label chip shows `Move to position 2 · Section · after Paragraph`. | ![aimed](img/hand-keyboard-move--02-aimed.png) |
| Enter | The Heading moves after the Paragraph; status `Placed. Heading in Section, position 2 of 2.` | ![placed](img/hand-keyboard-move--03-placed.png) |
| Escape (other attempt) | The indicator disappears; status `Dropped. Nothing changed.`; the document is byte-identical (observed). | — |

### Result in the document

Observed: `Section > [Heading, Paragraph]` → after `M`, ArrowDown, ArrowUp, ArrowLeft, Enter → `Section > [Paragraph, Heading]`.

### Undo and redo

Enter is one history entry (the same transaction as a drop). Escape adds none.

### Nested elements

ArrowUp can climb up to the Page; ArrowLeft goes back down the same ladder only.

### Zoom other than 100 %

The indicator is drawn on the zoomed canvas like a drag indicator; keys are unaffected.

### Keyboard equivalent

This is the keyboard counterpart of drag and drop.

### Problems in Pager

1. **The aim cannot move backwards.** ArrowDown and ArrowRight both step forward and ArrowUp/ArrowLeft change level, so an earlier slot is only reachable by dropping the hand and starting again. Required: keep the the manifest intent keys (ArrowDown/ArrowRight next position, ArrowUp climbs a receiver level, ArrowLeft descends) and add one binding in the keymap owner that aims at the previous position, listed in the shortcuts panel.
2. **ArrowUp jumps to the end of the ancestor** rather than to the slot right after the current receiver, which is where "one level out" lands during a mouse drag. Required: climbing aims at the slot right after the current receiver inside its parent, the same result as ArrowUp during a mouse drag (see `drag-level-keys-escape.md`).

## hide-element

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Paragraph, Paragraph 2].

### Trigger

- The eye button at the right end of a Layers row (24 × 28 px, title `Hide` / `Show`; `src/features/layers/layers-panel.js:334`, `toggleNodeFlag` `:722-733`).
- The selection bar's "hide/show" button (`src/app/boot.js:339-341`).
- No shortcut. Hiding is refused inside a locked ancestor.

### Hit zones and thresholds

The eye button only. A click on the rest of the row selects the row and scrolls the canvas to the element (observed: a click that missed the eye by a few pixels selected the row instead and scrolled the canvas).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Paragraph hidden | The row gets the `hidden-layer` class (dimmed), the eye button stays pressed with title `Show`. In the iframe the element gets `display: none` and Paragraph 2 moves up into its place. **No status message** from the Layers toggle. | ![hidden row](img/hide-element--01-hidden-row.png) |
| Hidden Paragraph selected from Layers | The canvas shows **no outline**; the selection chip is built with a `hidden` flag (`hidden<p>Paragraph`) but the frame is not drawn (`src/features/selection/selection.js:213-230`). | ![hidden selected](img/hide-element--02-hidden-selected.png) |

### Result in the document

`hidden: true` on the node in the document JSON; computed `display` in the iframe `none` (observed). Showing it again removes the flag and restores the layout exactly (observed: Paragraph 2 returned to its previous position).

Hidden elements are not drop receivers and cannot be dragged on the canvas (`src/features/drag/drag.js:452-455`, `:1355-1363`); in Layers a hidden element can be dragged (`allowHidden`, `boot.js:485`).

### Undo and redo

Both hide and show are history entries: Ctrl+Z after hiding restored the visible state, Ctrl+Shift+Z hid it again (observed).

### Nested elements

Hiding a container hides its subtree.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **A hidden selected element shows nothing on the canvas,** so the person cannot tell where it is. Required (changed by the user's real-use audit, A3.11: the dashed outline drawn on the nearest shown ancestor covered the whole page): a hidden selected element, hidden itself or inside a hidden element, has no box on the page, and the canvas draws nothing for it, neither outline nor label; its Layers row, selected and dimmed with its Hide pressed, says where it is. Shown again, its outline and label are drawn on its own box.
2. **Toggling from Layers says nothing.** Required: the status bar reads `Hidden: <name>` / `Visible: <name>` for every door.
3. **The eye did not say it hides the element on the published page too** (the user's real-use audit, A3.11): the export writes the `hidden` attribute. Required: the Layers eye is named "Hide on the published page" (its label and tooltip); the export keeps the element with `hidden`.

## hover-measure

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test page: Section > [Container 300 × 80, Container 2 300 × 80 with `margin-top: 24px`].

### Trigger

- Pager measures while **Ctrl** (or Meta) is held and the pointer is over an element (`src/features/spacing/handles.js:472-487`, wired by `initMeasureHover`, `src/app/boot.js:817`). Pressing Ctrl over an element shows the measurement at once; releasing Ctrl hides it.
- A plain hover measures nothing, and Alt does nothing (observed: no lines, no size label).

### Hit zones and thresholds

What is measured for the hovered element (`measureHover`, `handles.js:353-362`):

| Measurement | Rule | Source |
|---|---|---|
| Size | the hovered element's box, rounded to whole px | `measureSize`, `:323-326` |
| Inside | distances from the hovered element to its **parent's** four edges (top, bottom, left, right), drawn at the element's centre lines | `measureInside`, `:328-338` |
| Between | when something else is selected, the gap between the hovered element and the selection on each axis where they do not overlap | `measureBetween`, `:340-351` |
| Values | screen px divided by the canvas scale, rounded, so they are CSS px at any zoom | `measurementDisplayValue`, `:389` |

The Page root is never measured (`handles.js:429`). The parent distances are also handles: dragging one sets that side of the parent's padding (`mhDown`, `:458-465`, `mhRelease`, `:466-470`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Ctrl held over Container 2, nothing selected | A size chip `300 × 80` at the element's top-left, and four dashed accent lines to the Section's edges, each labelled: `160px` (top), `56px` (bottom), `40px` (left), `1052px` (right). | ![ctrl hover](img/hover-measure--01-ctrl-hover.png) |
| Container selected, Ctrl held over Container 2 | The same lines, plus a line between the two boxes labelled `24px`. | ![to selection](img/hover-measure--02-distance-to-selection.png) |

At 50 % zoom the labels were identical (`300 × 80`, `160px`, `56px`, `40px`, `1052px`), so the values are CSS px.

### Result in the document

Measuring changes nothing. Dragging a parent-distance line changes the parent's padding, which is outside this entry.

### Undo and redo

Nothing to undo for a measurement.

### Nested elements

The inside distances always refer to the hovered element's direct parent.

### Zoom other than 100 %

Values are CSS px at any zoom (observed at 50 %).

### Keyboard equivalent

Ctrl is the modifier; there is no keyboard way to pick the measured element.

### Problems in Pager

1. **The modifier is Ctrl, which the new app uses for Ctrl+click toggling.** Required: hovering an element always shows its size (W × H in CSS px) next to its hover outline, and holding **Alt** shows distances (manifest feature `hover-measure`).
2. **Distances are measured to the hovered element's parent, not from the selection.** Required: with a selection, holding Alt over another element draws distance lines between the nearest edges of the selection and that element, each labelled in CSS px; over an ancestor of the selection it shows the distances from the selection to the ancestor's inner edges.
3. **A measurement line is also a padding handle,** so a measuring gesture can change the document. Required: measuring never changes the selection or the document JSON.
4. **The hovered element's size chip was drawn over the selection's label** (jornada03 J16: a button's label below it and
   its section's "1440 × 246" one over the other). Required: where the chip under the hovered element's bottom-left
   corner would meet the selection's label, it stands under the bottom-right corner instead.
5. **The measure ran while the contract said "not available yet"** (the audit's AUD-17, 2026-10-02: the canvas drew the hover size and Alt's distances, and the feature had no scenario and no tooth proof). Required: hover-measure is built, its code its own module (`src/editor/canvas/hover-measure.ts`, the tooth proof's `toothProof`); the size a hover shows is the page's own layout of the element in CSS px, rounded (coordinates.ts `nodeSize`, never the screen box divided by the zoom, which drifts by a pixel with the zoom); its scenarios rest the real pointer on a node (`expect.hover`: its centre or inside its top-left corner, Alt held or not) and read the chip and the distances (regions `canvas-hover-size`, `canvas-distance`), at 100 % and 50 %; and inventory:check fails while a feature that is not built has a module the app imports.

## html-import

Jornada 03 J3: file, ZIP and folder import first offer three destinations: new pages (default), inside the selected container, and replace the whole project. New pages retain all authored pages and use unique source filenames; a pristine empty project reuses its blank placeholder. Inside import inserts each body as a container preserving its styles and contents. Only replacement asks an explicit destructive confirmation. Imported classes and asset paths are isolated on collision, references follow the renamed paths, scripts remain inert in the editor, and the entire operation is one undo step. Folder-relative paths are retained.

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- None. Pager has no HTML importer: the File menu's comment says "Importing HTML is not a current capability" (`index.html:40-43`). Only a project file (`File › Open project`, `project.json`) brings a document in.

### Result

- Nothing. There is no door that reads HTML.

### Visual feedback

None: no control, no message.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not applicable.

### Keyboard equivalent

None.

### Problems in Pager

1. **No HTML import.** Required (manifest feature `html-import-structure`): File › Import HTML (and the command bar) opens the browser's file picker, reads the picked `.html`, and each supported tag becomes the matching element type in the document JSON with its text, inline marks and supported attributes (`href`, `src`, `alt`, `type`, `name`, …); element names come from BEM classes when present, else from the element type; the import replaces the page and is one undo step; a ZIP among the picked files is read as a whole, its entries standing for the files it holds.
2. **Import cleaning.** Its requirement is the section of its own feature: spec `html-import-cleaning`.
3. **The styles of the imported page.** Its requirement is the section of its own feature: spec `html-import-styles`.
4. **Media queries.** Its requirement is the section of its own feature: spec `html-import-media-queries`.
5. **Pseudo-class rules.** Its requirement is the section of its own feature: spec `html-import-states`.
6. **Exported pages import back.** Its requirement is the section of its own feature: spec `html-import-roundtrip`.
7. **Pasted HTML from outside.** Required (manifest feature `clipboard-paste-external`, spec clipboard-paste-external): pasted `text/html` goes through the same importer and the same nesting and cleaning rules and is inserted into the selection as one undo step; scripts in pasted HTML are not kept, a pasted fragment having no page to keep them with; plain text becomes one Paragraph per line; anything the importer drops is reported in the status bar. (Chrome's own clipboard already leaves a `<script>` and an `on…` attribute out of the HTML it hands back; what reaches the importer through a paste is what the platform kept, and the importer's cleaning applies to that.)
8. **The design tokens and the classes no element used were lost on the way back** (the audit's AUD-05, 2026-10-02): `:root { --brand: #0b7f72 }` came back as "rules not mapped" (every `var(--brand)` lost its definition), and `.accent` or the variant `.plan--gold` were dropped without a word. Required (`html-import-roundtrip`): a `:root` rule of custom properties alone, outside any @media, becomes the project's variables, each with its kind read from its value (a colour), else from where the sheets use it (only in font sizes: a font size), else a length; a value of no such kind is reported with its line. A class rule no element lists is a class of the person's and becomes a project class. The report names both ("Variables kept from the stylesheet: brand.", "Classes no element uses kept: accent."). Imported as a page or inside an element, a variable the project already holds as it is goes once, and one whose name the project uses for another value takes a free name (`brand-2`), its uses following it. Every fixture exported and imported back keeps its pages, declarations, variables and classes (`src/core/import/roundtrip.test.ts`).
9. **A class of the person's that one element alone listed last came back as that element's values** (found by the canonical fixture, 2026-10-03): the export writes `class="card card--featured"` both for a variant the person made and for `card` plus the class it makes for the element's own styles, so `card--featured` was read as the element's own and left the project's classes. Required (`html-import-roundtrip`): the exported stylesheet heads the person's classes with `/* Classes */` and the elements' rules with `/* Elements */`; a class whose rule sits under the first heading comes back a class of the project, whatever its uses. A sheet without the heading (written elsewhere, or edited) is read as before.
10. **An element's animations were lost on the way back, and two of them played as one** (found by the canonical fixture, 2026-10-03, AN2 and AN3): the import dropped the @keyframes and the animation properties, and the export wrote each animation's own set into the one rule, so the last one won. Required: an element's animations are written as each animation property's list in one rule (animation-name: a, b), and the import reads them back from the element's own rule and the sheets' @keyframes, each setting the list's item at its place, each keyframe's declarations as a style layer's.

### Format of the four doors

- The door is `project.importHtml` (File › Import HTML, the command bar), one picker, several files at once: an HTML page, the stylesheets it links, its images, its scripts, or a ZIP of them.
- The command's argument is the picked files (name and bytes); the door reads them and expands an archive into its entries before the command runs, so the handler stays a pure function of the document and the files.
- The report shows in the status bar, as a message naming what was imported and, per kind, the source lines: scripts kept, event handlers removed, unknown elements unwrapped, elements repaired, elements dropped, stylesheet rules not mapped, declarations not stored, linked stylesheets not picked.

## inspector-add-property

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container in the essentials mode.

### Trigger

- The **+** button of the inspector's header (`ppIconButton({glyph:'plus', … label:t('inspector.addProperty') …})`, `src/features/inspector/properties.js:2807`) opens the property picker (`ppOpenPicker`, `:2638`; `propertyPickerOpen`, `:655-700`).
- The picker lists the properties not drawn now, grouped by section, each with its label and CSS name (`:686-692`), filtered by what is typed in its field (`propertyPickerMatches`, `:673`), at most 40 (`:673`); `None` when nothing matches (`:675`).
- Choosing one closes the picker and adds the property to the fields drawn (`ppAdded`, `:2636`), which reveals it (`ppReveal`, `:3475`).

### Hit zones and thresholds

Not applicable: the picker is a list of buttons.

### Visual feedback

The field appears in its section, and takes the focus.

### Result in the document

Nothing until a value is typed in the field.

### Undo and redo

Choosing a property is not recorded.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The picker's field keeps the focus: typing filters, arrows move the marked item, Enter chooses it.

### Problems in Pager

1. **An added property is forgotten on the next selection** (`ppAdded.clear()`, `:2750`). Required: the property just added stays drawn until another is added or it holds a value (a property with a value is always drawn).
2. **Choosing a property is no command:** nothing else (the command bar) can reveal a field the same way. Required: choosing one runs `inspector.reveal`, the one command that shows a field and gives it the focus.
3. **The list's filter did not take the focus, and a property chosen showed nothing** (the user's real-use audit, item 1.3: the text typed after "+" went to Padding top; choosing "Text shadow · text-shadow" added no field). Required: opening the list gives its filter the focus; Enter there chooses the first property listed; the list offers only the properties that apply to the selection and that the tab does not draw yet; the property chosen is drawn in its section and its field takes the focus (the text shadow: its text field, shadow-editor Problems in Pager 4).
4. **The list could not be closed like the other menus** (found in the block 1 real-use pass: Escape in its filter left it open, so the next press elsewhere only closed it). Required: the list is closed as every menu is (DESIGN.md "Overlays"): Escape (`ui.dismiss`) and a press outside it (the overlay backdrop) close it, and the focus goes back to the **+** button. Its filter is a combobox in the `menu` key context, as the command bar's field is: the focus stays in it while the arrows move the marked property (the first one listed is marked as the list changes) and Enter chooses the marked one (`focus.activate`), which is what "Keyboard equivalent" above asks.
5. **The + button was invisible until the search line was hovered, though it took the Tab; and the list said "Every property is shown." both when nothing was hidden and when the filter matched nothing** (the audit's S-004). Required: the **+** is drawn at rest, at the search line's end; the list says "Every property is shown." only while the tab hides none (All properties), and a filter that matches none of the hidden properties says so with the text typed ("No hidden property matches …").

## inspector-advanced-mode

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Paragraph.

### Trigger

- The inspector's foot holds one button that switches between **Essentials** and **Advanced** (`ppFoot`, `src/features/inspector/properties.js:3469-3474`).
- Essentials (`ppMode = "relevant"`, the default, `:2616`) shows the properties of `PP_ESSENTIAL` (`:2629-2634`: display, flex and grid basics, position, spacing, width, height, object fit, background, border, font family, size, weight, line height, letter spacing, text align, colour, opacity, box shadow), the ones added through the picker, the pinned ones and those with a value set on the element (`ppEssential`, `:2636-2637`).

### Hit zones and thresholds

Not applicable: the control is a button of the inspector.

### Visual feedback

The Style tab draws its sections again with the fields the mode shows.

### Result in the document

Nothing: the mode only changes what the inspector draws.

### Undo and redo

Not recorded.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The button is keyboard-operable.

### Problems in Pager

1. **The mode is forgotten on every selection** (`if (!sameNode) { … ppMode = "relevant" … }`, `:2750`) and after a reload. Required: the chosen mode is an editor preference, kept across selections and reloads; a fresh profile shows every property (All properties is the default).
2. **One button whose label is the other mode** (`t(ppMode==='all'?'workspace.essentials':'workspace.advanced')`, `:3472`), so it never says which mode is on. Required: two segments, Essentials only and All properties, the current one pressed.

## inspector-number-fields

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test element: a Container (`div`) with `width: 300px; height: 120px`. One field component, `ppNumberField` (`src/features/inspector/properties.js:870-1018`), is used for Width, Height and every other length (spacing, radius, shadow X/Y/blur/spread, gradient angle and stop position).

### Trigger

- **Typing:** the input is `type="text"`, `inputmode="decimal"`, `role="spinbutton"` (`properties.js:887-891`, `:979-982`). Enter commits (`:976`); leaving the field (`change`) commits too; Escape puts back the value it had before typing and blurs (`:977`).
- **Keys in the field** (`properties.js:969-978`): ArrowUp/ArrowDown step ±1; with Shift ±10, with Alt ±0.1 (`mult`, `:936`); PageUp/PageDown ±10; Home/End jump to the min/max when the field has bounds.
- **Step buttons:** `Step up` / `Step down` beside the input, the same step and modifiers (`:924-933`). They are out of the Tab order (`tabIndex = -1`).
- **Unit button:** opens a menu of the units the property allows (`:896-917`). For Width/Height the observed list: `px, %, rem, em, vw, vh, svh, dvh, ch, auto, min-content, max-content, fit-content`. A keyword entry commits the keyword; a length unit converts the current value (`convertUnit`) and commits the converted number, or shows the toast `inspector.unitNotConverted` when it cannot convert.
- **Scrub:** pressing on the field's glyph (the small icon or letter at its left, `aria-label` "Drag to change — Shift ×10, Alt ×0.1", cursor `ew-resize`) and dragging horizontally (`:1000-1013`). **Width and Height have no glyph** (they are built with `glyph: null`), so they cannot be scrubbed; dragging their text label changed nothing (observed: width stayed `300px`).

### Hit zones and thresholds

| What | Value | Source |
|---|---|---|
| Glyph (scrub handle) | 24 × 26 px box at the left of the field (measured on the shadow Blur field) | measured |
| Scrub rate | `round(dx / 2) × step` → 1 unit per 2 px; Shift ×10, Alt ×0.1, read on every move | `properties.js:1004` |
| Scrub start | immediately on pointerdown (no dead zone) | `properties.js:1012`, `:629` |
| Scrub bounds | clamped to the field's `min`/`max` on every move | `properties.js:1006-1007` |
| Arrow step | `step` (1 by default) × 1 / 10 / 0.1 | `properties.js:936`, `:970-971` |
| PageUp/PageDown | ±10 | `properties.js:972-973` |
| Accepted text | a number with an allowed unit; `auto`, `none`, `min-content`, `max-content`, `fit-content`, `inherit`, `initial`, `unset`; `calc()/clamp()/min()/max()`; a token reference; arithmetic on digits and `+ - * / ( )` | `properties.js:984-996` |

- **Smart input (stage 3):** a sum in one unit is worked out (`16px*2` → `32px`, `10px + 4` → `14px`); lengths of
  different units added or taken away are written as `calc()` (`100% - 20px` → `calc(100% - 20px)`). Common keywords
  are shown and typed in the person's language (`automático` is `auto`, `nenhum` is `none`; case and accents aside);
  the document keeps the CSS keyword. The wheel over a field that holds the focus steps it as ArrowUp/ArrowDown do.

Observed with Width = 300px: ArrowUp → `301px`, Shift+ArrowUp → `311px`, Alt+ArrowUp → `311.1px`; `Step up` 240→241, `Step down` twice → 239; typing `64/2` + Enter → `32px`. Scrubbing the shadow Blur glyph (starting at 12): +50 px → 37; Shift, +20 px → 137; Alt, +20 px → 138; −400 px → 0 (min 0).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Focused field | Accent focus ring around the field; the step buttons show on hover/focus; the unit button shows the current unit with a chevron. | ![fields](img/inspector-number-fields--01-size-fields.png) |
| Unit menu open | A menu under the unit button, the current unit checked. | ![unit menu](img/inspector-number-fields--02-unit-menu.png) |
| Scrubbing | The value in the field and on the canvas update live on every move; the cursor is `ew-resize`. No other overlay. | ![scrub](img/inspector-number-fields--03-scrubbing.png) |

### Result in the document

Enter (or blur) writes `<number><unit>` (or the keyword) into the node's style for the current breakpoint and state; the iframe's computed style follows. Invalid text (`abc`) is **silently** put back to the previous value (`properties.js:998`); a unit the property does not allow is also refused silently (`:994`). Escape restores the value without writing.

### Undo and redo

- A typed commit is one undo step.
- A scrub is one gesture: the Inspector gesture wrapper (`createInspectorGesture`, `properties.js:571-630`) opens a history group on pointerdown and closes it on pointerup, so a whole scrub is **one** undo step (observed: two Ctrl+Z after four scrubs went 0 → 138 → 137).
- Escape during a scrub cancels the gesture and restores the value (`properties.js:619-621`).
- Each step-button click is its own undo step (observed: 240 → 241 → 240 → 239, one Ctrl+Z → 240).
- Ctrl+Z pressed **inside** the field did not change the document (the input handles it); Delete and Backspace in the field edit the text only (observed; the canvas selection stayed).

### Nested elements

Not applicable: the field edits the selected node(s) only.

### Zoom other than 100 %

Not affected (the Inspector is outside the zoomed canvas); the scrub rate is in screen pixels.

### Keyboard equivalent

The keys listed under Trigger. The glyph has no keyboard action; the arrow keys in the input are the keyboard equivalent of the scrub.

### Problems in Pager

1. **Width and Height cannot be scrubbed** (no glyph, and the label does nothing). Required: every numeric field, Width and Height included, scrubs by dragging its label (and its glyph where it has one): 1 unit per 2 px, Shift ×10, Alt ×0.1, the whole gesture one undo step (manifest feature `inspector-number-fields`).
2. **Invalid input is refused without a word.** Required: invalid text is rejected with a visible message (status bar / field hint) and the previous value stays.
3. **The refusal was only in the status bar, some 500 px from the field, with its quotes doubled** (the user's real-use audit, item 1.6: `Filter: ""2"" is not a value…`). Required: a refused value is also said beside its field, which wears the error outline, in a short text (`"abc" is not a value this field takes.`) until the field is typed in again or shows another value; the field shows the value it had; what was typed is quoted once, as typed, in the field's text and the status bar alike, whatever the field (a number, a shadow, a filter, a background image).
4. **Each field kept its own rule** (the user's real-use audit, A3.32: every arrow press one undo step; ▲ on 2em gave 3em and a 40 px scrub took 3em to 39em; ↑/↓ on calc() did nothing without a word; in the spacing box Escape kept the text and a bare "99" took the unit held before, 99rem, while Font size took px; "50" in Brightness was a factor, 5000%, while Blur refused it; Skew wanted "deg"). Required, one rule for every numeric field: arrow presses in a row on the same field and property, each within numberField.stepBurstWindow of the previous one, are one undo step; a step and a scrub move a font-relative unit (em, rem, ex, ch, lh) by numberField.fineStep a step, any other unit by numberField.step; ↑/↓ on a value that holds no number to step (calc(), a keyword) says so (status.value.notSteppable) and writes nothing; Escape puts back the value the document holds in every field, the spacing box's included; a bare number takes the field's own default unit, never the unit the element held before (px for a length; in a filter or a transform function its function's: px for blur, deg for hue-rotate and skew, % for brightness, contrast, saturate, grayscale, invert, sepia and opacity).
5. **Every field carried two step buttons beside its value** (the code audit's A.0: with the values button and the unit button they left a pair's value 30 px, set its text at caption size and floated over the next row), **and then none** (`9f6c561` dropped them without the person's decision; the audit's AUD-16, the plan's stage 3 asks for them). Required: a field is lean at rest — its value, its unit (the unit menu's trigger) and, while the element holds a value of its own, its Reset. Its step buttons ▲▼ (`field.step#inspector-step-up`, `#inspector-step-down`) are a column of two over the value's end, in the field's own fill, shown while the field holds the focus and hidden while text typed in it is not kept yet, so they never take room from the number nor hide the caret; never on a mere hover, where over a narrow field's value they took the click meant for the value (DEC-40). Each is named after its field ("Step Width up"), so no two controls of the Style tab share a name. A press steps by numberField.step, with Shift by ten times, with Alt by a tenth (the multipliers above); held down, a button steps again after numberField.repeatDelay and then every numberField.repeatInterval (Chromium's press-and-hold, 250 and 50 ms), and the hold is one undo step; a press keeps the focus where it is. A field also steps with ArrowUp, ArrowDown, PageUp and PageDown and with its label's scrub. The buttons are under 24 × 24 px: the field's keys and its label's scrub do the same (WCAG 2.5.8's equivalent).

### Our rule (the user's real-use audit, item A3.30)

- **The ready values and the slider a field's door declares.** A door of an inspector field may declare `slider`
  (`{min, max, step, unit}`: schema.ts, checked by `manifest:check`): the field then draws a range beside its text,
  with the value's number as its thumb. The thumb follows the value and moves freely under the pointer; the field
  writes once, on the release, through the same command the text field uses, so a whole drag is one undo step and the
  canvas is not written while the pointer moves. The unit written is the one the value already carries (a `50%` blur
  slides and stays a percentage), the declared unit only the fallback for a value that holds none; a value no slider
  can read (a keyword, a `var()`, a `calc()`) leaves the slider disabled, with the reason as its tooltip. The pointer
  owner runs the release (src/editor/input/pointer.ts, registerSlider), the field registers what it commits
  (src/editor/shell/field.tsx). Opacity, the eight filter functions and the five radii declare one.
- **The ready values** (the presets of `properties.json`, read by `offers.presets` and offered in All properties
  beside the generated keywords) are the values a person reaches for: the ratios (16 / 9, 4 / 3, 3 / 2, 1 / 1,
  21 / 9, 9 / 16) of Aspect ratio, the transitions (`all 200ms ease`, `opacity 200ms ease`, …) of the Transition
  shorthand, and the project's own variables of the field's kind, offered as `var(--name)`.

### Our rule: the short unit menu (the user's real-use audit, item 5.2)

- The unit menu lists the units a person reaches for — px, %, em, rem, vw, vh, ch, the ones the property offers of them
  (`src/core/style/units.ts`, `COMMON_UNITS` and `unitMenu`) — and, while there are more, one **More units** item that
  reveals them with the property's keywords (a value the field itself suggests); **Fewer units** folds them again. Font
  size offers some fifty units: at most ten items stand before More units. A unit a step asks for and the menu does not
  show yet is reached by opening More units, as a person does.

### Our rule: converting to a measured unit (the user's real-use audit, item 5.3)

- A unit the page measures converts with the page measuring, so the size on the canvas does not change: **rem** is the
  root's font size (32px with the root at 16px is 2rem), **em** and **%** on a font size are the parent's (2rem with the
  parent at 16px is 2em, and 200 %: a percentage is hundredths of what it stands on). The layout port hands the sizes
  out (`Layout.fontPx`, the canvas's computed font size; the root's for null), so the core still measures nothing
  itself. The value converted may itself stand on them: a length in rem becomes em through the pixels it is. A unit or
  a property the page does not measure (a width in %) is refused as before (`status.value.unitNotConverted`).
6. **A click into a field put the caret after its value, so what was typed was appended** (the dogfooding pass: "80" typed into a padding side holding 56 wrote 5680px). Required: the click that focuses a value field of the Style tab, the Settings tab, the quick panel or the colour picker selects its whole value, and what is typed replaces it; a later click in the focused field places the caret; Tab selects the value as the browser does.

- **Ctrl+Z after Enter in a field did nothing** (jornada03 J7). A confirmed value field forwards Ctrl+Z,
  Ctrl+Shift+Z and Ctrl+Y to the editor's history and keeps focus. Pending typing keeps native text undo/redo.
  The field records its draft status and displayed document value; both must agree before forwarding history.
  Native redo of undone typing remains available even when the field again equals the document, until a new
  confirmation or document-history command ends that draft. Native undo/redo that leaves a changed value keeps it pending.
  This applies to numeric/style fields, element text, attribute fields and their quick-panel counterparts. A blur
  after document undo never reapplies the value that was undone; search fields retain their own keyboard behavior.

## inspector-panel

How Pager behaves, read from its source and observed by the coordinator running it from `.cache/pager-run` (Chrome, window 1600×900). The author of this spec did not run Pager (no browser in this session): what the coordinator observed is marked "observed"; everything else is read from the source. Source references are `path:line` inside Pager; without a file name the file is `src/features/inspector/properties.js`. Test documents: the empty page with nothing selected, then a Section (with a Paragraph inside) selected.

### Trigger

- The inspector repaints itself after every selection change and every document change (`ppRender`, `:2743-2790`). With nothing selected it draws an empty state (`:2754-2773`); with an element selected it draws the identity header (`ppIdentity`, `:2793-2818`), the state picker (`ppContextBar`, `:2819-2826`), the property search (`ppNav`) and the sections (`ppPaintSections`, `:2924-2993`).
- A click on a section's header toggles that section (`:2975-2979`): the new open state is written to `ppOpen[home + ":" + section]`, stored in the preferences under `pb.inspector.open.v4` (`ppRememberOpen`, `:2613-2615`), the whole inspector repaints and the focus goes back to the header.
- The element actions button ("…", labelled "Element actions") in the identity header opens a menu (`:2810-2815`): Lock or Unlock, Hide or Show, the provenance panel, Reset every value. Lock and Hide call `toggleNodeFlag(node, "locked" | "hidden")` (`src/features/layers/layers-panel.js:722-733`), the function behind the Layers row buttons.
- The text of a text element is a textarea in the Content section (`PP_SPEC.text`, `:2284`; `ppTextArea`, `:860-868`), written on the textarea's `change` event, that is when it loses the focus, through `ppWrite` → `setProp` → `setProps` (`:2673-2681`; `src/features/inspector/catalogue.js:668-718`).
- Pager has no Style / Settings / Interactions tabs: one panel holds the Content section (text, tag, attributes, an inline `style` field) above the design sections.

### Layout (observed by the coordinator)

| State | What the inspector shows |
|---|---|
| Nothing selected | "Nothing selected", "Select something to edit it here.", a "Page properties" button and three tips: drag an element from Elements onto the page; click to select, Shift+click adds to the selection; double-click text to edit it in place (`:2754-2773`, texts `src/core/i18n.js:659-665`). |
| A Section selected | A header with the element's icon, the name "Section" and the tag `section`; a State picker; a property search; then the sections Content (tag menu, attributes, inline style), Layout (summary `block`; Display, Position buttons), Space (collapsed, summary `P 56px 40px`), Size (open, summary `auto × auto`; Width and Height), Paint, Border, Text, Effects (collapsed, summary `None`), and "Advanced properties". |

### Hit zones and thresholds

- A section's whole header row is its toggle: one `button` with `aria-expanded` holding the caret, the title, the summary and the marks (`:2960-2974`). The "why" button inside the header does not toggle (`stopPropagation`, `:2916-2918`).
- The element actions button is a small icon button (`ppIconButton`, size `sm`, `:2810`).
- No distance or time thresholds.

### Visual feedback

| Stage | What is drawn (read from the source) |
|---|---|
| Default open state | `isOpen` (`:2952-2953`): Content, Size, the element's "home" section (`homeSection`, `:279-284`: Text for text elements, Size for media and form controls, Layout otherwise) and Layout (except for text elements) start open; the others start collapsed. On a Section: Space, Paint, Border, Text and Effects start collapsed (observed for Space and Effects). While a search is typed every section shows open. |
| Section collapsed | Its body is hidden (`sb.hidden = !isOpen`, `:2984`), the caret turns, `aria-expanded="false"`; the header keeps its summary. |
| Summaries | On every header, open or collapsed (`:2967-2969`), made by `INSPECTOR_SUMMARIES` (`:344-370`): Layout the display (else `block`), Space `M … · P …`, Size `W × H` (else `auto × auto`), Text `size · weight`, Paint the background (else `None`), Border the edge and radius (else `None`), Effects the number of effects (else `None`); cut to 22–24 characters with `…` (`inspectorShort`, `:373`). The values come from `propValue` (`src/features/layers/layers-panel.js:736-742`): the element's own value, or the value of the breakpoint or state being edited. |
| Element actions | A menu under the button. Lock/Unlock and Hide/Show name what the item will do (`:2811-2812`). A toggle writes no status message; a refused toggle writes `🔒 <name> is locked — click the lock in its bar to move it` into a developer readout, not the status bar (`layers-panel.js:724-727`, `i18n.js:1773`). |
| Text typed | Nothing changes on the canvas until the textarea loses the focus; Enter adds a new line. A refused write (a locked element) shows the same "locked … move it" words in a toast and repaints the field (`ppRefusal`, `:2667-2672`; `:2676-2680`). |

### Result in the document

- Collapsing or expanding a section changes nothing in the document: the open states live in the preferences, per element kind.
- The text field writes the text of **every** selected element (`setProps` over `selection.all()`, `catalogue.js:668-675`); writing the text they already have writes nothing (`sameProp`, `catalogue.js:699`).
- Lock and Hide set or clear `locked` and `hidden` on the node (`nwToggleBoolean` in a transaction, `layers-panel.js:730`).

### Undo and redo

- Collapsing and expanding are not undo steps.
- A text write, a lock and a hide are one transaction each (read from the source: `runInspectorProps`, `catalogue.js:66`, called at `:700`; `transaction(...)`, `layers-panel.js:730`).

### Nested elements

The inspector shows the selected element (the primary one with several). A write on an element inside a locked ancestor is refused and names the ancestor (`lockedAncestorOf`, `catalogue.js:674-675`; `layers-panel.js:724`).

### Zoom other than 100 %

Not affected: the inspector is outside the zoomed frame.

### Keyboard equivalent

- Section headers are buttons: Tab reaches them, Enter or Space toggles, and the focus stays on the header after the repaint (`:2977-2978`).
- The element actions menu opens from its button with the keyboard like any menu.
- The textarea is edited with the keyboard; only leaving it (Tab) writes the text.

### Our contract where the intent, Pager and DESIGN.md differ

The manifest, DESIGN.md and the other specs win over Pager and over the feature's intent (which is guidance only):

- **Tabs.** The inspector has three tabs in its header (DESIGN.md "Inspector"): Style (the selector bar, then the value-origin legend, Essentials only / All properties, the property search and the sections) and Settings arrive with this feature (`workspace.setActiveTab#inspector-tab-style`, `#inspector-tab-settings`); Interactions arrives with events-actions. Style is the tab shown at start. The chosen tab stays chosen when the selection changes.
- **Sections.** The Style tab shows always all eight sections, in this order: Layout, Space, Size, Position, Paint, Border, Text, Effects (DESIGN.md), whatever the element type; the intent's "Content" section is the Settings tab. Later entries may add sections after Effects.
- **Settings tab.** It has no selector bar: its region (`inspector-settings`) starts right under the inspector header. It holds the text of a text element first, then the attribute fields in their manifest order (DESIGN.md "Settings tab"). The text field is drawn when exactly one text element is selected (its door's adapter selection is `single`).
- **Summaries.** A collapsed section shows a summary of its values on its header row (DESIGN.md: "a collapsed section shows a summary of its values (Position: static · z auto)"; `design/final/shots/1440-01-default.png`); an open section shows its fields instead.
- **The Style tab's region is as tall as what it shows.** The inspector column scrolls the Style tab; the element that carries `data-region="inspector-style"` is the tab's content (legend, mode switch, search, sections), so its height is the height of what the tab shows and collapsing sections makes it shorter. The scenarios measure it, as the Layers scenarios measure `explorer-layers`.

### What this feature must do

1. **Nothing selected.** The Style tab says "Nothing selected" (`inspector.nothingSelected`) and three short hints that name this editor's panel and keys: insert an element from Insert (a click or a drag onto the page); click to select, Shift+click adds; double-click or Enter edits a text. The hints come first; the sections stay drawn below them with their fields empty (the doors of future features wait there, and the census and `current-state.spec.ts` read them at a fresh start). Page properties is the header's door (`page.openProperties#inspector-page-properties-button`, header order 4), drawn in every state and disabled with "not available yet" until page-properties is built; the feature table says which features are built, and the test reads it.
2. **Identity.** With one element selected the selector bar shows the element type's icon (`elements.json`, the icon of its Layers row and its Insert tile), its name and its tag as exported (`body` for the page root). With several selected it says how many (`canvas.selectedCount`).
3. **Sections collapse and expand.** A click on a section's header, or Enter or Space on it, toggles that section (`inspector.toggleSection`, no history, no document change); its body is hidden or shown and the focus stays on the header. A section starts open when the element holds a value in it or when it carries the essentials, and collapsed otherwise, so the panel stays short and the header's summary says what is in force (the user's real-use audit, item 5.1; the mockup draws Position closed with its summary); the user's own choice — opening an empty section, closing a full one — wins over the value. The collapsed set is one per section, the same for every element: a section collapsed on a Paragraph is collapsed on a Section too. It survives selection changes and is kept in the one preferences store (`src/editor/preferences/preferences.ts`), so it survives a reload.
4. **Summaries.** A collapsed section's header shows a summary built from the effective values its fields show (DESIGN.md: "a field never shows a blank: it shows the effective value and where it comes from"): Layout the display (and the direction for flex), Space `M … · P …`, Size `W × H`, Position `position · z z-index`, Paint the background or "None", Border the edge and radius or "None", Text `size · weight`, Effects the number of effects or "None", Advanced its writing mode, containment and hyphenation that do not stand at their initial value, or "None" (the section holds the rare properties: their values are what the header tells, and the fields' own count is in the header's name). Border takes its width, style and radius from the document's declared layers and classes, never from the scaled canvas's computed dimensions, so zoom cannot change the summary. Every word through i18n.
4a. **Concept rows** (the code audit's P-S01: All properties took five to six screens, every longhand a row of its own; plan item 2.D, jornada02 G-S1). A section draws one row per concept (properties.json `conceptRows`): its head always — the fields that name the concept (a border, a radius, the overflow), or for a concept with no field of its own its label and what its details hold, in the code face, or "none" (Item, More text, Shadow, Filter, Transform, More effects) — and its details in place under it, their labels set in, their values at the column every value starts at. The disclosure in the section's gutter (`inspector.toggleRow`, a 24 px target, Enter or Space; no history, no document change) opens or closes the details, a group named by the row. A row opens by itself only when a detail holds a value its head does not show (a detail edits a property the element holds that no field of the head edits); the user's own opening or closing wins, the same for every element, kept in the preferences with the sections' state. A field revealed by Add a property opens its row while it is revealed; Find a property draws every row flat, so a match is never hidden; a row whose head the mode or the element leaves out draws its details flat.
5. **Text field.** In the Settings tab, the text of the one selected text element. Typing changes only the field (the field key context inherits no global or canvas key: `p`, `r`, `c`, `m`, Delete and Ctrl+Z act on the field). Enter commits: `text.set` writes the text into the document JSON as one undo step, the canvas shows it and the status bar says "Saved the text of <name>." (`status.textEdit.committed`). Shift+Enter inserts a line break (stored as "\n", as in text-edit-inline). Leaving the field (Tab, a click elsewhere) commits the same way. Escape puts back the stored text and writes nothing; the status bar says "Kept the text of <name> unchanged." (`status.textEdit.cancelled`). The keys are doors of the field's own key context, `element-text-field`, which inherits the field's (so Ctrl+A, the arrows, Ctrl+Z and typing stay the text area's own): Enter is `text.set#key-enter-in-element-text-field` (its content is what the field holds), Escape is `text.cancelEdit#key-escape-in-element-text-field`; Shift+Enter is bound nowhere there, so the text area inserts its own line break, which Enter then keeps. The same text records nothing. On a locked element the commit is refused: the document is unchanged, the status bar says "Unlock <name> before editing its text." (`status.locked.editText`) and the field shows the stored text again.
6. **Element actions.** The menu of the header's "…" button (`menu:element-actions`) offers Lock (`element.toggleLock#menu-element-actions`) and Hide (`element.toggleHidden#menu-element-actions`), the same commands as the Layers row buttons, on the primary selected element, each one undo step, with the status bar's "Locked: <name>" / "Unlocked: <name>" / "Hidden: <name>" / "Visible: <name>". Inside a locked ancestor both are refused with "<name> is locked by <ancestor>; unlock <ancestor> first." (`status.locked.byAncestor`) and the document is unchanged. With nothing selected both are disabled with "Select an element first." (`refusal.nothingSelected`). Reset every value (`style.resetAll`) is the menu's third item and arrives with inspector-provenance-reset.

### Problems in Pager

Each item is a requirement for this editor.

1. **The open state depends on the element kind.** Pager keys it by `homeSection(node) + ":" + section` (`:2952-2953`, `:2976`) and starts Space, Paint, Border, Text and Effects collapsed on a Section, but Text open on a Paragraph, so collapsing Text on a Paragraph leaves it open on a Section and a person meets a different inspector for each kind. Required: every section starts open (DESIGN.md); the collapsed state is one per section for every element, kept across selections and after a reload.
2. **The summary ignores values that come from elsewhere.** `propValue` (`layers-panel.js:736-742`) reads the element's own value only, and the summary falls back to fixed words (`block`, `auto × auto`, `static`, `visible`, `INSPECTOR_SUMMARIES`, `:344-370`), so a display, width or padding set by a class or at another breakpoint is summarised as the default. Required: the summary is built from the effective values the section's fields show.
3. **The text is written only when the field loses the focus.** Enter adds a new line, nothing commits from the keyboard but Tab, nothing cancels, and the canvas shows nothing while typing (`ppTextArea`, `:860-868`). Required: Enter commits as one undo step, Shift+Enter inserts a line break, leaving the field commits, Escape restores the stored text and writes nothing.
4. **The text field writes every selected element** (`setProps` over `selection.all()`, `catalogue.js:668-675`), so two selected paragraphs get the same text. Required: the text field edits one element (its door's adapter selection is `single`); it is drawn only when exactly one text element is selected.
5. **A refusal says the wrong thing in the wrong place.** A locked element's text change toasts "🔒 <name> is locked — click the lock in its bar to move it" (`:2676-2680`, `ppRefusal` `:2667-2672`), and a refused Lock or Hide writes it to a developer readout (`layers-panel.js:724-727`). Required: the status bar says "Unlock <name> before editing its text." for the text, and "<name> is locked by <ancestor>; unlock <ancestor> first." for Lock and Hide inside a locked ancestor; the document is unchanged.
6. **Lock and Hide from the inspector say nothing when they succeed** (`toggleNodeFlag`, `layers-panel.js:722-733`). Required: "Locked: <name>", "Unlocked: <name>", "Hidden: <name>", "Visible: <name>" in the status bar, as for every door of lock-element and hide-element.
7. **A second way into page properties.** The empty state's button clicks another button found by its DOM id (`document.getElementById("pageProperties")`, `:2767`). Required: Page properties is one door of the manifest, in the inspector header; the empty state draws no button of its own.
8. **The tips name Pager's panels** ("Drag an element from Elements…", `i18n.js:663-665`) and only the double-click for text. Required: the hints name this editor's Insert panel and keys (double-click or Enter edits a text), in both languages.
9. **The identity's icon comes from a table inside the inspector** (`PP_TAGICON`, `:2791-2792`), keyed by tag, so it can differ from the element's Layers row. Required: the icon of the element type in `elements.json`, the element's name and its exported tag.
10. **An inline `style` field** sits among the attributes (`PP_SPEC.style`, `:2302`). Required: no field writes a `style` attribute (the export has no inline styles); the Settings tab holds the text and the attributes of `elements.json`.
11. **The search and the mode are reset on every selection change** (`:2750`). Not this feature's (inspector-property-search, inspector-advanced-mode), noted for them: the collapsed sections of this feature are not reset.
12. **Text cut in a translation** (the audit's AUD-23: in Portuguese the Size pair's halves read "autom… 120", "A auto… 47", "máx nenh…", and a detail's label broke "Transbordamento" in two). A translation runs longer than the English it comes from, the short texts most (W3C, "Text size in translation"), so the inspector lets its text reflow rather than cut or abbreviate it. Required: no text the inspector draws is cut by its box or broken inside a word, in either language, in any tab, for any element. A row whose label has a word wider than the label column, or a pair whose value of one word (a keyword's word, a number) does not fit its half, lays its label on a line of its own and its values under it across the whole row, the pair's halves still side by side (`src/editor/shell/row-fit.ts`, judged as the row would be laid out beside its label, so it never flickers). A field of offered values (an input with its list, such as the Form section's preset) whose chosen words are wider than its box stacks its row the same way (CL1: an input cuts its text with no ellipsis); a row whose field is being typed in keeps its layout until the field is left. Only a value of several parts (a list of fonts, a shorthand such as a border), which no field can hold, may end in an ellipsis, and its field's tooltip carries it whole. `tests/e2e/inspector-text-fits.spec.ts` measures every text of the three tabs, every section and row open, for fifteen kinds of element in English and Portuguese.
13. **Sixteen controls were smaller than 24 × 24 px** (the audit's AUD-29; WCAG 2.2, 2.5.8): the colour swatches 14 × 14, the values buttons ("Every value of Display") 12 × 24, the canvas's spacing bands 6 × 19. Required: every control the pointer takes is at least 24 × 24 CSS px, or within 2.5.8's exceptions. A swatch takes the pointer across 24 × 24 around the swatch it draws and a values button across 24 px, their margins giving the field back the room, so nothing moves; a spacing band stays the thickness of the spacing it draws, since the box model's field of the same name does the same at 32 × 24 (the equivalent exception); a field's input counts by its 24 px frame. The panel splitters (6 px) pass by the equivalent exception: each has its View menu doors (TS1, panel-resize). `tests/e2e/accessibility-audit.spec.ts` measures every control with every section open, the dock and the canvas's chrome included, and applies the spacing (the 24 px circle) and equivalent exceptions.

### Open question (for the coordinator)

The manifest draws the two Element actions items with `checked: null`: the item reads "Lock" even on a locked element, where it unlocks it. Pager flips the label (Lock/Unlock). Proposal: `checked: "checkbox"` on `element.toggleLock#menu-element-actions` and `element.toggleHidden#menu-element-actions`, so each item says whether the primary selected element is locked or hidden. Not changed here: it is door data, outside this phase.

## inspector-property-search

The Style tab's "Find a property…" field filters the tab down to the properties it names. Pager has no such filter (its
inspector lists every section); the behaviour here is the user's real-use audit, item 1.2, after Webflow's Style panel
search.

### Trigger

- Typing in "Find a property…" (the field of `inspector.search`, drawn above the sections, `inspector-style` order 211)
  runs `inspector.search` with what the field holds, at every change; Enter keeps it; emptying the field clears the search.
- The query is editor state (`ui.inspectorSearch`), kept while the selection changes and cleared by an empty query. It is
  never stored in the document nor in the preferences.

### Hit zones and thresholds

A field or an editor control matches when the query (trimmed, case and accents ignored) is part of its label, in the
language shown, or of one of the CSS names it edits (a composite: its own name and its longhands'; the box model: every
side of every box it draws).

### Visual feedback

- While a query is typed, each section shows only its matching fields and controls, in their usual order; a section
  with none is not drawn at all, header included. A collapsed section with a match is drawn open for the search, and
  its collapsed state is kept for when the search is cleared.
- The search looks at every property that applies to the selection, in Essentials only as in All properties.
- With no match, the tab says `No property matches "zzz".` where the sections would be.
- The status bar says `Showing the properties that match "letter".`, and `Search cleared; every property is shown.`
  when the field is emptied.

### Result in the document

None: a search changes nothing in the document.

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The field takes the focus by Tab like any field; Escape in it keeps the field's keys (it is a field).

### Problems in Pager

1. **"Find a property…" took text and filtered nothing** (the audit, item 1.2: the field existed with no command).
   Required: typing filters the sections and fields by label and by CSS name; typing `letter` on a paragraph leaves only
   Letter spacing (section Text); clearing brings every section back as it was.

## inspector-provenance-reset

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Paragraph with padding, colour and font size set.

### Trigger

- Each field row carries a provenance chip saying where its value comes from (`chip.dataset.provenance`, `src/features/inspector/properties.js:3078-3110`: the element itself, a class, inherited, the default); its menu can clear the value.
- The element actions menu holds **Reset all** (`{label:t('inspector.resetAll'),onRun:()=>clearAllProps()}`, `:2814`).

### Hit zones and thresholds

Not applicable: the controls are buttons and menu items.

### Visual feedback

A value set on the element is marked by its chip; a cleared field is empty and its muted placeholder shows the value inherited or the default (Problems in Pager 4).

### Result in the document

- Clearing a value removes the property from the element's styles.
- Reset all removes every style value of the element.
- The computed values in the iframe fall back to what the element inherits or its defaults.

### Undo and redo

Each clearing is one undo step; Reset all is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The chip's menu and the element actions menu are keyboard-operable.

### Problems in Pager

1. **Where a value comes from is shown per row only:** a collapsed section tells nothing about the values set inside it. Required: every field whose element holds a value of its own shows a dot, and each section's header says how many values are set in it in its accessible name ("Text, 2 set"), which a screen reader reads — it is not drawn: the origin dot and the summary say it to the eye (the owner's decision D-3, jornada02 R-07); the summary text is unchanged.
2. **Clearing a value takes the chip's menu:** there is no reset control on the field itself. Required: each field has Reset this value (`style.reset`), usable while the element holds a value of its own; the field then shows the value inherited or the default, muted.
3. **Reset all has no command:** it cannot be reached from the keyboard map or the command bar. Required: Reset every value is `style.resetAll`, in the element actions menu, one undo step, refused on a locked element.
4. **Fields showed what the page computes as if it were the element's value** (the user's real-use audit, item 1.1): `Font "Times New Roman"`, `rgb(0, 0, 0)`, `rgba(0, 0, 0, 0)` in fields the element never set, and `Border 1.7561px…` on an element with no border (Chrome's typed computed value of `medium`, scaled by the canvas zoom: 2.85366px in Phone at 210 %), with the Border handles' chips reading `1.76`. Required, in the Style tab and the quick panel alike:
   - a field's value is the value the document holds for the element at the edited target, breakpoint and state, as written: a composite shows its shorthand (`2px solid #00aa00`, never its twelve longhands); a border side with no style reads `none`;
   - with no value there, the field is empty and its placeholder, muted, shows the effective value: the one the document gives along the cascade (another breakpoint or state), else what the page computes (inherited or the default);
   - nothing a field or a handle's chip shows depends on the canvas zoom: a border or outline side whose style is `none` or `hidden` computes to `0px`, and any other side's width is read unscaled by the zoom. The browser snaps a line's width to whole device pixels and reports it divided by the zoom, so the zoomed canvas cannot say it (BW1: a button's 1 px border read `1.69014px` at the fit zoom, and 1 px and 2 px read alike): the width is the one the declaration that wins in the page's stylesheets gives (the base stylesheet's 1 px for a button, a class's, a captured page's), ranked as the cascade ranks it, else the browser's own width for that kind of element (an inline frame's 2 px inset), the same at every zoom.
5. **Reset this value was drawn with nothing to reset, disabled, saying "not available yet"** (the user's real-use audit, item 1.4). Required: a field's Reset is drawn only while the element holds a value of its own, in the Style tab and the quick panel alike; with nothing to reset there is no control.
6. **Where a shown value comes from was said for classes and other breakpoints only, and an edit gave no notice** (the user's real-use audit, A3.10): with the Element target a class's value read as the element's own, an inherited colour named no source, and typing over a value from elsewhere did not say where it would be written. Required, in the Style tab (the one rule: `src/editor/inspector/origin.ts`):
   - a field whose target holds no value of its own at the edited layer shows, under it, where the placeholder's value comes from, in the legend colour of that origin: `From Desktop` or `From Desktop · Hover` (a larger breakpoint or the base state), `From .card2` (a class the element lists, muted: the legend names no class), `Inherited from Plans` (an inherited property, per the CSS data, that the nearest ancestor setting it sets, itself or through a class); a value set at the edited breakpoint away from the base layer reads `Set at Tablet`; the element's own value at the base layer and the default have no note (the default's placeholder already wears the Default colour);
   - which value wins follows the stylesheet the canvas and the export share: the element's own value at the edited layer or the nearest one up the cascade, else the last class it lists that holds one;
   - while such a field holds the focus, a second line says where typing writes: `Typing writes to CardB · Desktop` (the class while it is the target, `.card2`, and the state after the breakpoint away from the base state); what is typed is written there, and the classes and ancestors keep their values.

## keyboard-panel-navigation

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- **Tab** moves between a few region stops. Pager removes almost every control inside the regions from the Tab order (`tabindex="-1"` on buttons, inputs, selects, links and scrollers, `sealRegions`, `src/features/input/index.js:378-428`) so that the page has only a handful of stops (`data-region` on menu, canvas tools, palette, canvas, inspector dock, workbench, status; `index.html:26`, `:103`, `:159`, `:188`, `:232`, `:248`, `:264`).
- **F6 does nothing** (no binding exists; observed: focus stayed on `BODY`).
- Inside the inspector dock region (the rail): ArrowRight/ArrowDown and ArrowLeft/ArrowUp move a drawn aim across panel tabs and splitters; Enter/Space shows the aimed panel and focuses its first control (`input/index.js:751-756`, `:507-569`).
- Tab strips (inspector tabs, workbench tabs, settings hub, panel windows) use roving tabindex with ArrowLeft/Right/Up/Down, Home, End, activating as they move (`src/features/workspace/camera.js:510-529`).
- Menus: see `app-menu.md`. The palette: arrows between tiles, Enter inserts, Escape returns to the region (`src/features/palette/index.js:276-300`).

### Hit zones and thresholds

Observed Tab order starting from the canvas: Inspector dock → `Close Elements` button → `Resize palette` divider → `Close Layers` button → an unnamed div → `Resize left dock` → Workbench → Status → `BODY` (the end of the page). The top bar menu and the canvas tools were not reached going forward from the canvas.

### Visual feedback

The rail aim is drawn as a 2 px outline on the aimed tab (`.kbaim`, `style/04-panels.css:87`); the status says `<name>, panel N of M. Enter shows it.` Regions show the browser focus ring when focused.

### Result in the document

None.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **No F6 / Shift+F6.** Required: F6 and Shift+F6 cycle focus between top bar, left dock, canvas, inspector, workbench and status bar, and the focused region shows a visible focus ring (manifest feature `keyboard-panel-navigation`).
2. **Controls inside panels are removed from the Tab order,** so most buttons, inputs and trees cannot be reached by keyboard. Required: an automated sweep pressing F6 and Tab reaches every enabled button, input, tab and tree of every open panel.
3. **Escape inside a panel does not reliably return to the canvas** (only the palette handles Escape, and it goes to the palette region). Required: Escape inside a panel returns focus to the canvas with the selection intact.
4. **Unnamed focus stops** (a bare `DIV` in the Tab order). Required: every focusable element has an accessible name.
5. **Words typed on the canvas ran its letter shortcuts** (the dogfooding pass: a title typed outside its text — the person thought it was being edited — wrapped, nested, took into the hand… one letter at a time). Required: letters pressed within `keys.typingBurst` (350 ms) of each other are a burst; once a letter of the burst binds nothing (a vowel: words are being typed), the single-letter shortcuts of the rest of the burst do not run. Shortcuts pressed in a row (R then S) still run, a letter on its own later runs, and a click ends the burst.
6. **The first letters of a word still ran, and letters reached the canvas after a press elsewhere** (jornada03 J2:
   Marina chose an image in the source picker, her next click was swallowed, and "Grãos de café" typed for the Alt text
   wrapped the image in a Grid and a Row and flipped its direction; Carla's "Cardápio" changed the editor). Required:
   - When a letter of a burst binds nothing, the shortcuts the burst already ran are taken back and the status
     bar says so ("Typing is not a shortcut: took back R."), so a typed word changes nothing. A non-printable key or
     a modified command ends the burst (Shift alone may still type a capital); later typing never takes back an
     intervening undo, redo, navigation or command.
   - The store owns a reversible command sequence: each shortcut still dispatches and records its own undo step,
     but recognizing a word restores the complete pre-burst state, including redo and transient modes such as the
     keyboard hand. No document or selection snapshot lives in the keymap. External commands invalidate cancellation;
     a settled timeout commits the sequence. Autosave and preferences wait until it settles. Shifted letters in a
     recognized word are blocked too, and the latest pointer or keyboard choice always wins.
   - The canvas's and the Layers' typed keys (a letter, a digit or a sign, with or without Shift) act only while the
     person chose the canvas or the Layers: a press on the canvas or on a Layers row, the keyboard reaching a Layers
     row, F6 onto the canvas, or Escape on the canvas chooses it; a press anywhere else, or the focus lost to nowhere
     (a picker or a panel closing under it), unchooses it. An unchosen typed key does nothing and the status bar says
     why, once per burst ("Letters typed here do nothing: click the canvas or a Layers row to use their keys, or a
     field to type into it."). The editor opens with the canvas chosen.
7. **F6 never put the focus on the canvas page** (the audit's AUD-13, 2026-10-02, jornada03 J12: the canvas's stop
   focused the frame's breakpoint tabs, so the page's tree walk needed a click or Escape). Required: the canvas's stop
   of the F6 ring is the stage itself: it takes the focus (its key context the canvas's), draws a focus ring, and the
   canvas's keys act at once (ArrowDown walks into the page from the root when nothing is selected); F6 and Shift+F6
   go on from the canvas to the regions beside it.
8. **A control reached inside a panel just opened lost the focus** (FL2: the panel takes the focus two frames after it
   opens, and a tile focused within them lost it to the panel's search field, whose Escape then cleared the field
   instead of closing the panel; seen twice under load in narrow-window). Required: the panel's own entry focus goes
   into it only while the focus is not already inside it.

## keyboard-tree-walk

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph].

### Trigger

With the canvas focused, something selected, nothing in the hand and no drag (`src/app/boot.js:560-569`):

| Key | Action | Source |
|---|---|---|
| ArrowRight | select the next sibling | `src/features/input/index.js:727-735` |
| ArrowLeft | select the previous sibling | same |
| ArrowUp | select the parent | `:736-742` |
| ArrowDown | select the first child | `:743-750` |

When the selection is absolutely or fixed positioned, the arrows nudge it instead (see `absolute-nudge.md`, `input/index.js:719-726`). With Ctrl or Meta held the canvas keymap does nothing (`boot.js:565`).

### Hit zones and thresholds

Not a pointer gesture. Siblings are counted without hidden or locked filtering (`kidsOf`).

### Visual feedback

The selection outline and the Layers row follow; the status bar announces each step. Observed sequence starting on the Heading:

| Key | Selected | Status |
|---|---|---|
| ArrowRight | Paragraph | `Paragraph selected. Sibling 2 of 2.` |
| ArrowLeft | Heading | `Heading selected. Sibling 1 of 2.` |
| ArrowLeft | Heading | `No previous sibling in Section.` |
| ArrowUp | Section | `Section selected. Parent.` |
| ArrowDown | Heading | `Heading selected. First child of Section.` |
| ArrowUp | Section | `Section selected. Parent.` |
| ArrowUp | Section (stays) | `Already at the root.` |
| ArrowRight | Section (stays) | `No next sibling in Page.` |

### Result in the document

Walking never changes the document JSON (observed: identical outline after every key).

### Undo and redo

Not undo steps.

### Nested elements

One level per key.

### Zoom other than 100 %

Not affected. The canvas does not scroll to a newly selected element that is off screen.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **ArrowUp from a direct child of the Page says `Already at the root.`** and does not select the Page, while the Page can be selected by clicking. Required: ArrowUp selects the Page root; at the Page root it says `Already at the root.`
2. **The walk does not reveal off-screen elements.** Required: walking to an element outside the canvas viewport scrolls it into view (nearest edge).
3. **With nothing selected the arrows said "Select an element first."** (jornada03 plan, stage 5). Required: with nothing
   selected, any of the four arrows selects the open page's root, the start of the walk (`Page selected.`); the next
   ArrowDown goes on to its first child.

## layers-drag

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: a Section holding a Heading and a Paragraph, and an empty Container after the Section. Layers rows are 28 px tall.

### Trigger

- Primary-button press on a Layers row arms a move drag of that row's node (`src/app/boot.js:463-501`). Presses on the row's buttons (caret, lock, eye), inputs, or with Shift held do not arm (`boot.js:464`). The row click itself selects (`boot.js:131-148`).
- The pointer is captured only once the 4 px threshold is crossed, so a plain click keeps its normal target (`boot.js:500`, `:508`).
- During the drag, whenever the pointer is over a Layers row the proposal comes from the row geometry (`layerDropAt`, `src/features/layers/layers-panel.js:356-371`); anywhere else it comes from the canvas, so one gesture can start in Layers and drop on the canvas or the reverse. Both go through the same validator and the same commit (`src/features/drag/drag.js:438-442`, `:1118-1245`).

### Hit zones and thresholds

For the row under the pointer, with `at` = (pointer y − row top) / row height (`layers-panel.js:362-368`):

| Row | Zone | Result |
|---|---|---|
| Container row (has or may have children) | 0.25 ≤ at ≤ 0.75 | **inside**, appended as last child |
| Container row | at < 0.25 | **before** that node |
| Container row | at > 0.75 | **after** that node |
| Leaf row | at < 0.5 | before |
| Leaf row | at ≥ 0.5 | after |
| Page row | anywhere | inside (appended) |

On a 28 px row: before = top 7 px, inside = 7-21 px, after = bottom 7 px (containers); leaves split at 14 px. The dragged rows are excluded when computing the index (`:366-368`).

A collapsed row is **not** expanded by hovering it during a drag: after 800 ms over the collapsed Section row it was still `aria-expanded="false"` (observed); there is no timer in the code.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Paragraph row over the top quarter of the Heading row | A 2 px accent line on the top edge of the Heading row (`data-drop-position="before"`, `style/99-base.css:58-64`); the receiving parent's row (Section) is highlighted with the receiver colour (`.rc`, `style/04-panels.css:149`); the ghost chip `⠿ Paragraph` follows the pointer. **Nothing is drawn on the canvas** (no line, no tint, no label chip): a Layers proposal only updates the read-out (`src/platform/overlay.js:243`, `drag.js:92`). Status `Before Heading`. | ![before](img/layers-drag--01-before-heading-row.png) |
| Heading row over the middle of the Container row | The Container row gets a 2 px accent outline (`data-drop-position="inside"`); status `Into Container · index 0`. | ![inside](img/layers-drag--02-inside-container-row.png) |
| Container row over its own child (Heading) row | The target row gets a 2 px danger outline (`data-drop-position="refused"`); status `Rejected`; read-out "An element cannot be placed inside itself or one of its descendants. …". Release → `Cancelled — nothing changed`. | ![refused](img/layers-drag--03-refused-into-own-child.png) |
| Container row held 800 ms over the collapsed Section row | The Section row is outlined for inside; the branch stays collapsed. | ![collapsed](img/layers-drag--04-hover-collapsed-row-800ms.png) |

### Result in the document

- Paragraph over the top quarter of the Heading row → `Section.children = [Paragraph, Heading]`.
- Heading over the middle of the Container row → `Container.children = [Heading]`.
- A Layers drop within the same parent keeps the node's grid cell / absolute placement (`drag.js:1221`); a drop into another parent clears it, exactly like a canvas drop.
- The dropped node is selected and its row scrolled into view (`drag.js:1239-1240`).
- For the same source and target, the Layers drop and the canvas drop produce the same document JSON, because both commit through `finish()` with the same `(parent, index)`.

### Undo and redo

One drop, one history entry; `Ctrl+Z` restores the previous tree.

### Nested elements

Any depth: the row's own node is the receiver for inside, its parent for before/after. Deep rows are indented by 12 px per level.

### Zoom other than 100 %

Canvas zoom does not affect Layers.

### Keyboard equivalent

`Alt+ArrowUp`/`Alt+ArrowDown` on a focused row move the node among its siblings (`layers-panel.js:410-417`); the row menu offers Move up, Move down, Make child of previous (indent) and Move out of parent (outdent) (see `layers-keyboard-navigation.md`, `context-menu.md`).

### Problems in Pager

1. **Hovering a collapsed row during a drag never expands it,** so a node cannot be dropped at a precise position inside a collapsed branch. Required: hovering a collapsed container row for 600 ms during a drag expands it (manifest feature `layers-drag`); leaving it before 600 ms cancels the timer.
2. **The canvas shows nothing during a Layers drag.** Required: while the pointer is over Layers, the canvas mirrors the same proposal (receiver tint and insertion line on the canvas, when the receiver is visible), so both views show one decision.
3. **No label chip in Layers.** The only text is in the status bar. Required: the same one-line label as on the canvas appears next to the pointer in Layers (`Position 1 of 2 in Section, before Heading`).
4. **The receiver row stays highlighted in the receiver colour while the proposal is refused** (Container stays `.rc` while its child row shows the refusal). Required: during a refusal no row is marked as receiver; only the refused target row is outlined in the danger colour.
5. **The before/after line is drawn on the row edge but not indented to the drop depth,** so "after the last child" and "after the parent" look the same. Required: the line starts at the indentation of the level it inserts into.

## layers-expand-collapse-all

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test tree: Page > [Section > Container > Container 2 > Container 3 > Paragraph, Section 2 > Container 4 > Heading].

### Trigger

- Two icon buttons in the Layers header: `Collapse every branch` (`#layerCollapseAll`) and `Expand every branch` (`#layerExpandAll`) (`index.html:352-353`), handled by `foldAll` (`src/features/layers/layers-panel.js:504-511`).
- Collapse adds **every** node that has children, the Page root included, to the folded set. Expand clears the set.
- Single branches: the twisty on each row (`layers-panel.js:276-283`), or ArrowRight/ArrowLeft on a focused row (`:430`, `:440`).

### Hit zones and thresholds

The two header buttons are icon buttons (≈ 24 px) at the right of the Layers header, beside the row count badge.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After `Collapse every branch` | Only the `Page` row is left, with a closed twisty (`aria-expanded="false"`). | ![collapsed](img/layers-expand-collapse-all--01-collapsed.png) |
| After `Expand every branch` | All nine rows, every twisty open. | ![expanded](img/layers-expand-collapse-all--02-expanded.png) |
| Collapse all, then click the deep Paragraph on the canvas | The Paragraph is selected on the canvas, but **Layers still shows only `Page`**. Its row stays hidden and nothing is scrolled. | ![deep](img/layers-expand-collapse-all--03-deep-selected-after-collapse.png) |

### Result in the document

None: folding is view state (`treeFolded`, a `Set` of node ids inside the Layers panel). It is not saved and not part of the document.

### Undo and redo

Not in the history.

### Nested elements

Collapse folds every level. Expand opens every level. Selecting a node inside a folded branch does not unfold it: no code path deletes from `treeFolded` on selection (the only deletions are the twisty click, `layers-panel.js:283`, and ArrowRight, `:430`).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None for collapse/expand all. Single branches: ArrowRight / ArrowLeft on a focused row (see `layers-keyboard-navigation.md`).

### Problems in Pager

1. **Selecting a hidden descendant does not reveal it in Layers.** Required: selecting a node whose row is inside a collapsed branch (from the canvas or anywhere else) expands its ancestors and scrolls its row into view (manifest feature `layers-expand-collapse-all`).


**Stage 5 (jornada03 J9):** Collapse every branch folds every branch below the page root: the page's row and its first
level stay in view (folding the root left one row and nothing to work with). Expand every branch is unchanged.

## layers-keyboard-navigation

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Page > [Section > [Heading, Paragraph], Container].

### Trigger

With a Layers row focused (`src/features/layers/layers-panel.js:398-446`):

| Key | Effect |
|---|---|
| ArrowDown / ArrowUp | focus the next / previous visible row **and select it** |
| Home / End | first / last visible row, selected |
| ArrowRight | on a collapsed row with children: expand; on an expanded row: go to its first child (selected) |
| ArrowLeft | on an expanded row: collapse; otherwise go to the parent row (selected) |
| Enter / Space | select the row's node (it already is) |
| Alt+ArrowUp / Alt+ArrowDown | move the node among its siblings (`runKey`, `:410-417`) |
| Delete / Backspace | delete the selection (`src/app/boot.js:150-159`) |
| F2 | **nothing** (F2 is a canvas-only key row) |

### Hit zones and thresholds

The tree has `role="tree"`, rows `role="treeitem"` with `aria-level`, `aria-expanded` (only on rows with children) and `aria-selected`; exactly one row has `tabindex="0"` (the selected one, else the first root row) (`layers-panel.js:239-266`). The tree itself is reached only by clicking a row (rows are sealed out of the Tab order).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Focused, selected row | The selected-row background; the row is scrolled into view (`focusRow`, `:399-404`). | ![row](img/layers-keyboard-navigation--01-focused-row.png) |

Observed sequence from the Page row: ArrowDown → Section, ArrowDown → Heading, ArrowUp → Section, ArrowLeft → Section collapsed (rows: Page, Section, Container), ArrowRight → expanded, ArrowRight → Heading, End → Container, Home → Page, ArrowDown ×2 → Heading, Alt+ArrowUp → `Already at the start of Section.`, Enter → no change, F2 → nothing.

### Result in the document

Only Alt+Arrow and Delete change the document (same commands as on the canvas; observed `Removed: Container`).

### Undo and redo

As for those commands.

### Nested elements

The arrows follow the visible (unfolded) rows.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **Moving focus changes the selection on every arrow key,** so walking through the tree repaints the canvas and the Inspector for each row and loses a multi-selection. Required: arrows move focus as in the WAI-ARIA tree pattern (roving tabindex); Enter selects the focused element (manifest feature `layers-keyboard-navigation`).
2. **F2 does nothing on a row.** Required: F2 renames the focused row's node (inline), Delete deletes it and Alt+ArrowUp moves it, with the same commands as the canvas.
3. **The tree is not reachable with Tab.** Required: the tree is one Tab stop; focus lands on its current row.
- **The structure keys did nothing once a row was clicked** (the dogfooding pass, 2026-09-30): a person who selects in the Layers and presses R to wrap it in a row met silence, as the tree's key context inherits the global one, not the canvas's. Required: the single-letter structure keys of the canvas (R, C, D, G, P, M, S, Shift+S, O) and Alt+ArrowRight (nest into the previous) work the same in the Layers tree (doors `key-*-in-layers-tree`); the tree keeps its own arrows, Enter, F2 and Delete.

## layers-tree

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- A click on a row selects its node (`src/app/boot.js:131-148`, row focus at `src/features/layers/layers-panel.js:447-451`). Shift+click adds to or removes from the selection (`boot.js:135`, see `multi-select-click.md`).
- A click on the caret (`button.twisty`) folds or unfolds that branch without touching the selection (`layers-panel.js:273-286`).
- Any selection change, from any surface, repaints the row marks (`markTreeSelection`, `layers-panel.js:681-700`); any document change rebuilds the rows when the tree signature changes (`drawTree`, `:228-347`).

### Hit zones and thresholds

| Part of a row (28 px tall, full panel width) | Effect |
|---|---|
| Caret (left, indented by 12 px per level: grid column `16px + depth × 12px`, `style/04-panels.css:642`) | fold/unfold |
| Icon, name, meta | select (press also arms a drag, see `layers-drag.md`) |
| Colour dot | opens the colour label picker (`layers-panel.js:466-479`) |
| Lock and eye buttons at the right end (24 × 28 px each) | toggle lock / hidden (`:323-335`) |

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Row clicked | The row gets the selected background; the canvas scrolls the element to the vertical centre of the stage (`boot.js:142-143`) and draws the selection outline there. | ![row click](img/layers-tree--01-row-click.png) |
| Element selected on the canvas | The matching row gets the selected background, `aria-selected="true"` and `tabindex="0"`. **The row is not scrolled into view**: with 32 rows, selecting the last paragraph on the canvas left its row at y = 1576 px while the tree viewport spans 665-833 px (observed). | ![canvas selection](img/layers-tree--02-canvas-selection-row.png) |
| Caret clicked | The branch's rows disappear; the caret rotates; the selection is unchanged. The count badge in the panel header drops from 32 to 2. | ![collapsed](img/layers-tree--03-collapsed.png) |

Each row shows, from left: indentation guides, caret (only when the node has children), element-type icon, colour dot, name, optional meta (tag, id, classes, attributes; see `layers-row-columns`), and the lock and eye buttons. The row's tooltip reads `Name — <tag> — layout` (`layers-panel.js:337`). The tree has `role="tree"`, rows `role="treeitem"` with `aria-level` and `aria-expanded` (`:239-266`).

### Result in the document

Selecting and folding never change the document JSON. Fold state is kept in memory only (`treeFolded`, `layers-panel.js:136`); it is not saved.

### Undo and redo

Not undo steps.

### Nested elements

Rows follow document order depth-first; every level is indented 12 px. Selecting on the canvas a node whose branch is folded does **not** unfold its ancestors (observed: after folding the Section, selecting its fifth paragraph on the canvas left the branch folded and no row visibly selected).

### Zoom other than 100 %

Not affected by canvas zoom.

### Keyboard equivalent

See `layers-keyboard-navigation.md` (ArrowUp/ArrowDown move and select, ArrowRight/ArrowLeft unfold/fold or go to child/parent, Home/End, Enter).

### Problems in Pager

1. **Selecting on the canvas does not scroll the Layers row into view.** Required: whenever the selection changes from a surface other than Layers, the primary selected row is scrolled into view (nearest edge, no smooth animation longer than the motion token).
2. **Selecting a node inside a folded branch leaves the branch folded,** so the selection is invisible in Layers. Required: selecting a hidden descendant unfolds its ancestors and scrolls its row into view (manifest feature `layers-expand-collapse-all`).
3. **The header badge counts visible rows, not nodes** (32 → 2 after folding one branch). Required: the badge shows the number of nodes in the document and updates after every insert and delete, regardless of folding.
4. **The Page row's tooltip and canvas chip say `<div>`** although the Page renders as `<body>`. Required: show the exported tag.
5. **A selected row's tag fell to 3.9:1 on the selected fill in the dark theme** (the audit's U-047). Required: a selected row's detail takes the muted ink, which keeps at least 4.5:1 on the selected fill in both themes.

## layout-actions

The user's real-use audit, item 8.1 ("Ações rápidas, no menu de contexto, no Arrange e por atalho"): wrap in a
container, wrap in a grid, swap the direction row↔column, distribute equally, a draggable divider between columns,
stack on the phone and organize the loose children. What already exists is never duplicated: Wrap in a row and Wrap
in a column are `element.wrapRow` and `element.wrapColumn` (spec wrap-row-column), Remove wrapper is
`element.unwrap`, and Distribute equally is `position.distribute` (spec align-distribute). A1.4 — the responsive
grid — lives here too: creating a grid offers the phone behaviour without anything being edited afterwards.

### Trigger

- The context menu of a selection (secondary click on the canvas or a Layers row), the Arrange menu, the command
  palette (Ctrl+K, "wrap in a grid") and the canvas keys: **D** wrap in a container, **G** wrap in a grid, **S** swap
  the direction, **Shift+S** stack on the phone, **O** organize the children.
- The divider is no menu item: it is the grip the canvas draws between the columns of a selected flex row, dragged
  with the pointer (the canvas-handle door `element.setDivider#handle-divider`).
- Every door acts on the selection and is disabled with its reason where it does not apply (a grid wrap needs the
  selected elements to share one parent; the direction actions need a flex or grid container; the divider needs a
  flex row holding at least two children).

### Wrap in a container, wrap in a grid

`element.wrapContainer` and `element.wrapGrid` are `element.wrapRow`'s own wrap (elements.json wrappers, one
definition per door): the selected roots leave their parent from the last one up and a new element takes the first
one's place, holding them in their order, one undo step, and becomes the selection.

| Wrapper | Element and styles |
|---|---|
| Container | a `<div>` with no styles of its own: a plain grouping box the person then styles. |
| Grid | a `<div>` with `display: grid`, `column-gap: 16px` and `row-gap: 16px` and one equal track per element it holds (`repeat(2, minmax(0, 1fr))` for two), the count written with the same writer the track editor uses (`tracksForChildren`, `src/core/style/tracks.ts`). |

The status bar names the wrapper and the styles it added ("Wrapped Intro in Container (display: grid; …)"), or, for
a wrapper that adds none, "Wrapped Intro in Container." (`status.wrappedPlain`).

#### A1.4 — the grid created is a responsive grid

A grid wrapper ("Wrap in a grid", and the Grid template, which names the same wrapper) writes, besides the base
breakpoint's tracks, the tracks the narrower breakpoints take, from interactions.json: `layout.gridTracks.tablet`
(two tracks while the grid holds more) and `layout.gridTracks.phone` (one track). So a grid of three cards shows
three columns at the Desktop, two at the Tablet and **one at the Phone, with nothing edited afterwards**, and the
per-breakpoint override the Styles tab writes keeps working over it (it is an ordinary layer of the element's
styles).

### Swap the direction

`element.swapDirection` writes the opposite of what the primary element lays its children out with, for every
selected element, at the breakpoint and state the editor edits (one undo step, through style.set's one writer and
its target rules):

- a flex container's `flex-direction`: row ↔ column, row-reverse ↔ column-reverse;
- a grid container's `grid-auto-flow`: row ↔ column (a `dense` keyword is kept).

Available on a flex or grid container, by its own display or its classes' (the value predicate `flexOrGridContainer`); an element of neither
layout is refused with its element named (`status.swap.notContainer`). The status bar names the element, the
property and the value it now holds ("Swapped the direction of Row: flex-direction column.").

### Stack on the phone

`element.stackOnPhone` writes one column at the narrowest breakpoint alone (properties.json lists the cascade
widest first, so the last is the Phone), whatever breakpoint and state the editor edits: a flex container takes
`flex-direction: column`, a grid container one track (`minmax(0, 1fr)`) at that breakpoint. Every other breakpoint
is untouched — the row a person built for the Desktop stays a row there. The status bar names the breakpoint
("Row: one column at Phone."). The same element twice changes nothing and records no entry.

### Organize the children

`element.organize` reads where the selected container's children lie (the layout port) and lays them out the way
they already run: the line is a column when each child stands below the one before it (and the boxes do not also
run across), a row when each stands beside; the gap is the whole-pixel distance most of the neighbours stand
apart. The container takes `display: flex`, that `flex-direction` and that gap at the edge the editor edits, and
each child's margins along that line — the ones it holds at that layer — are removed with them, so the spacing
moves into the gap and **what the page shows does not move**. One undo step. A child the canvas draws no box for
is refused with its container named (`status.organize.unmeasured`) rather than guessed.

### The divider between two columns

For a selected flex row, the canvas chrome draws a grip on the boundary between each two of its columns
(`divider.grip` wide, over the gap band, in its own colour). Dragging it writes the two children's share of the
row: the width asked for the child before the boundary gives the fraction of the room they share, and both take it
as their `flex-grow` (`flex-basis: 0px`, so the free space splits by it and the proportion holds however the
container is resized afterwards). A width below a column's least (`divider.minWidth`) is bounded to it, on either
side. One gesture is one undo step; the status bar names the row and the two shares ("Split of Row: columns of 28%
and 72%.").

### Wrapping what the page would show differently asks first (A3.13)

Wrapping does not always keep what the page shows: a positioned element leaves the flow it was placed in, and
selected siblings that were not next to each other come out in another order (the elements between them stay
outside the wrapper). Both cases ask the person first — the confirmation dialog of `element.wrapRow`,
`element.wrapColumn`, `element.wrapContainer` and `element.wrapGrid` — and cancelling changes nothing ("Cancelled:
nothing changed."). The other half of A3.13 is in spec duplicate (the copy of a positioned element moves off the
original) and spec nest-into-previous (a change of parent keeps the element where it is drawn).

### Problems in Pager

1. **The quick actions do not exist**: Pager wraps in a row or a column only, by key, and has no wrap in a
   container or a grid, no swap, no stack per breakpoint, no organize and no divider; the ratio of two columns is
   edited by hand in the Style panel. Required: the seven actions above, in the context menu, the Arrange menu and
   by key, and the divider on the canvas.
2. **A grid is not responsive**: a grid keeps its columns at every width, so a three-column grid of cards is
   unreadable on a phone (the audit's A1.4: "sem override, a grade fica com 3 colunas de 85 px no Phone"). Required:
   one track per element at the base breakpoint, two at the Tablet while it holds more, one at the Phone, written
   by the one owner of the tracks and by every path that creates such a grid (the wrapper and the template).
3. **Wrapping changes what is shown without a word**: Pager wraps a positioned element, or elements that were not
   next to each other, silently. Required: ask first, and change nothing when the person cancels.

## layout-grid-overlay

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, dark theme) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `Ctrl+'` toggles the column grid (`view.toggleLayoutGrid`, `src/features/workspace/dock.js:571`, which clicks `#gridBtn`, `src/features/precision/index.js:486-511`, `:528-539`).
- The Canvas tools menu / Guides & Grids panel switch the column grid, row grid and dot grid (`precision/index.js:396-417`, `:446-452`).
- The grid is drawn only while the canvas "guides" (element outlines) flag is on; turning the grid on with that flag off also turns the flag on, and turning the grid off turns it off again if the grid had turned it on (`:486-511`).

### Hit zones and thresholds

- Defaults (`gdpGrid`, `:95-106`): 12 columns, 1280 px wide, 24 px gutter, 80 px margin; rows 80 px with 24 px gutter; dots every 24 px.
- Column band placement: inset = max(margin, (page width − grid width) ÷ 2) (`gdpGridLines`, `:541-555`); columns fill the band with the gutters between them. The overlay is a CSS gradient on the page (`--grid-cols`, `:140-168`).
- Grid lines are snap targets when snap is on (`:564-570`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After `Ctrl+'` | Twelve filled column bands over the page; every element also gets a dashed outline (the guides flag was switched on with it); status `Layout grid on, 12 columns — guides were off, so they are on too: the grid is drawn with them.` In the dark theme the bands are opaque and **hide the page content** under them (the Heading and Paragraph text are covered). | ![grid](img/layout-grid-overlay--01-column-grid.png) |
| `Ctrl+'` again | Grid and outlines removed; status `Layout grid off, 12 columns — the guides came on with it, so they are off again.` | — |

### Result in the document

The grid settings (`on`, columns, width, gutter, margin, rows, dots) are stored per page in the project (`page.grid`) through `editProject`; never exported.

### Undo and redo

Toggling the grid is a project edit and therefore undoable.

### Nested elements

Not applicable.

### Zoom other than 100 %

The overlay is in page px and scales with the page.

### Keyboard equivalent

`Ctrl+'`.

### Our rule: the grids belong to a breakpoint, and the columns run the frame down (the user's real-use audit, A1.6 and A3.17)

- **Each grid's settings are held per breakpoint**, as every style value is, and a breakpoint may have its own default
  (`interactions.json`: `grid.columns.tablet` = 8, `grid.columns.phone` = 4, `grid.margin.phone` = 16; the base
  breakpoint's `grid.columns` = 12 and `grid.margin` = 80 stand for the others). A document written before this holds
  a flat record, which then reads as the base breakpoint's. Guides & Grids edits the grid at the breakpoint in force,
  and its fields show that breakpoint's values; the status names the breakpoint when it is not the base
  (`status.grid.setAt`). The audit's finding: one setting for every breakpoint left the Phone and the Tablet with no
  column grid drawn at all.
- **The column grid covers the frame's whole visible height** as well as the page's: the bands run to the bottom of
  what the frame shows, so the grid never stops at the body's content box (A3.17: the columns measured 964 px on a
  1378 px page, and below the last element the canvas showed no grid).
- The layout grids are translucent (`color-mix` at 6 % of their colour): the page reads through them (the audit, item
  4.5).

### Problems in Pager

1. **The column bands are opaque and cover the page content** (dark theme). Required: overlays are translucent (design token for overlay colour) and never hide the content beneath.
2. **Turning the grid on also turns on element outlines.** Required: the grid overlay is independent of element outlines; `Ctrl+'` toggles only the column grid.
3. **The Guides & Grids settings stacked each label over a 28 px box** (jornada02 pairing 5.2). Required: each setting of the dialog is a field row: its label in the card's 72 px column, its 24 px field beside it, two settings to a line.

## lock-element

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Paragraph, Paragraph 2].

### Trigger

- The lock button on a Layers row (second-to-last control, 24 × 28 px; `src/features/layers/layers-panel.js:323-335`, handler `toggleNodeFlag` `:722-733`).
- The selection bar's "lock/unlock" button (`src/app/boot.js:337-338`).
- No shortcut.

### Hit zones and thresholds

- A lock applies to the node and every descendant (`lockedAncestorOf`). Only the node that carries the lock can be unlocked; toggling a descendant's lock while an ancestor is locked is refused (`layers-panel.js:724-728`).
- Locked nodes can still be selected; the press on them is a selection only (`boot.js:480-481`), no drag is armed.
- Refused while locked (document JSON unchanged), observed on a Paragraph inside a locked Section:
  - drag → no drag starts; status `🔒 Section is locked — click the lock in its bar to move it`;
  - Delete → `Unlock “Section” before deleting it.` (refusal tag);
  - R → refused with the lock message;
  - double-click on the text → no editing starts (`editText` checks `lockedAncestorOf`, `boot.js:587`);
  - drag of its Layers row → nothing moves.
- Locked containers and their descendants are not drop receivers (`src/features/drag/drag.js:406`, `:749-751`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Section locked from its row | The row gets the `locked` class (dimmed name) and the lock button stays pressed (`aria-pressed="true"`, title `Unlock`). **No status message** is written by the Layers toggle. | ![locked row](img/lock-element--01-locked-row.png) |

### Result in the document

The node gets `locked: true` in the document JSON (observed); unlocking removes it.

### Undo and redo

Lock and unlock are history entries (`nwToggleBoolean` inside a transaction).

### Nested elements

Everything inside a locked container is protected; the children can still be selected and inspected.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **The refusal message points to the wrong place** (`click the lock in its bar`), while the lock is on the Layers row. Required: messages such as `Unlock <name> before deleting it` / `Unlock <name> before moving it`, naming the locked ancestor (manifest feature `lock-element`).
2. **Toggling the lock from Layers says nothing.** Required: the status bar reads `Locked: <name>` / `Unlocked: <name>` for every door (the selection bar already does).
3. **A double-click on locked text does nothing and says nothing.** Required: the status bar says `Unlock <name> before editing its text`.
4. **A locked element's style fields looked editable** (the user's real-use audit, A3.11): the refusal came only after typing, and what was typed was lost. Required: while a selected element, or an element above it, is locked, every style field of the Style tab and the quick panel, and the colour swatch that opens the picker, is drawn disabled before anything is typed, its tooltip the lock's refusal naming the lock (`Unlock Actions before changing it.`, `Intro is locked by Hero; unlock Hero first.`; predicate `editableSelection`); unlocked, it takes input again. A menu action (Reset all) and the alignment matrix, whose door keeps its own predicate, refuse after the press with the same message.
5. **Nothing in the Style tab said the element was locked** (the audit's S-030: 110 of 113 controls drawn disabled, the reason only in each one's tooltip). Required: while a selected element, or an element above it, is locked, the Style tab says so once at its top, in the lock's own words (`Unlock Actions before changing it.`, `Intro is locked by Hero; unlock Hero first.`); unlocked, the notice goes.

## marquee-select

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: Section (padding 56 px 40 px) > [Heading, Paragraph, Paragraph 2]; the page is 640 px tall, so there is empty page area below the Section.

### Trigger

- Primary-button press on the **Page root** (empty page area) or on the stage/overlay outside the page, captured before any other handler (`src/features/marquee/index.js:63-78`, listener in capture phase `:211`). Not in preview, not while the pan tool or Space is armed, not on handles, chips or the selection bar.
- A press on any other element (including a Section's padding) is that element's gesture (select/drag), never a marquee (`marquee/index.js:72-75`). Observed: press on a Paragraph + 30 px move started a drag (`dragging`), no band.
- The band appears after **4 px** of movement in screen pixels (`:118-124`, `DRAG_THRESHOLD_PX`).
- Modifiers read at press time: Shift = add, Ctrl/Cmd = toggle, none = replace (`:58`). Alt, held while the band is drawn, takes the leaves (Problems in Pager 3).
- `Escape`, `pointercancel`, a lost capture or window blur cancel and restore the selection held at the press (`:156-169`).

### Hit zones and thresholds

- Candidates: every descendant of the Page that is not locked or hidden, measured once at the press (`:79-98`).
- Leaf elements are taken when the band **touches** them (any overlap); containers only when the band **contains** them entirely; a taken element whose ancestor is also taken is dropped (`:127-130`, `src/platform/box-geometry.js:179-203`).
- The selection is recomputed on every move from the same starting selection (`box-geometry.js:216-228`), so it follows the band live.

### Our rules (Problems in Pager 3 and 4)

- The band takes the **direct children of the container where it started**, each one the band touches (containers and leaves alike, any overlap). The container where it started is the one whose own area the press hit — the deepest element under the press point that is not a child of another; a band pressed on the page root's empty area works over the page's children.
- **Shift + press on an element** (not the page root) starts a band over that element's siblings: the children of its parent, the pressed element included when the band touches it. This is the way to band a grid full of cards, where no empty area of the grid is pressable.
- **Alt**, held while the band is drawn, takes the leaves instead: every leaf (an element whose content is not children) the band touches, a container only when the band contains it entirely, and a taken element replaces its descendants.
- An element that is locked, or inside a locked one, or hidden, is never taken; the ones the band hit are counted in the status bar ("{count} elements selected, {skipped} locked or hidden left out.").

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging from empty page area up over the two Paragraphs | A band with a 1 px accent border and a 16 % accent fill (`style/06-canvas-chrome.css:481`); the touched elements are already selected (union outline, chip `2 elements`). | ![dragging](img/marquee-select--01-dragging.png) |
| Released | The band disappears; status `2 elements selected.` (`canvas.marquee.took`). | ![released](img/marquee-select--02-released.png) |

### Result in the document

Selection only. Observed:

| Gesture | Selection | Status |
|---|---|---|
| band from (600,400) to the Paragraph's middle | Paragraph, Paragraph 2 | `2 elements selected.` |
| Shift + band over Paragraph 2 | Paragraph, Paragraph 2 (already in) | `2 elements selected.` |
| Ctrl + band touching Heading, Paragraph, Paragraph 2 | Heading (the two paragraphs toggled out) | `1 element selected.` |
| band covering all three but not the whole Section | Heading, Paragraph, Paragraph 2 (Section not contained) | `3 elements selected.` |
| band + Escape | the selection before the press | `Cancelled — nothing changed.` |
| press and release without moving | the Page root | — |

### Undo and redo

Not undo steps.

### Nested elements

A press on the empty area of any container starts a marquee inside it (Problems in Pager 1), and a Shift+press on a nested element starts one over its siblings (Problems in Pager 4); the band takes one level at a time, descended with Alt (Problems in Pager 3).

### Zoom other than 100 %

The 4 px threshold is in screen px (`marquee/index.js:119-120`); element boxes are measured on the zoomed canvas.

### Keyboard equivalent

`Ctrl+A` is covered by `select-container-children.md` (not bound in Pager).

### Problems in Pager

1. **A marquee cannot start inside a container,** e.g. in a tall Section's empty padding. Required: a press on the empty area of any container (not on a child) starts a marquee limited to that container's descendants when the pointer moves 4 px; without movement it selects the container. Elements that contain the start point are never taken (manifest feature `marquee-select`).
2. **A press without movement on the stage outside the page selects the Page root** (the marquee path). Required: it clears the selection (see `select-click.md`).
3. **A band takes leaves, never the containers they sit in.** Observed in a grid full of cards: starting in the Section's padding and dragging over two cards selects the Image and the Heading inside each card, not the cards (user's real-use audit, item 3.7). Required: the band takes the direct children of the container where it started, each one the band touches; Alt takes the leaves instead. And an element that is locked or hidden is left out, with the count in the status bar.
4. **A grid full of cards leaves no place to start a band,** and a press on a card is that card's gesture. Required: Shift + press on an element starts a band over its siblings, the children of its parent.

## media-embed-rules

How Pager behaves, read from its source (it was not run for this spec). Source references are `path:line` inside Pager.

### Trigger

- A Video's or Audio's parts editor (`parts.js`), whose Add source and Add track buttons add an empty part; the
  controls toggle `autoplay`, `muted`, `loop`, `controls`, `playsinline`, `preload` and `poster`.
- An Image's Alternative text field (a plain text input).
- An SVG's markup field (a text area, `element.setSvgMarkup`'s door) and the shapes editor's Add rectangle.
- An Embed's markup field (`element.setEmbedMarkup`'s door).

### Result

- **Empty parts are exported as empty tags.** A `<source src="">` and a `<track src="">` with no address are written
  into the page (`export/index.js` writes every child). Observed in an export of a Video with one Source and one
  Track: `<source src="">`, `<source src="">`, `<track src="">`.
- **Autoplay without muted is exported as it is**, and a browser refuses to play it — the page shows a still frame.
- **An emptied alternative text removes the attribute** (the same rule as every other attribute): the export writes
  `<img>` with no `alt`, which a screen reader reads as the file's name.
- **A whole `<svg>` pasted into the markup is kept as written**, so the page ends up with `<svg><svg>…</svg></svg>`
  (observed by typing a complete `<svg>` into Pager's markup field and exporting).
- **A shape can be added beside a markup** (Add rectangle writes a shape node next to the markup group), so the
  element has two owners of its content and a re-edit of one loses the other's work.
- **An Embed's markup is written verbatim**, script tags and event attributes included, with nothing in the editor
  saying so.

### Visual feedback

| Stage | What is drawn |
|---|---|
| An empty part | A row in the parts editor; nothing on the canvas (a `<source>` has no box). Nothing says it is a draft. |
| An emptied alternative text | The field is empty: the same as an image that never had one. |
| Markup typed | The canvas draws the shapes and the markup together. |

### Undo and redo

Each field and each part button is one undo step; the coupling written below records one step for the pair.

### Problems in Pager

Each is required (the user's real-use audit, A3.6); the rules hold for the canvas and the export alike, and the
document stays the source of truth:

1. **A media part with no address is never exported.** A `<source>` or `<track>` the person added and did not fill
   yet stays in the document and in its parts editor, and nothing of it reaches the page
   (`writesNode`, `src/core/render/output.ts`): a Video with one filled Source exports one `<source src="…">` and no
   empty tag. The canvas keeps drawing the document it is given (an empty part draws nothing, as a `<source>` never
   does), so the editor and the export never disagree about what the person sees and what the page says.
2. **Autoplay switches Muted on with it**, in the same undo step (`element.setAttribute`,
   `src/core/elements/attributes.ts`): a browser blocks an audible autoplay, so the setting alone would leave a still
   frame where the person asked for a playing one. Unticking Autoplay leaves Muted as it is.
3. **An empty alternative text is a value of its own**: an image whose Alternative text is emptied is decorative — the
   document stores `alt: ""` (`keepsEmpty` on the attribute, `elements.json`) and the export writes `alt=""`, which a
   screen reader skips. An attribute the person never filled has no `alt` at all, and the Checks panel reports it
   (feature accessibility-checks).
4. **A whole `<svg>` pasted into the markup is unwrapped** (`src/core/elements/svg.ts`, `sanitizedSvgMarkup`): the
   element the markup is pasted into is the SVG, and `<svg><circle/></svg>` is stored as `<circle/>`. A self-closing
   `<svg/>` alone empties the markup.
5. **An SVG's content has one owner at a time**: an SVG that draws a markup takes no shape parts — Add rectangle (and
   its siblings) is refused with `status.svg.holdsMarkup`, and the person clears the markup to place shapes. The
   shapes written into the markup by hand are the markup's own and are never split into part nodes.
6. **An Embed says its code runs in the published page** (`holdsExecutableCode`, `src/core/elements/embed.ts`): while
   the markup holds a `<script>`, an `on…` attribute or a `javascript:` address, the field shows
   `settings.embedRunsCode` beside it. The export writes the code as it is; the canvas keeps it in a sandboxed frame
   where it never runs.
7. **An image with no source shows a neutral 16:9 marker on the canvas** (jornada03 J22: an 800 × 300 band, naming a
   size, spanned widths the picture chosen later would not, and the layout jumped when it arrived): a grey 640 × 360
   picture with a picture glyph and no words, which keeps its proportion at any width the image is given. Editor-only:
   the document holds no source and the export writes none (the Checks panel reports it).

## move-up-down

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph, Paragraph 2].

### Trigger

- `Alt+ArrowUp` / `Alt+ArrowDown` with the canvas focused and something selected (`src/features/input/index.js:714-718`, handler `moveSelectionBy`, `:629-658`).
- On a focused Layers row the same keys select that row and run the same command (`src/features/layers/layers-panel.js:410-417`).
- Other doors: selection bar "move up/down within the parent", Arrange menu Move up/Move down, context menu Move up/Move down. The context menu items use a separate handler that moves by exactly one index (`layers-panel.js:515-528`).

### Hit zones and thresholds

- Each press swaps every selected node with its previous (or next) sibling that is not selected; the relative order of selected nodes is kept (`input/index.js:642-649`).
- All selected nodes must share one parent, else the command is refused with "Move the selected elements into one parent before reordering them together." (`:638-641`).
- Locked or hidden selections are refused (`:631-637`).
- Absolute or fixed positioned selections: `Alt+Arrow` still reorders (the nudge rows require no Alt, `:719-726`).

### Visual feedback

No indicator: the element moves on the canvas and in Layers at once, stays selected, and the status bar reads `Moved 1 selected elements within Section.` At the ends: `Already at the start of Section.` / `Already at the end of Section.`

Where a press would move nothing (the selected standing together against the edge they would pass, elements of two parents, nothing selected), Move up and Move down are drawn disabled before any press — the Arrange menu, the context menu — their title the words the press says (`Already at the start of Section.`), as the canonical Arrange menu draws Move up on a first child (availability `canMoveUp`, `canMoveDown`, asking the commands' own check; MV1). A shortcut pressed there says the same words.

### Result in the document

Observed from [Heading, Paragraph, Paragraph 2] with Paragraph 2 selected:

| Key | Children of Section | Status |
|---|---|---|
| Alt+ArrowUp | Heading, Paragraph 2, Paragraph | Moved 1 selected elements within Section. |
| Alt+ArrowUp | Paragraph 2, Heading, Paragraph | Moved 1 … |
| Alt+ArrowUp | unchanged | Already at the start of Section. |
| Alt+ArrowDown | Heading, Paragraph 2, Paragraph | Moved 1 … |
| Alt+ArrowDown ×2 | Heading, Paragraph, Paragraph 2 (second press: unchanged) | Already at the end of Section. |

The write is one `nwReorder` of the parent's child list inside a transaction (`input/index.js:654`).

### Undo and redo

Each press that moves is one history entry; a press at the edge adds none.

### Nested elements

Only siblings are swapped; the command never leaves the parent (see `promote-out.md` and `nest-into-previous.md`).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The keys are the primary door.

### Problems in Pager

1. **The status text is not pluralised** (`Moved 1 selected elements`). Required: `Moved <name> to position N of M in <parent>.` for one element and `Moved N elements within <parent>.` for several, through i18n plural rules.
2. **Two implementations exist:** the keyboard path reorders the whole selection (`input/index.js:629-658`), the context-menu path moves only the primary node by one index (`layers-panel.js:515-528`), with different messages and different lock checks, and the menu path says nothing at the edges. Required: one command, used by the keys, the menus, the selection bar and Layers.

## multi-select-actions

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph, Paragraph 2, Paragraph 3]; Paragraph 2 and Paragraph 3 selected with click + Shift+click.

### Trigger

The same keys as for one element, with a multi-selection:

| Key / gesture | Multi-selection behaviour | Source |
|---|---|---|
| Alt+ArrowUp / Alt+ArrowDown | move every selected root one step, keeping their order; all must share one parent | `src/features/input/index.js:629-658` |
| Ctrl+D | duplicate each selected root right after itself | `src/app/boot.js:325-336` |
| Delete / Backspace | remove every selected root | `input/index.js:604-627` |
| Drag any selected element | moves the whole group (ghost `⠿ 2 elements`) | `src/features/drag/drag.js:1247-1302`, `:1349-1373` |
| R, C, P, M, F2, Enter | refused: `This action needs one selected element.` | `input/index.js:759-819` |

### Hit zones and thresholds

A press inside the group's union outline, even on empty space between members, grabs the whole group (`boot.js:468-475`). Members that are descendants of other members are ignored (selected roots only).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Two paragraphs selected | Union outline and chip `2 elements`. | ![two](img/multi-select-actions--01-two-selected.png) |
| After Ctrl+D | The two copies are inserted after their originals and become the selection; status `Duplicated 2 selected elements.` | ![duplicate](img/multi-select-actions--02-after-duplicate.png) |
| Dragging the group over the upper half of the Heading | Ghost `⠿ 2 elements`; line before the Heading; label `Move to position 1 · Section · before Heading`. | ![group drag](img/multi-select-actions--03-group-drag.png) |

### Result in the document

Observed:

| Step | Children of Section | Selection | Status |
|---|---|---|---|
| start | Heading, P, P2, P3 | P2, P3 | — |
| Alt+ArrowUp | Heading, P2, P3, P | P2, P3 | `Moved 2 selected elements within Section.` |
| Ctrl+D | Heading, P2, P2′, P3, P3′, P | P2′, P3′ | `Duplicated 2 selected elements.` |
| Delete | Heading, P2, P3, P | (none) | `Removed 2 selected elements.` |
| Ctrl+Z | back to the Ctrl+D state | P2′, P3′ | `↶ Undone` |
| R / P / M / F2 / Enter | unchanged | unchanged | `This action needs one selected element.` (refusal) |
| drag the group before the Heading | P2′, P3′, Heading, P2, P3, P | P2′, P3′ | `✓ Move to position 1 · Section · before Heading` |

Non-adjacent members dropped together land adjacent, in document order.

### Undo and redo

Each multi-element command is one history entry.

### Nested elements

Only selected roots act; a selected descendant of a selected container moves with the container.

### Zoom other than 100 %

As for a single drag.

### Keyboard equivalent

The keys above.

### Problems in Pager

1. **After a multi-delete nothing is selected.** Required: the selection moves to the element after the last removed one, else before the first, else the common parent (as for a single delete).
2. **`Moved 2 selected elements` / `Removed 2 selected elements`** are fine, but the single-element cases reuse the plural sentence (`Moved 1 selected elements`). Required: correct singular/plural through i18n.
3. **Wrap refuses a multi-selection** (`This action needs one selected element.`, `src/app/boot.js:275-277`). Required: R or C with several siblings of one parent selected wraps them together in one new Row or Column placed where the first of them was, keeping their order, as one undo step; a selection whose elements have different parents is refused with a message (manifest feature `multi-select-actions`).

## multi-select-click

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph, Paragraph 2].

### Trigger

- **Shift+press** on a canvas element toggles it in or out of the selection and does not arm a drag (`src/app/boot.js:484`, `selectMore` → `selection.toggle`, `src/features/layers/layers-panel.js:713-717`). The Page root is never added (`:714`).
- **Shift+click** on a Layers row does the same (`boot.js:135`).
- **Ctrl+press** has no selection meaning in Pager: it selects only the clicked element (like a plain press) and, if dragged, duplicates (`boot.js:496-497`, `src/features/drag/drag.js:307-311`).
- **Escape** clears the whole selection (`src/features/input/index.js:682-684`).

### Hit zones and thresholds

Same hit test as `select-click.md`. Caution observed in Pager: the hover chip of a neighbouring element (drawn above that element's top-left corner, min 120 × 20 px) is itself a press target; a Shift+click on the left part of a paragraph's text toggled the paragraph **below** it, whose chip covered that spot.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Click Heading, Shift+click Paragraph and Paragraph 2 | One outline around the **union** of the three boxes (not one per element), class `multi`, no resize handles (`style/06-canvas-chrome.css:161`), chip reading `3 elements`; the three Layers rows are highlighted. | ![three](img/multi-select-click--01-shift-three.png) |

### Result in the document

Selection only; the document JSON never changes. Observed sequence:

| Action | Selection |
|---|---|
| click Heading, Shift+click Paragraph, Shift+click Paragraph 2 | Heading, Paragraph, Paragraph 2 |
| Shift+click Paragraph | Heading, Paragraph 2 |
| Ctrl+click Paragraph | Paragraph |
| Shift+click the Heading row in Layers | Paragraph, Heading |
| Escape | (empty) |

The primary element (the one the Inspector edits) is the last one added.

### Undo and redo

Not undo steps.

### Nested elements

An ancestor and its descendant can both be selected; commands then act on the selected roots only (`selectedRoots`, `src/features/drag/drag.js:1349-1354`).

### Zoom other than 100 %

Unaffected; the union outline is mapped through the zoom.

### Keyboard equivalent

See `select-container-children.md` and `layers-keyboard-navigation.md`.

### Problems in Pager

1. **Ctrl+click does not toggle.** Required: Ctrl+click toggles an element in or out of the selection; Shift+click adds (manifest feature `multi-select-click`).
2. **Shift+click toggles instead of adding,** so a second Shift+click removes an element. Required: Shift+click adds; removing is Ctrl+click.
3. **Only one outline around the union is drawn.** Required: each selected element has its own outline, plus the count chip `N elements`. The union is outlined dashed and its label reads the count and the size of the box that holds them all (the canonical "3 elements selected 1248 × 390"); the Style tab's selector bar names the count and their tags ("3 elements  article × 3", distinct tags listed) and says that different values show as Mixed; the status bar reads that box's size and the path to the nearest element that holds them all, which wears the current mark.
4. **Hover chips intercept clicks meant for the element under them** (see Hit zones). Required: chips never cover another element's content while it could be clicked; when they must overlap, clicks on them pass to the element under the pointer unless the chip itself is the intended drag handle of the selected element.


**Layers (stage 5, jornada03 J17):** Shift+click on a Layers row selects the run of rows between the node selected last
and the row clicked (`selection.range`), siblings in order from that node to the clicked one; a row of another parent
is added alone; Ctrl+click on a row adds or removes that one row. Shift+click on the canvas still adds the element.

## multi-select-edit

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph, Paragraph] with different font sizes.

### Trigger

- Select several elements (Shift+click on the canvas or in Layers, spec `multi-select-click`), then type a value in a field of the inspector or of the quick panel and press Enter (or leave the field).

### What the fields show

- The inspector compares, for each field, the value of every selected element (its declared value, else the value in force) with the first one's (`src/features/inspector/properties.js:3240-3244`, `ppMixed`). When one differs, the field shows no value and the placeholder `Mixed` (`:3247-3258`); when they are all equal, the field shows the value as for one element.
- The quick panel builds one model per selected element and marks the fields whose values differ (`src/features/inspector/quick-panel.js:431-434`): those fields show the placeholder `Mixed` (`:254`) and no value, **except the colour fields** (`backgroundColor`, `color`), which keep showing the primary element's colour (`:433`).

### Result in the document

- A committed value is written to every selected element, at the active breakpoint and state, in one transaction (`quick-panel.js:354-390`, the inspector's `ppWrite`); the status bar says how many elements took it.

### Undo and redo

One undo step restores every element's own previous value (each element's declaration, or its absence); redo writes the value to all of them again.

### Nested elements

A selection of an element and one of its descendants writes to both.

### Keyboard equivalent

The fields' keys (Enter, Escape, the arrows) act on every selected element the same way.

### Problems in Pager

1. **The colour fields hide that the elements differ** (`quick-panel.js:433`): they show the primary element's colour although the others have other colours. Required: every field, colours included, shows `Mixed` [inspector.mixedValue] when the selected elements' values differ, in the inspector and in the quick panel alike.
2. **Two different rules decide what is mixed** (the inspector compares declared-or-in-force values, the quick panel its own model). Required: one rule, one owner, for both: an element's value is the one it declares at the base breakpoint and state, else the value the page computes; the field is mixed when any selected element's value differs from the primary's.
3. **A mixed field keeps no hint of what typing does.** Required: a mixed field shows no value, so what is typed is the whole new value for every selected element; Escape leaves it mixed.
4. **Mixed values were said in some controls only** (the user's real-use audit, A3.35): with two elements of different values, Text align and Position showed every button off with nothing saying why, the spacing box and the alignment matrix showed the first element's value while the field beside said Mixed, the linked field of a box whose four sides differ was empty, Reset stayed off when only one of the elements held a value, and both links of the box were titled "Link all four sides". Required: every control says a value the selected elements do not share in the same way: a field's placeholder "Mixed", and beside a control that has none (the segmented buttons, the matrix) the word "Mixed", with no button or cell pressed — in the control's own cell, never on a line of its own under the label (the audit's S-032); buttons that cannot hold the word beside them in the value column are the keyword menu instead (props-position, Problems in Pager 3), its button saying "Mixed" and no item of its list checked; the spacing box's side fields and a linked box whose sides differ say Mixed; Reset this value is drawn when any selected element holds a value of its own and takes it away from all of them in one step; each box's link names its box ("Link the four sides of Margin", "… of Padding").

## multi-tab-guard

Pager has no guard: two tabs of the app write the same IndexedDB record in turn, the last write winning (`src/features/documents/index.js`, `docWriteNowRun`, `:267-278`, writes whenever its own tab changed).

### Our rule

- The tab that opens first **edits**: it holds the editing lock (the browser's Web Locks, one lock for the project), writes autosave, runs every command.
- A tab that opens while another holds the lock is **read-only**: it shows the saved project, a notice across the window says the project is being edited in another tab (`tabGuard.readOnlyNotice`), with **Take over editing** (`project.takeOverEditing`). It never writes to IndexedDB, and every command that would change the document is refused with the status bar saying why (`status.tabGuard.readOnly`); the selection, the view and the panels still work.
- **Take over editing** takes the lock from the other tab and starts this tab again on the latest saved project, now editing. The other tab, its lock taken, becomes read-only at once, with a notice that another tab took over (`tabGuard.lostNotice`) and the same button. Its unsaved change, if any, is already in the journal and IndexedDB is written only by the tab that edits, so writes from two tabs never interleave.

### Refusals

- In a read-only tab, a command that changes the document: `status.tabGuard.readOnly`, nothing changes.

### Problems in Pager

1. **Two tabs write the same project in turn;** the one written last silently wins and the other's work is lost at the next start. Required: one editing tab, the others read-only, until one takes over.

### Undo and redo

A read-only tab records nothing: its document commands are refused.
2. **The read-only notice covered the top bar's page switcher and Commands** (the audit's U-024). Required: the notice hangs under the top bar, centred, never over it.

- **A reloaded tab said another tab was editing** (the user's report): the page it replaced still held the editing lock
  for a moment. Required: a tab that finds the lock held asks again for up to 2 seconds before it is read-only, so the
  one tab reloaded keeps editing; a second tab opened while the first edits is read-only after that wait.

## natural-child-command

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Command `selection.add` (`src/app/boot.js:220-221`), run by `selbarAction("add")` (`boot.js:288-298`). Its label names the child tag: `create <li> inside` (`selbar.add.into`).
- **Its only door is the command bar** (`Ctrl+K`, type `inside` or `create`). It is not in the context menu (observed on a List: Rename, Copy, Paste, Move up, Move down, Make child of previous layer, Move out of parent, Delete), not in the selection bar, and has no key.
- The command exists when the selected type has a `naturalChild` (`src/model/elements.js`, e.g. `list` → `listitem`, `select` → `option`, `figure` → `figcaption`, `tbody` → `trow`, `details` → `summary`, `table` → `tbody`, `form` → `label`, `fieldset` → `legend`, `blockquote` → `paragraph`) and no ancestor is locked (`boot.js:220`). For a type without one (Paragraph, Section) the command is **absent** from the bar, not shown disabled.

### Hit zones and thresholds

The child type is `NATURAL_CHILD[selected.type]`. Before creating, `siblingBad` is checked (`boot.js:292-293`), so a unique child that is already present is refused **when run**. The command is not disabled in advance.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Details that already has its Summary, command bar query `inside` | `create <summary> inside` is offered as a normal, enabled row. | ![details](img/natural-child-command--01-details-with-summary.png) |

After a successful run the new child is selected (outline, chip) and the status reads `Created inside: <name>`.

### Result in the document

Observed (each run from the command bar with the container selected):

| Selected | New child | Status | Selected after |
|---|---|---|---|
| Unordered list | `listitem`, **empty** (no text, no children) | `Created inside: Item` | the new `<li>` |
| Select | `option` with text `Option` | `Created inside: Option` | the new `<option>` |
| Figure (no caption) | `figcaption` with text `Caption` | `Created inside: Caption` | the new `<figcaption>` |
| Table body | `trow` with **no cells** | `Created inside: Row` | the new `<tr>` |
| Details without Summary | `summary` | `Created inside: Summary` | the new `<summary>` |
| Details with its Summary | nothing | `REFUSED <details> accepts a single <summary>` | unchanged |

The child is appended as the last child (`nwAppendChild`, `boot.js:295`).

### Undo and redo

One transaction, one undo step (observed: Ctrl+Z after creating the Summary removed it, `↶ Undone`).

### Nested elements

Only the selected container gets a child; its descendants are not considered.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Ctrl+K, type, Enter.

### Problems in Pager

1. **The command is missing from the context menu.** Required: the context menu of a container with a natural child shows `Create <tag> inside`, naming the child tag (manifest feature `natural-child-command`).
2. **It stays enabled when it can only be refused** (Details with Summary). Required: it is disabled when the element has no natural child or the child is unique and already present.
3. **Some children are created without default content:** an empty `<li>` and a `<tr>` with no cells. Required: the new child gets default content: an `<li>` with a text Paragraph, and a `<tr>` with as many cells as the table's other rows (`th` in a head, `td` elsewhere).

## nest-into-previous

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Page > [Container, Paragraph].

### Trigger

- Context menu (canvas or Layers row) → **Make child of previous layer** (`indentLayer`, `src/features/layers/layers-panel.js:530-544`).
- No shortcut and no other menu entry.

### Hit zones and thresholds

The receiver is the previous sibling in the same parent (`layers-panel.js:531-533`). The command does nothing — silently, with no message — when:
- there is no selection or no parent;
- the element is the first child (no previous sibling);
- the previous sibling is not a container.

It is refused with a status message when a lock applies (`🔒 <name> is locked …`) or when the nesting rules refuse the receiver (`fitsInWhy`, `ancestorBad`, `siblingBad`, `:537-539`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After the menu item on the Paragraph | The Paragraph moves inside the Container (last child), stays selected; status `Placed. Paragraph in Container, position 1 of 1.` | ![after](img/nest-into-previous--01-after-menu.png) |
| Same item on the Container (no previous sibling) | Nothing happens and nothing is said; the menu item was enabled. | — |

### Result in the document

`Page > [Container, Paragraph]` → `Page > [Container > [Paragraph]]` (appended as last child, `layers-panel.js:540`). Placement data (grid cell, absolute offsets) is cleared by `nwPlace` when the parent changes.

### Undo and redo

One history entry: Ctrl+Z restored `Page > [Container, Paragraph]` (observed).

### Nested elements

Only one level: the element goes into the immediately previous sibling, never deeper.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **The item is always enabled and fails silently** when there is no previous sibling or it cannot contain the element. Required: the item is disabled in those cases (with the reason in its tooltip) and the document JSON is unchanged (manifest feature `nest-into-previous`).
2. **No keyboard shortcut and no Arrange menu entry.** Required: the command is in the Arrange menu and in the keymap owner, so the shortcuts panel lists it (the key choice belongs to the keymap; it must not collide with R, C, P, M).
3. **The status wording (`Placed. … position 1 of 1.`) is the hand's wording.** Required: `Moved <name> into <receiver>, position N of M.`
4. **Make child of previous layer put an instance inside another** (the audit's AUD-04, 2026-10-02), which the model refuses. Required: an element that is or holds an instance goes into no instance: the door is unavailable and Alt+→ says "<name> is or holds an instance, and an instance goes inside no other (<instance>)."

## nesting-grammar-structure

Keyboard refusal scenarios explicitly choose their surface after adjusting zoom: click the selected item's Layers
row, then Escape for the canvas case, or keep the row focused for the Layers case. This reaches the structure
command without bypassing the deliberate-focus rule of keyboard-panel-navigation; the grammar refusals stay unchanged.

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. The rule data and functions are the ones described in `nesting-grammar.md` (`src/model/grammar.js`, `src/model/elements.js`).

### Trigger

| Command | Door used | Check in Pager |
|---|---|---|
| Wrap in row/column | `R` / `C` on the canvas | `src/features/input/index.js:781-813`: the element must fit in the new `div`; refusal `a11y.cannotWrap` (`:800`) |
| Promote one level | `P` on the canvas | `input/index.js:765-780`: `fitsIn(child, grandparent)`; refusal `a11y.cannotGoIn` (`:773`) |
| Unwrap (remove wrapper) | selection bar `Remove wrapper` (`data-act="unwrap"`) | `src/app/boot.js:192-217`: every child must fit in the wrapper's parent (`fitsIn`, `ancestorBad`, `siblingBad`, `:204-207`) |
| Tag switch | Inspector → Attributes → `Tag` menu | `src/features/inspector/catalogue.js:248-249` → `nwField(node, "tag", value)` (`src/commands/writes.js:118`): **no nesting check** |
| Hand | `M`, arrows, Enter | the aim goes through the drag validator (`src/features/drag/drag.js:735-779`), so it follows the assist rule: a slot that needs a wrapper is offered, not skipped |

### Hit zones and thresholds

No geometry: each command is checked when it runs. The Tag menu for a container lists `div, section, header, main, footer, nav, aside, article` (`semanticTags`, `src/model/tree.js:431-437`), whatever its children and parent are.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| `R` on a List item | Nothing on the canvas; the status bar shows the red `REFUSED` tag and `Cannot wrap Item. <li> cannot sit inside <div>.` | ![wrap refused](img/nesting-grammar-structure--02-wrap-refused-status.png) |
| List item in the hand, ArrowUp twice (aim at the Page) | The Page gets the green receiver tint, the pill reads `Move to position 2 · Page · after Section`, a Page-level insertion line is drawn, and the marker `✚ <ul> will be created here` is shown. Status: `Page will receive. Position 2 of 2. Through <ul>. Level 3 of 3.` | ![hand](img/nesting-grammar-structure--01-hand-aim.png) |

### Result in the document

Observed with Page > Section > List > [Item, Item]:

- `R` on an Item → refused, document unchanged: `REFUSED Cannot wrap Item. <li> cannot sit inside <div>.`
- `P` on an Item → refused, document unchanged: `REFUSED Refused. <li> cannot go in <section>.`
- `Remove wrapper` on the List → refused, document unchanged: `REFUSED Cannot remove List. Refused. <li> cannot go in <section>..` (with a doubled full stop). The button was enabled before the click.
- Section containing a Main, Tag → `header` → **accepted**: the node got `tag: "header"` and the iframe renders `<header><main>…</main></header>`; no message.
- Item taken into the hand (`M`), ArrowUp until `Page will receive … Through <ul>`, Enter → **placed**: a new `<ul>` holding the Item was appended to the Page; status `Placed. Item in Page, position 2 of 2.`; the new `<ul>` was selected.

### Undo and redo

Refusals leave no history entry. The accepted tag switch and the wrapped hand placement are one undo step each.

### Nested elements

Unwrap checks every child of the wrapper; the first child that does not fit refuses the whole command (`boot.js:204-207`).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

`R`, `C`, `P` and the hand keys are the keyboard doors. Unwrap and the tag switch have no key.

### Problems in Pager

1. **The tag switch ignores the nesting rules** (`<main>` ended inside `<header>`). Required: a tag switch that would break the rules is refused with a message naming the rule and the document JSON is unchanged (manifest feature `nesting-grammar-structure`).
2. **The hand offers targets the rules refuse,** reaching them through an automatic wrapper. Required: the hand never offers a target the rules refuse; such slots are skipped by the arrows.
3. **Each command carries its own copy of the check** (`fitsIn` in `P`, a hand-made loop in unwrap, the drag validator in the hand, nothing in the tag switch), and the messages differ in form (`Refused. … cannot go in …`, `Cannot wrap … cannot sit inside …`, a doubled full stop). Required: wrap, unwrap, promote, tag switch and hand call the same rule function as insert, drag and paste, and word their refusals the same way.

## nesting-grammar

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

The rules are checked whenever an element would get a new parent:

| Path | Where the check runs | What happens when the rules say no |
|---|---|---|
| Palette click (insert at selection) | `insertTypeAtSelection`, `src/features/input/index.js:185-201`, through the drag validator | a wrapper is created when one exists (see below); otherwise status `REFUSED Refused. <reason>` |
| Palette drag, canvas drag, Layers drag | the drag validator, `src/features/drag/drag.js:735-779` (Layers uses the same one, `drag.js:438-442`) | a wrapper is proposed when one exists (`p.assist`); otherwise the target is refused (`p.bad`) |
| Paste | `src/features/layers/layers-panel.js:670` (`fitsInWhy || ancestorBad || siblingBad`) | refused, with the reason in the status bar; never wrapped |
| Layers indent / outdent | `layers-panel.js:537-551` | refused, with the reason |

### Hit zones and thresholds

The rule data (`src/model/elements.js:27-84`, read by `src/model/grammar.js`):

- `only`: allowed children. `ul`/`ol` → `li`; `dl` → `dt`, `dd`; `table` → `caption`, `thead`, `tbody`, `tfoot`; `thead`/`tbody`/`tfoot` → `tr`; `tr` → `th`, `td`; `select` → `option`, `optgroup`; `optgroup` → `option`; `picture` → `source`, `img`.
- `needs`: required parent. `li` → `ul`/`ol`; `dt`/`dd` → `dl`; `caption`/`thead`/`tbody`/`tfoot` → `table`; `tr` → `thead`/`tbody`/`tfoot`; `th`/`td` → `tr`; `legend` → `fieldset`; `option` → `select`/`optgroup`; `optgroup` → `select`; `figcaption` → `figure`; `source` → `video`/`audio`/`picture`; `track` → `video`/`audio`; `summary` → `details`.
- `unique` (at most one per parent): `caption`, `legend`, `figcaption`, `summary` (`siblingBad`, `grammar.js:52-58`).
- Void / leaf elements: only types flagged `container` can have children (`grammar.js:5`, `:105-106`); on the canvas a leaf is never a receiver.
- Forbidden ancestry at any depth (`ancestorBad`, `grammar.js:35-50`): an interactive element inside a Link Block; a Form inside a Form. A Label holds one control only (`grammar.js:55-56`).
- Assist chains:
  - `wrapChain` (`grammar.js:59-69`) climbs `WRAP_IN` up to 4 levels, e.g. `li` → `ul`.
  - `adoptChain` (`grammar.js:70-76`) wraps the element in the parent's natural child, e.g. `p` in `ul` → a new `li`.
- Messages (`src/core/i18n.js:83-85`, `:1096-1103`):
  - `{child} cannot be placed inside {parent}.`
  - `{child} must be inside {ancestor}.`
  - `An interactive element cannot sit inside a Link Block`
  - `{parent} accepts a single {child}`
  - In the drag validator only: `<ul> only accepts <li>`, `<li> only exists inside <ul>, <ol>` (`drag.js:772-773`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging a Paragraph to the gap after a List item (inside a `<ul>`) | **No refusal.** The List gets the green receiver tint, the pill reads `Move to position 2 · List · after Item`, an insertion line is drawn after the item, and the text `✚ <li> will be created here` follows the pointer. Status: `Create <li> + after item`. | ![assist](img/nesting-grammar--01-drag-p-into-ul.png) |
| Dragging a Link Block into another Link Block | The target gets a red tint and a red pill `Link Block · rejected`, and there is no insertion line. The reason `An interactive element cannot sit inside a Link Block` is drawn beside the pointer, partly hidden under the drag ghost. `<body>` gets the class `forbid`, and the status reads `Rejected`. | ![refused](img/nesting-grammar--02-refused-linkblock-in-linkblock.png) |

### Result in the document

Observed:

- Page root selected, click **List item** in the palette → a new `<ul>` holding the `<li>` was appended to the Page; status `Placed. List item in Page, position 2 of 2.`; the `<ul>` became the selection.
- List selected, click **Paragraph** → a new `<li>` holding the Paragraph was appended to the List; status `Placed. Paragraph in List, position 2 of 2.`
- Canvas drag of a Paragraph to the gap after a List item, released → the Paragraph ended up inside a new `<li>` in the List; the new `<li>` was selected.
- Copy a List item, select a Section, Ctrl+V → nothing pasted; status `ENGINE <li> must be inside <ul> / <ol>.`
- Link Block selected, click **Link Block** → nothing inserted; status `REFUSED Refused. An interactive element cannot sit inside a Link Block`.
- Link Block dragged into a Link Block and released → nothing changed; status `Cancelled — nothing changed`.

### Undo and redo

A wrapped insert or drop is one undo step (observed: one Ctrl+Z restored the tree exactly). Refusals leave no history entry.

### Nested elements

`ancestorBad` checks every ancestor of the receiver (a button three levels inside a Link Block is still refused). When a whole subtree is moved, every node in it is checked (`grammar.js:36-44`; `drag.js:740-744`).

### Zoom other than 100 %

Not affected: the rules do not depend on geometry.

### Keyboard equivalent

The same checks run for the hand (see `nesting-grammar-structure.md`) and for Ctrl+V.

### Problems in Pager

1. **Invalid placements are silently wrapped instead of refused** (palette click, canvas drag and Layers drag create `<ul>`/`<li>` wrappers). Required: each attempt is refused with a message such as `Refused. <ul> only accepts <li>` and the document JSON is unchanged (manifest feature `nesting-grammar`).
2. **The paths disagree:** paste refuses where click and drag wrap, and they use different message texts and tags (`REFUSED` vs `ENGINE`). Required: click insert, canvas drag, Layers drag and paste call the same rule function over one rule table (allowed children, required parents, unique children, void elements, no interactive content inside interactive content) and report its refusal the same way.
3. **The reason of a refused drag is lost on release** (`Cancelled — nothing changed`), and during the drag it is partly covered by the ghost. Required: during the drag the refused target shows the refusal indicator and the reason in full; releasing there reports `Refused. <reason>` in the status bar.

## new-blank-page

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager.

### Trigger

- Pager: File › New blank page (`src/app/boot.js:363`) replaces the document with a blank one at once (`replaceDocument(BLANK(), …, true)`, `src/features/documents/index.js:182-192`), clearing the guides and the project's sections, with no question asked.

### Our rule

- **File › New blank page** (`project.newBlankPage`) replaces the project with the empty project: one page, Home, whose root, Page, holds nothing (the names in the language the editor shows, as at a first start).
- Over a project that holds work it asks first, in the manifest's words (`dialog.newBlankPage`): **Start over** replaces it, **Cancel** changes nothing and the status bar says so (`status.confirmation.cancelled`). Over the empty project it asks nothing.
- The selection and the undo history start empty; the inspector shows its tips for an empty selection (the empty page's hint).
- The status bar reads that a blank page was started (`status.project.blankPage`), and autosave writes the blank page, so a reload shows it.

### Refusals

None.

### Problems in Pager

1. **The page is replaced without asking,** and the work is gone (undo cannot bring it back: the history goes with it). Required: the confirmation, over a project that holds work.
2. **Nothing says what happened.** Required: the status bar says a blank page was started.

### Undo and redo

Not undoable: the history starts empty, as after File › Open.

## page-properties

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- **Page** in the top bar (`#pageProperties`, `index.html:78`, labelled "Page properties"): a click selects the page root and opens the inspector (`src/features/workspace/dock.js:160`).
- The empty inspector (nothing selected) offers the same action as a button, which clicks the top bar's Page (`src/features/inspector/properties.js:2758-2768`).
- No shortcut.

### Result

- The page root becomes the selection and the inspector shows it like any element: the Tag field (`div`, with section, header, main, footer, nav, aside and article offered), Attributes, the inline style (`background:#FFFFFF;color:#0F172A`), Layout, Space, Size, Paint, Border, Text and Effects. Observed after a click on Page: the canvas label reads `<div> Page` and the status bar says nothing new.
- **The title** of the exported page is the page root's layer name (`src/features/export/index.js:172`, `model.name||"Page"`): it changes only by renaming the Page layer.
- **The language and the direction** are stored in the project's page record (`page:{lang:"en",dir:"ltr",…}`, `export/index.js:46`). They are read through `pageLangOf` (a value not shaped like `xx` or `xx-YYYY` silently becomes `en`) and `pageDirOf` (anything but `ltr` or `rtl` silently becomes `ltr`) (`src/model/tree.js:66-76`). No control of the interface writes them: only a project file brings other values.
- The canvas writes the language on the frame's `<html>` (`src/platform/canvas/projector.js:465`) but not the direction; the direction reaches the page only as a CSS `direction:` declaration on the root (`src/model/css.js:16`). The export writes both on `<html lang dir>` (`export/index.js:172`).

### Visual feedback

| Stage | What is drawn |
|---|---|
| After a click on Page | The page root drawn selected on the canvas; the inspector shows its element properties. The status bar says nothing. |
| Title, language, direction | Nothing: there is no control for them. |

### Undo and redo

Selecting the page root records nothing. Renaming the Page layer (the only way to change the title) is one undo step of the rename. The language and the direction cannot change, so nothing is recorded for them.

### Keyboard equivalent

None in Pager beyond Tab to the top bar's Page and Enter.

### Problems in Pager

1. **No control sets the title, the language or the direction.** A professional cannot give the page a real `<title>`, declare it Portuguese or make it right-to-left without editing a project file. Required: **Page properties** (the inspector header's button, DESIGN.md `inspector-header` 4) selects the page root and shows the inspector's **Settings** tab, whose first fields are **Page title**, **Page language** and **Text direction** (the page attributes of `elements.json`, in their order). Each field keeps its value on Enter or when it loses focus, through `page.setSetting`: one undo step per change that changes something, undo restoring the value and the selection, and the status bar names the setting and its new value (`status.page.settingSet`). The selection stays the page root.
2. **The title is the root's layer name**, so renaming the Page layer silently rewrites the exported `<title>`, and every new project is titled "Page". Required: the title is a setting of its own (`pageTitle` on the page root); renaming the layer never changes it, and setting it never renames the layer.
3. **A wrong language silently becomes `en`** at render and export, so the page ends up declared English without anyone having chosen it. Required: the language must have BCP 47 syntax and a known language subtag, or be a valid private-use tag (`x-private`). `banana` is refused even though its letters fit the syntax. The status bar and the field beside the input say which value and setting were refused (`status.page.settingInvalid`); the document keeps its value, nothing is recorded, and the field shows the document's value again. The same holds for a direction other than `ltr`, `rtl` or `auto` (the keywords `elements.json` gives `pageDirection`; Pager drops `auto`).
4. **The canvas gets the language but not the direction**, which only arrives as a CSS declaration, so the edited page does not show what the exported one does (form controls and the bidi algorithm follow `dir`, not only `direction`). Required: the canvas frame's `<html>` carries `lang` and `dir` from the page settings as soon as they change, so a right-to-left page is drawn right-to-left in the editor (the page root's computed `direction` is `rtl`), and the settings are saved with the document (they survive an immediate reload). The export writes them on `<html>` (feature export-zip).
5. **An emptied field has no meaning** in Pager (there is no field). Required: emptying a field and keeping it removes the setting from the page root; the page then has no title, language or direction of its own (the export decides what it writes then, feature export-zip).

## page-seo-meta

How Pager behaves, read from its source (it was not run for this spec). Source references are `path:line` inside Pager.

### Trigger

- Nothing in Pager. Its export writes the head's charset, viewport, title and the page's `lang`/`dir`
  (`src/features/export/index.js:172`) and nothing else: there is no control and no page field for a description, a
  canonical URL, Open Graph tags, a favicon or a linked script, and a project file cannot carry them either.

### Result

- A page's metadata can only be edited by hand in the exported file, which the next export overwrites. Observed:
  nothing of the interface reads or writes it.

### Problems in Pager

Everything: the capability does not exist. Required (the user's real-use audit, item 7.2): the page's settings carry
its metadata and the export writes it — see the rule below, which is the contract.

### Our rule (the user's real-use audit, item 7.2)

- **Six settings on the page root**, in `elements.json` in this order after the title, the language and the
  direction: **Description** (`pageDescription`), **Canonical URL** (`pageCanonical`), **Sharing title**
  (`pageOgTitle`), **Sharing image** (`pageOgImage`), **Favicon** (`pageFavicon`) and **Linked scripts**
  (`pageScripts`). They are drawn in the inspector's Settings tab under the page's header, and each is kept by
  `page.setSetting` exactly like the title: on Enter or when the field loses focus, one undo step, a status naming
  the setting and the value, and emptying the field removes it from the page root (`status.page.settingRemoved`).
- **The export writes them in the head of the page**, in the manifest's order, after the title and before the
  stylesheet link: a `meta` as `<meta name="description" content="…">`, a property (`og:`, `twitter:`) as
  `<meta property="og:title" content="…">`, a `link` as `<link rel="canonical" href="…">` or
  `<link rel="icon" href="…">`, and a path list as one `<script src="…"></script>` per entry. Values are escaped as
  attributes; nothing set writes nothing. An empty value never writes an empty tag.
- **The mapping is data**: each attribute's `head` in `elements.json` (`meta:description`, `link:icon`, `script:`) is
  read by the one export writer (`core/export/export.ts`, `headLines`); no second list of tags lives in code, and the
  preview shows the same head because it is the exported page.
- **The canvas draws no metadata**: it is not page content, so nothing of it reaches the frame.
- **The address fields** — Canonical URL, Sharing image, Favicon — carry an address, so they take the one address
  grammar (the owner of A3.2, item 7.4) as Link's and Source's fields do; until that owner exists they keep any text.
  The image fields may pick a file from the project when the file tree exists (feature explorer-assets).
- **The grid and fold toggles left the page's Settings** (item 7.2): they are canvas tools and live on the canvas's
  toolbar and in Guides & Grids, so the page's panel holds settings only and nothing is edited in two places.

## palette-click-insert

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- A press on a palette tile is recorded on `pointerdown` (capture phase); on `pointerup`, if the pointer moved less than **4 px** from the press and no drag started, the tile's type is inserted at the selection (`src/features/workspace/dock.js:664-676`, threshold `MEASURE_LIMITS.THRESH` = 4 px from `src/core/pointer.js:3`). Observed: presses with 0, 1, 2 and 3 px of movement each inserted one element.
- Moving 4 px or more turns the press into a palette drag instead (see `palette-drag-insert.md`).
- Keyboard: Enter or Space on a focused tile inserts the same way (`src/features/palette/index.js:276-283`).

### Hit zones and thresholds

The whole tile row (icon, label, tag) is the target. Where the new element lands is decided by `insertTypeAtSelection` (`src/features/input/index.js:185-201`):

| Selection | Placement |
|---|---|
| Nothing selected | Last child of the Page root |
| A page block (Section, Header, Footer, a template whose root is one) with a selection inside a page block | Right after that page block, in its parent (Problems 4) |
| A container (not locked) | Last child of that container |
| A leaf, or a locked container | Right after the selection, in the same parent (`takeTypeIntoHand` aims at index + 1, `input/index.js:150-164`) |
| The placement is refused by the nesting rules | Nothing is inserted; status `Refused. <reason>` (`input/index.js:193-198`) |

Placement goes through the same validator and the same commit as a drop (`commitHand` → `finish`, `input/index.js:173-184`), so assist wrappers apply (see Problems).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After clicking Section, Heading, Paragraph, Container (nothing selected at the start) | Each new element appears on the canvas, flashes for 0.9 s, becomes the selection (outline, chip, quick panel) and its Layers row is highlighted. The status bar reads, in turn: `Placed. Section in Page, position 1 of 1.`, `Placed. Heading in Section, position 1 of 1.`, `Placed. Paragraph in Section, position 2 of 2.`, `Placed. Container in Section, position 3 of 3.` | ![four clicks](img/palette-click-insert--01-after-four-clicks.png) |

No indicator is drawn before the insert; the tile itself only shows its hover background.

### Result in the document

Observed sequence starting from an empty page:

1. Section (nothing selected) → `Page.children = [Section]`; Section selected.
2. Heading (Section selected, a container) → `Section.children = [Heading]`.
3. Paragraph (Heading selected, a leaf) → inserted after the Heading: `[Heading, Paragraph]`.
4. Container (Paragraph selected, a leaf) → inserted after the Paragraph: `[Heading, Paragraph, Container]`.

The iframe renders `<section>` with `padding: 56px 40px`, `<h2>New heading</h2>`, `<p>A freshly created paragraph.</p>` and an empty `<div>` that keeps a visible 40 px minimum height on the canvas only (class `empty`). New names are unique (`Paragraph 2`, …) and new keys unique (`new-paragraph-2`, …).

### Undo and redo

Each click is one transaction; `Ctrl+Z` removes the inserted subtree and restores the previous selection. Pager keeps at most 80 undo entries (`src/commands/transactions.js:210`).

### Nested elements

Placement always uses the selection's own container or parent; it never searches for another receiver.

### Zoom other than 100 %

Not affected by zoom. The inserted element is scrolled into view if it lands off screen.

### Keyboard equivalent

Tab to the Elements panel, arrow keys between tiles (Home/End jump; `palette/index.js:284-293`), Enter or Space to insert; Escape returns focus to the panel region.

### Problems in Pager

1. **Types that need a parent are wrapped instead of refused.** With the Page root selected, clicking List item created a `<ul>` wrapper holding the `<li>` (`Placed. List item in Page, position 2 of 2.`); clicking Badge with a List selected created an `<li>` wrapper. The new app follows manifest feature `nesting-grammar`: the insert is refused with a message such as `Refused. <li> only exists inside <ul>, <ol>` and the document JSON is unchanged.
2. **After a wrapped insert the selection is the wrapper,** not the element that was clicked (observed: `new-list` selected after clicking List item). Required: the inserted element itself is selected.
3. **The elements a page is built with first were out of sight** (the dogfooding pass: in the sidebar's Insert view only Structure fit; the Image came after the 23 form controls, the Button among them). Required: the groups come in the order a page is built — Structure, Text, Media, Forms, Lists, Tables, Interactive, Templates — and the Button stands in Text beside the Heading, the Paragraph and the Link.
4. **A page's blocks clicked in order nested into one another** (the journey "site", 2026-10-01: Navbar, then Hero, then Footer clicked on an empty page put the Hero inside the Navbar's header and refused the Footer: `<footer> cannot sit inside <header>`). A template selects its new root, a container, so the next tile went inside it. Required: a **page block** — an element marked `pageBlock` in `elements.json` (Section, Header, Footer) and every template whose root is one (Hero, Navbar, Gallery) — clicked with a selection lands right after the page block that is or holds the selection, in that block's parent; a selection inside no page block (a Main, a Container at the page's root) keeps the rules of the table above. So Navbar, Hero, Grid, Card, Footer clicked in turn on an empty page give `Page = [Navbar, Hero, Footer]` with the Grid in the Hero and the Card in the Grid; with the Hero's Actions selected, Section lands after the Hero.
- **A new element came out plain beside styled siblings** (the plan's stage 7, "novo elemento herda o visual dos
  irmãos"; journey C3: a new link in a menu of styled links). Required: an element inserted where the receiver's
  children of its type all share classes takes those classes (a fourth article in a grid of `.card` articles is a
  `.card`); with no such sibling, or none shared, it takes none.
- **Every tile was a Tab stop of its own** (jornada03 plan, stage 5: 74 stops in the Insert panel). Required: a group's
  tiles are one Tab stop, its first tile, and the arrows walk the others (the palette key context); the density switch
  is one Tab stop too, the density shown, its arrows moving among the four (a roving group).

## palette-drag-insert

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: a Section holding a Heading and a Paragraph.

### Trigger

- Primary-button press on a palette tile (`.pi[data-new]`) arms a **creation** drag carrying the element type and its label; the pointer is captured by the canvas stage (`src/app/boot.js:459-461`).
- The drag starts after 4 px of movement (`src/core/pointer.js:3`, `boot.js:507`). Below 4 px, release is a palette click and inserts at the selection (see `palette-click-insert.md`; `src/features/workspace/dock.js:664-676`).
- From then on it is the same engine as a canvas move: one proposal per frame, same resolver, same validator, same indicators (`src/features/drag/drag.js:416-504`, `:730-780`, `src/platform/overlay.js:235-302`). The Layers tree is also a drop surface during the drag (`drag.js:441-442`).
- Release commits the last drawn proposal; `Escape` cancels (`src/features/input/index.js:662-663`, `boot.js:551`).

### Hit zones and thresholds

Identical to `drag-reorder-canvas.md` and `drag-drop-inside.md` (edge bands, leaf halves, empty-container aim of 40 px, escape ladder of up to 12 px, 4 px hysteresis, 56 px autoscroll). The only differences:

- There is no dragged node, so no subtree is excluded from the hit test.
- Outside the page (the dark stage or any panel other than Layers) there is no proposal.
- When the type needs a wrapper to be valid where it is dropped (for example a List item dropped in the Page), the proposal is accepted with an **assist chain** instead of refused (`drag.js:760-774`); see `nesting-grammar.md`.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging Paragraph between the Heading and the Paragraph | Ghost chip `⠿ Paragraph` (the tile's label) at pointer +14, +16 px; insertion line above the existing Paragraph; Section tinted; label `Move to position 2 · Section · before Paragraph`; status `Before Paragraph`. | ![between](img/palette-drag-insert--01-between-heading-and-paragraph.png) |
| Dragging Container below the Section | Page tinted as receiver; label `Move to position 2 · Page`; status `Into Page · index 1`. | ![below](img/palette-drag-insert--02-below-section.png) |
| Dragging Heading over the dark area outside the page | No line, no tint, no label; cursor `not-allowed`; the status bar tag turns to `REFUSED` with `Outside the canvas — releasing cancels`; read-out `No proposal under the pointer.` | ![outside](img/palette-drag-insert--03-outside-page.png) |
| Escape during a palette drag | Every indicator disappears; status `Cancelled — nothing changed`. | (same as the canvas Escape stage in `drag-level-keys-escape.md`) |

### Result in the document

- A new node is built only on release, from the type's factory, with a fresh key and an auto-numbered name (`drag.js:1172-1175`; observed name `Paragraph 2`, key `new-paragraph-2`) and inserted at the proposal's `(parent, index)`.
- Observed: Paragraph dropped before the existing Paragraph → `Section.children = [Heading, Paragraph 2, Paragraph]` (index 1). Container dropped below the Section → appended to the Page after the Section.
- The new node becomes the selection; it flashes for 0.9 s (`drag.js:1237-1239`).
- Release outside the page, or after Escape, inserts nothing: the document JSON is byte-identical (observed) and the status reads `Cancelled — nothing changed`.

### Undo and redo

Each palette drop is one transaction: one `Ctrl+Z` removes the inserted subtree, including any assist wrappers created with it.

### Nested elements

The receiver is resolved exactly as for a move; the arrow keys change the level during a palette drag too (`input/index.js:664-667`).

### Zoom other than 100 %

Same as a canvas move: zones are measured on the zoomed boxes; the threshold, hysteresis and chips stay in screen px.

### Keyboard equivalent

Focus a palette tile (Tab into the Elements panel, arrows between tiles, `src/features/palette/index.js:276-300`) and press Enter or Space to insert at the selection (`:278-283`). A keyboard way to choose a different position for a new element is the hand: the insert aims beside the selection and the arrows move the aim (`takeTypeIntoHand`, `input/index.js:150-164`).

### Problems in Pager

1. **The label says `Move to position N`** although nothing is being moved. Required: a creation drag reads `Insert <type label> · position N of M in <parent>` (or `Into <parent>` for an empty receiver), with the same wording in the status bar.
2. **The refusal message outside the page says `Outside the canvas`** while the pointer is on the canvas, outside the page. Required: `Outside the page — release to cancel`.
3. **Wrappers are created silently by the drop** when the type needs a parent (`✚ <ul> will be created here`), which contradicts the nesting rules the new app follows (manifest feature `nesting-grammar`: such attempts are refused with a message). Required: the drop is refused with the nesting message and no insertion line; nothing is inserted on release.
4. **The ghost shows only the label.** Required: the ghost shows the element's icon and label so a creation drag is distinguishable from a move of an element with the same name.

## panel-combine-tabs

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Start: Elements and Layers as separate groups in the left dock.

### Trigger

Drag a panel by its bar (or one tab out of a tab group) over another panel and release (`src/features/windows/index.js:589-791`). Threshold 4 px. `Escape` cancels.

### Hit zones and thresholds

- **Tabs:** the pointer is inside the target group's header, i.e. its top **26 px** (`:724-746`). The new tab is inserted before the tab whose centre is right of the pointer, else at the end.
- **Stack:** the pointer is over the target group's body; upper half → the dragged panel goes above, lower half → below (`:747-750`).
- Other panel system (non Elements/Layers panels): upper **45 %** of the target → `Combine as tabs`, lower 55 % → `Stack panels` (`:159`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Layers dragged over the Elements header | A 3 px vertical line in the header at the insertion point between tabs (observed at x = 71.75, 32 px tall). | ![tabs hint](img/panel-combine-tabs--01-tabs-hint.png) |
| Released | One panel with two tabs, `Elements` and `Layers`; the dropped one active. | ![tabs](img/panel-combine-tabs--02-tabs.png) |
| The Layers tab dragged over the lower part of the group | A 3 px horizontal line at the bottom edge of the group. | ![stack hint](img/panel-combine-tabs--03-stack-hint.png) |
| After release and a reload | Elements and Layers stacked, each with its own title bar and `×`, a 6 px divider between them. | ![after reload](img/panel-combine-tabs--04-after-reload.png) |

### Result in the document

Never changes the document. The group is stored as `{ids: ["palette","layers"], mode: "tabs"|"stack", active, weights}` in preferences and restored after reload (observed).

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Tab strips: ArrowLeft/ArrowRight/Home/End switch tabs (`:511-519`); no keyboard way to combine or stack.

### Problems in Pager

1. **The hints are bare 3 px lines.** Required: over the upper part of a panel a `Combine as tabs` hint appears and over the lower part a `Stack panels` hint (manifest feature `panel-combine-tabs`), drawn as labelled areas.
2. **The tabs zone is only the 26 px header** for Elements/Layers but 45 % of the panel for other panels. Required: one rule for every panel (upper part = tabs, lower part = stack), from the workspace owner.

## panel-resize

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

Pager has two kinds of splitters:

- **Independent-panel splitters** (Elements/Layers docks): the dock edge handle (`independent-resize`, 6 px wide, e.g. at x 274-280 for the left dock) and the divider between stacked panels (`independent-divider`, 6 px tall) (`src/features/windows/index.js:352-428`). Pointer drag or, when focused, ArrowUp/Down (dividers) / ArrowLeft/Right (dock edge) by **8 px**, Shift ×4 (**32 px**). `Escape` during a drag restores the start size.
- **Shell splitters** `#splitInspector`, `#splitBench` (and the code panel's) (`src/features/workspace/dock.js:211-272`): 1 px lines; drag, or arrows by **8 px**, Shift **24 px**; `Escape` restores.

### Hit zones and thresholds

| Splitter | Min | Max |
|---|---|---|
| Left/right independent dock | 200 px (dock) | window width − workspace (≥ 360 px + inspector) |
| Stacked panel divider | 72 px per panel (or half the total) | — |
| Floating panel resize | 240 × 180 px | window |
| Inspector (`#splitInspector`) | 320 px | min(520 px, room left) |
| Workbench (`#splitBench`) | `BENCH_MIN` | 60 % of the window height |

No threshold: the size follows the pointer from the first move.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Left dock dragged +60 px | The dock is 340 px wide; the canvas shrinks. | ![left dock](img/panel-resize--01-left-dock-wider.png) |

Resizing cursors (`col-resize`/`row-resize`); `is-resizing` on the body during a shell splitter drag. No status message.

### Result in the document

Never changes the document. Sizes are saved in preferences and restored after reload (observed: the 340 px left dock survived a reload).

Observed values: divider `aria-valuenow` 64 → 65 (ArrowDown, 8 px) → 61 (Shift+ArrowUp, 32 px). Inspector splitter ArrowLeft from 300 px → **320 px** (the stored 300 was below the 320 minimum, so the first key snapped to the minimum).

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

In Fit mode the canvas refits after a resize.

### Keyboard equivalent

Arrows on a focused splitter.

### Problems in Pager

1. **The step is 8 px (Shift 24 or 32 px), not 20 px, and differs between the two splitter kinds.** Required: every splitter resizes its neighbours by 20 px per arrow key, within minimum and maximum sizes (manifest feature `panel-resize`).
2. **Shell splitters have no `aria-valuenow` and are removed from the Tab order** (`tabindex="-1"` via `sealRegions`, `src/features/input/index.js:403-408`). Required: every splitter has `role="separator"` with `aria-valuenow` (and min/max) and is reachable by keyboard.
3. **The default inspector width (300 px) is below its own minimum (320 px),** so the first keyboard step jumps. Required: defaults respect the limits.
4. **1 px shell splitters are hard to grab.** Required: every splitter has a pointer target of at least 6 px, with the visible line centred on it.
5. **At 1280 × 720 the canvas had 41 % of the window** (jornada03 J25 and H17; the audit's AUD-06, 2026-10-02: the change for J25 measured 55 % of the width, while the stage had 708 × 537 px). Required: below the narrow window's width (interactions.json `workspace.narrowWindow`, 1366 px) the sidebar keeps no column: it opens over the canvas, beside the activity bar, and a press outside it and the activity bar, or the focus leaving it (Escape takes it to the canvas), closes it as the left dock's toggle does; a first visit in a narrow window opens with it closed, and a workspace the person kept keeps its own. At 1280 × 720 the stage then has at least half of the window, measured as an area (`tests/e2e/narrow-window.spec.ts`), as Webflow's navigator overlays a small window and Figma's panels minimise. The browser tests open the window the contract declares (`manifest/environment.json`, 1440 × 900) unless they measure another.
6. **The sidebar and the inspector had fixed widths** (the plan's stage 5 row for 1280 × 720: "width splitters on the sidebar and the inspector"). Required: each has a width splitter at its inner edge (layout.json `sidebar-width`, 180–400 px from 224; `inspector-width`, 240–440 px from 288), dragged or stepped 20 px by its arrows like every splitter, the width a preference kept between sessions, which the window's columns and everything sized by them take; the floating sidebar of a narrow window takes it too.


### The View menu's equivalents (TS1, DEC-47)

Required: the panel splitters stay 6 px wide (a 24 px hit area would cover the Layers rows' buttons, the Insert tiles
and the ruler beside them), and every splitter has an equivalent control of full size, which WCAG 2.2's 2.5.8 admits
(the equivalent exception): **View › Widen the sidebar / Narrow the sidebar**, **Widen the inspector / Narrow the
inspector** and **Make the Layers taller / shorter** (`workspace.resizeSplitter`, one step of `splitter.step`, within
each splitter's bounds), the same command the drag and the arrows run.
## preview-mode

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Details, Button with a hover background].

### Trigger

- `Ctrl+P` or `Ctrl+Enter` (`view.preview`, `src/features/workspace/dock.js:573`), or the top bar **Preview** button (`dock.js:643`).
- Exit: `Escape` (`src/features/workspace/camera.js:889-892`) or the **Exit preview — Esc** button (`dock.js:644`). `Ctrl+Enter` pressed again does **not** exit (observed: still in preview).

### Hit zones and thresholds

- In preview the page is interactive: pointer and keyboard go to the page; links open in a new tab instead of navigating the editor; forms submit to a new tab (`src/app/boot.js:410-431`); Space belongs to the page (`camera.js:872-876`).
- The zoom is forced to 100 % while in preview (`camera.js:100`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Preview on | Docks, inspector, selection, handles and rulers hidden; a slim top bar remains with the breakpoint switcher, `Exit preview — Esc` and `Export`; status `Preview — interact with the page. Press Esc to return to editing.` Two ruler pointer marks remain visible at the left edge. | ![preview](img/preview-mode--01-preview.png) |
| Hovering the Button, clicking the Details summary | The Button shows its hover background (computed `rgb(220, 38, 38)`); the Details opens. | ![hover](img/preview-mode--02-hover-and-details.png) |
| Escape | Editing returns with the previous selection (Heading), zoom and camera restored; status `Editing Desktop · 1,440 px.` | — |

### Result in the document

Preview never changes the document JSON (observed: byte-identical snapshot before and after). Opening the Details in preview does not store `open`.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Preview always shows 100 %; the editing zoom comes back on exit.

### Keyboard equivalent

`Ctrl+P`, `Ctrl+Enter`, `Escape`.

### Problems in Pager

1. **`Ctrl+Enter` enters preview but does not leave it.** Required: `Escape` or `Ctrl+Enter` exits preview and restores the previous selection and zoom (manifest feature `preview-mode`).
2. **Ruler pointer marks leak into preview.** Required: no editor chrome is visible in preview except the slim bar.
3. **The preview status text is hard-coded English** (`'Preview — interact with the page. Press Esc to return to editing.'` is a literal in `camera.js:822`). Required: all preview texts go through i18n.
- **Escape did not leave the preview once the page had the focus** (the dogfooding pass, 2026-09-30): the preview's page runs sandboxed in its own origin, so after a click in it (a button, a card) Escape and Ctrl+Enter reached the page alone while the status bar said "Press Esc to return to editing". Required: the preview's page — never the export — relays Escape and Ctrl+Enter to the editor, which runs the preview's own doors; Escape stays the page's while a modal dialog is open in it (it closes the dialog first).
- **Any sandboxed frame could end the preview** (the audit's AUD-10, 2026-10-02): the editor heard every message from an opaque origin, and every sandboxed frame reads "null", an embed sandboxed inside the previewed page included. Required: only the preview frame's own window is heard (MDN, postMessage: check the sender), and only the two keys it relays, field by field (Escape; Enter with Ctrl or Cmd).
- **The preview kept the editor's status bar and said "Editing"** (the audit's U-039, met again in the dogfooding pass): the breadcrumb, the size, the zoom and the language stood under a page nothing edits, a breakpoint chosen in the preview bar said "Editing the Phone breakpoint", and no tab of the preview bar read as chosen. Required: while previewing, the status bar holds only its message; a breakpoint chosen in the preview says `status.breakpointPreviewed` ("Previewing the page on the Phone screen."); the preview bar's tab of the breakpoint shown reads as chosen. The scenarios `the-preview-bar-shows-the-page-at-*` expect the new message.

## project-open-json

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- **File › Open project** (`#bO`, wired in `src/app/boot.js:376` to a hidden file input `bF`); the command bar's `project.open` clicks the same button (`src/features/workspace/dock.js:556`).
- The browser's file chooser opens; picking a file starts the read (`boot.js:379-400`); picking the same file twice reads it again (the input is cleared, `:381`). A read still running when another starts is dropped (`cancelProjectRead`, `:385`).

### What it reads

- A **JSON text file** (Pager's own save, `base-project.json`), read as text (`FileReader`, `:386-399`) and parsed (`readProject`, `src/features/export/index.js:71-79`): an older format is migrated first, then the envelope is checked (`assertEnvelope`); a newer format is refused by its code `PROJECT_NEWER_VERSION` (`src/features/documents/index.js:239-241`).
- No archive: a ZIP is not read.

### Result

- Accepted: the document is replaced at once (`openProject`, `export/index.js:80-90`): no question is asked, even when the current page holds work; the selection is cleared; the diagnostics readout says `Opened <file name>` (`boot.js:394`); the autosave then writes the opened project (`document:accepted`, `documents/index.js:335-339`).
- Refused (not JSON, not a project, a newer format): the readout says `Could not open: <why>` in its error style (`boot.js:396`); the current document stays as it was.

### Undo and redo

After an open the history starts empty: the opened project is not undoable into the previous one (`clearHistory`).

### Keyboard equivalent

The command bar (`project.open`); File › Open project through the menu's keys.

### Problems in Pager

1. **Opening replaces the work without asking.** A person who picks the wrong file loses the page on screen (the autosave then overwrites it). Required: before a valid project replaces a document that holds work (anything but the empty project), a confirmation asks (`dialog.openProject.message`, "Replace" / "Cancel", the command's `confirmation` in the manifest); Cancel leaves the document, the selection and the history as they were and the status bar says nothing changed; opening into the empty project asks nothing, as nothing would be lost. The file is read and checked before the question, so a refused file never asks.
2. **The archive Save project writes cannot be opened back**, because Pager reads JSON only. Required: File › Open reads the archive `project.zip` (its `project.json`, entries stored or deflated, as any ZIP tool writes them) and a bare `project.json` alike, through the one reader of a project document that the autosaved work also uses.
3. **A refusal is shown in a developer readout**, not where the person looks. Required: the status bar names the problem: `status.open.invalidArchive` with the reason (it is not a project document, or what the model rejects), `status.open.newerVersion` naming the version; the current document, selection and history are unchanged.
4. **Nothing on screen says the open happened.** Required: the status bar says the project was opened (`status.open.opened`); the selection and the undo history start empty, and the opened project is autosaved at once, so it survives an immediate reload.
5. **An archive could ask the tab for gigabytes** (the audit's AUD-10, 2026-10-02: every entry was inflated whole, whatever its header declared). Required: an archive the person chooses (File › Open, File › Import HTML, a spreadsheet) is read within bounds (`src/core/project/zip.ts`): what its directory declares is checked before anything is unpacked (at most 10,000 entries, 128 MB an entry, 256 MB in all, and an entry past 100 KB unpacks to at most a hundred times its packed size, Apache POI's inflate ratio); inflating counts the bytes and stops the moment an entry passes what it declared; a path outside the archive's folder (a step up, an absolute path, a drive, a backslash), a header pointing outside the file, ZIP64 or an unknown compression is refused. The refusal names why in the person's language (`status.open.invalidArchive`, `status.import.invalidArchive` with one of the archive reader's reasons; a spreadsheet too large says `status.data.fileTooLarge`).

## project-save-json

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- **File › Save project** (`#bS`, `index.html:38`, wired in `src/app/boot.js:365` to `downloadProject`); the command bar's `project.save` clicks the same button (`src/features/workspace/dock.js:555`).
- No shortcut. Always available: there is always a document to save.

### Result

- Pager downloads **one JSON text file**, `base-project.json` (`src/features/export/index.js:92-97`): a blob URL clicked through a temporary link, revoked 4 s later, and the diagnostics readout says `Saved: base-project.json`.
- The text is the persisted envelope (`toPersistent`, `src/commands/persist/envelope.js:54-70`), pretty-printed with two spaces: `format` (2), `app` ("Base"), `saved` (the save time), and `pages`, the first page carrying the live tree and its settings (language, direction, class styles, layer colours).
- The live tree is validated first (`saveProject`, `export/index.js:66-70`); an invalid tree throws and nothing is downloaded.
- Assets and any other file of the project are not in the download: only the document text.

### Visual feedback

| Stage | What is drawn |
|---|---|
| After Save project | The browser's download of `base-project.json`; the diagnostics readout (a developer panel) reads `Saved: base-project.json`. The status bar says nothing. |

### Undo and redo

Saving changes nothing in the document and records nothing in the history.

### Keyboard equivalent

The command bar (`project.save`); File › Save project through the menu's keys.

### Problems in Pager

1. **The download holds the document text only.** Files the project keeps next to the document (images, fonts, other files added later) are not in it, so a saved project reopened elsewhere loses them. Required: the download is one archive, `project.zip`, holding `project.json` and every file the project stores, each at its path in the project.
2. **The save time is written inside the document text** (`saved`), so two saves of the same document differ inside `project.json`. Required: `project.json` is the document alone, the same JSON the editor holds (its format version and its pages, and every setting the document holds), and nothing that depends on the editor session (no selection, zoom, DOM ids or save time); saving the same document twice gives byte-identical archives apart from the saved timestamp, which the archive keeps as its entries' modification time (from the clock port).
3. **Nothing tells the person the save happened** except a developer readout. Required: the status bar says the project was saved and under which file name (`status.project.saved`).
4. **Two formats in play** (Pager's `format`/`app` envelope versus the live shape, converted at a boundary). Required: `project.json` carries the same format version the autosaved record and File › Open read (the document's `version`), so the one reader of a project document opens both.

## promote-out

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > Container > Paragraph.

### Trigger

- `P` with the canvas focused and exactly one element selected (`src/features/input/index.js:765-780`).
- Other doors: selection bar "promote out of the parent, one rung" and Arrange menu run the same key row (`src/app/boot.js:283`, `src/features/workspace/dock.js:419`). The context menu's **Move out of parent** runs a second implementation (`src/features/layers/layers-panel.js:545-558`) with the same result.

### Hit zones and thresholds

The target is the grandparent, at the index right after the former parent (`input/index.js:770-777`). Refused, document unchanged, when:
- the parent is the Page root (no grandparent) — `Nothing to promote out of.`;
- more than one element is selected — `This action needs one selected element.`;
- the element or an ancestor is locked — lock message;
- the nesting rules refuse the grandparent — `Refused. <tag> cannot go in <tag>.` or the rule's own message.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After `P` on the Paragraph | The Paragraph now sits after the Container inside the Section, still selected; status `Promoted Paragraph into Section, position 2.` | ![after P](img/promote-out--01-after-p.png) |
| Second `P` | `Promoted Paragraph into Page, position 2.` | — |
| Third `P` (now a child of the Page) | Nothing moves; status `Nothing to promote out of.` | — |

### Result in the document

`Section > Container > Paragraph` → `Section > [Container, Paragraph]` → `Page > [Section, Paragraph]`. The node keeps its id; flow placement data is cleared by `nwPlace` when the parent changes.

### Undo and redo

Each promotion is one history entry.

### Nested elements

Exactly one level per press ("one rung").

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

`P` is the keyboard door.

### Problems in Pager

1. **Two implementations** (key row and Layers menu) with different messages (`Promoted … position N` vs `a11y.promoted` via the menu with a different index base). Required: one command for the key, the menus and the selection bar.
2. **The refusal at the top level is not styled as a refusal** (tag stays `ENGINE`). Required: the status explains that a direct child of the Page cannot be promoted, styled as a refusal; the document JSON is unchanged.
3. **Move out of parent took a part out of its instance** (the audit's AUD-04, 2026-10-02), which the model refuses. Required: a part of an instance stays in it: the door is unavailable for it (its own predicate, `canPromote`) and P says "<name> is part of the instance <instance> and stays in it. Detach the instance first."; every structure move keeps the same rule (a part stays in its instance, no instance goes inside another: `instanceMoveRefusal`).

## props-attributes

### Our rule

Required (manifest feature `props-attributes`):
- An element's ID, classes, tooltip (title) and the attributes of its type (an image's source and alt, a button's
  type…) are fields of Settings; its custom declarations are a field of the Style tab's All properties.
- The ID is written to the document JSON; an ID that does not start with a letter, holds a space, or that another
  element of the page has is refused with words, and the document is unchanged.
- Classes are kept as a list; custom declarations are read as CSS: a property the editor does not write, or a line
  that is no declaration, is refused naming it; a custom property (`--name`) and a shorthand the editor writes are
  taken, and the declarations join the element's styles at the active breakpoint and state.
- Nothing typed here writes a `style` attribute: the canvas and the export draw the element from its styles alone.

### Our rule: the free declarations (the user's real-use audit, item A3.33)

- The declarations field takes three kinds of line: an edited property of properties.json, **a custom property of the
  person's own** (`--brand: #123456`, any `--name`, kept as typed, written into the element's own rule and the export)
  and **a shorthand an owner reads** (`background: …`, `border: …`): the composite's codec reads it and its longhands
  are what the store and the export hold, so the person's shorthand and the editor's fields never disagree. A value a
  shorthand does not take is refused naming the line, as any other bad value.

## props-background

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Section.

### Trigger

- Inspector › Style › Paint, group Background (`src/features/inspector/catalogue.js:374-380`, `properties.js:2378-2386`):
  - **Colour** (`backgroundColor`, the colour field; its picker is the feature color-picker).
  - **Image** (`backgroundImage`, a plain text field with the placeholder `url(...)`, `catalogue.js:376`).
  - **Size** (`auto`, `cover`, `contain`, `100% 100%`), **Position** (the nine anchor points `center`, `top`, `bottom`, `left`, `right`, `top left`, `top right`, `bottom left`, `bottom right`), **Repeat** (`repeat`, `no-repeat`, `repeat-x`, `repeat-y`, `space`, `round`), **Attachment** (`scroll`, `fixed`, `local`) — menus shown only while the element paints an image (`paintsImage`, `catalogue.js:167-169`: the stored `background-image` or `background` holds `url(`, a gradient, `image-set(` …).
- Paint › More: **Origin** (`padding-box`, `border-box`, `content-box`), **Clip** (`border-box`, `padding-box`, `content-box`, `text`), **Blend** (eight blend modes) (`catalogue.js:453-455`).
- Each field writes one property of the selected elements with the inspector's setter; the Paint section's collapsed summary shows the background colour, or `None` when it is transparent.

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

| Stage | What is drawn |
|---|---|
| A value chosen or typed | The canvas repaints the section with the new background at once; the field shows the stored value. |
| Text the browser does not take (e.g. a bare `https://…/photo.jpg` in Image) | Nothing on the canvas and **no message**; the field keeps the typed text (`properties.js` setter: the declaration is dropped by the browser). |

### Result in the document

- Each field writes its own property of the node's desktop base style: `background-size: cover`, `background-position: center`, `background-repeat: no-repeat`, `background-attachment: fixed`, `background-origin: content-box`, `background-clip: padding-box`, `background-blend-mode: multiply`.
- Image stores the typed text as it is: `url(https://example.com/a.png)` works; `https://example.com/a.png` is stored and ignored by the browser; `url(javascript:alert(1))` is stored.
- The computed background of the section in the iframe matches the stored values.

### Undo and redo

Each field change is one undo step; Ctrl+Z restores the previous value.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field: Enter keeps a typed value, Escape puts the stored one back.

### Problems in Pager

1. **A bare URL typed in Image is stored and silently ignored** (the browser drops `background-image: https://…`). Required: a URL typed without `url()` (absolute http/https, or relative) is written as `url("…")`; text that is no image (neither `none`, a `url()`, nor a URL) is refused with a message and nothing is written.
2. **Any URL scheme is accepted in Image,** `url(javascript:alert(1))` included. Required: Image takes the addresses every resource of the page takes (an image's src): a web address (http, https) or a path inside the project; any other scheme (javascript:, data:, file:) is refused with a message naming the address (`status.url.unsafe`).
3. **The image and the gradient share the `background` shorthand in Pager's other field,** which resets the background colour (see gradient-editor, Problem 1). Required: Image writes `background-image` only; the background colour is kept.
4. **Position is a fixed menu of nine anchor points; typed offsets are stored as text** with no check of which axis each word belongs to. Required: Position is written as its two longhands, `background-position-x` and `background-position-y`: one keyword names its own axis and centres the other (`top` → x `center`, y `top`), two words may come in either order (`top left` → x `left`, y `top`), a length or a percentage is taken as x first; text that is no position is refused.
5. **A colour field at rest read the browser's text: Background `rgba(0, 0, 0, 0)`** (the audit's S-026). Required: a colour field's face at rest is the colour's hex in capitals (`#1A1A1A`); a colour not fully opaque adds its opacity after it where a length's unit stands (`#1A1A1A 50%`); a colour with no opacity at all reads `transparent`; what the document holds, and the text the field edits once focused, are unchanged.

## props-border-outline

### Composite length input (Jornada 03 J18)

Radius and other four-sided length fields accept one through four bare numbers in the field's default unit,
the same arithmetic as individual length fields, explicit supported units, and balanced CSS math functions.
For example, radius `12` writes four `12px` corners; spacing `14 28` writes `14px 28px 14px 28px`.
Existing unitless zero and explicit units retain their representation. Color composites retain color parsing.
Invalid quantities are refused through the existing value-validation path; one confirmation is one undo step.

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Border: the border editor (`ppBorder`, `src/features/inspector/properties.js:1673-1760`, used at `:3371-3395`):
  - a box whose four **edges** and four **corners** are buttons choosing what the fields below edit (`:1686-1703`), and a **chain** linking the sides and the corners (`:1704-1716`);
  - **Width** (a number field in px, `:1722-1731`) and **Radius** (`:1734-1742`), for the chosen edge or corner, or all of them while linked;
  - **Style** (a menu of the border styles, `:1749-1753`) and **Colour**, for all sides.
- Border › Outline: **Outline** and **Outline offset** as text and length fields.

### Hit zones and thresholds

Not applicable: every control is a button or a field of the inspector.

### Visual feedback

| Stage | What is drawn |
|---|---|
| An edge or corner chosen | It is marked in the box; the fields show its values. |
| A value typed | The canvas draws the border, the radius or the outline at once. |

### Result in the document

- The editor writes the shorthands `border-width` (four values, `:3389`), `border-style`, `border-color` and `border-radius` (four values) of the node; only the ones that changed (`ppWriteMany(changed…)`, `:3392`).
- Outline writes `outline`; Outline offset writes `outline-offset`.
- The computed borders, radii and outline in the iframe match.

### Undo and redo

Each field change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The edges, corners and chain are buttons; the fields and the menu are keyboard-operable like every inspector field.

### Problems in Pager

1. **Style and colour are one value for all sides** (`border-style`, `border-color`, `:3390`): an edge cannot have its own style or colour. Required: a side's width, style and colour can be set alone (its longhands only), and all sides at once (the longhands of every side, one command, one undo step).
2. **A width on an element without a border style draws nothing:** the style stays `none` (`style: read("borderStyle") || "none"`, `:3383`; a width change writes the width only, `:3392`). Required: writing a side's width while its style is `none` also writes `solid` for that side (the manifest's couplings `border-*-width-shows-style`), unless the same write names a style.
3. **The shorthands are stored:** the node holds `border-width: 1px 2px 1px 2px` and `border-radius: …` rather than the values of each side and corner, so a side's value cannot be read or changed alone. Required: every border value is stored as its longhands (`border-top-width` …, `border-top-left-radius` …), and each is written by one command per property (`style.setBorder`, `style.setRadius`) that every door of it uses.

## props-display

How Pager behaves, read from its source (`reference/Pager`). Source references are `path:line` inside Pager.

### Trigger

- The inspector's Layout section: a **Display** choice (`catalogueProperty({id:"display",kind:"sel",…})`,
  `src/features/inspector/catalogue.js:307`), drawn as icon buttons (`src/features/inspector/properties.js:2307`) with
  the nine values block, inline, inline-block, flex, inline-flex, grid, inline-grid, contents and none.
- A click on a value writes it; the field shows the element's own display, else the display its tag takes
  (`dispOf`, `catalogue.js:137-144`, `:632`).

### Result in the document

The chosen keyword is written as the element's `display` at the active breakpoint and state. The canvas redraws the
element with it.

### Undo and redo

One undo step per choice.

### Nested elements

Only the selected element changes; `contents` makes its box disappear so its children lay out in its parent.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager beyond Tab and a click.

### Problems in Pager

1. **Only nine values exist, and nothing else can be typed.** Required: in All properties the Display field offers
   every display keyword the browser data allows (the generated list) and a typed value is accepted only when the
   browser takes it; the nine values stay the Essentials menu (manifest feature `props-display`).
2. **A value the browser does not take is not refused with a word** (Pager cannot receive one). Required: text that is
   not a display value is refused with `status.value.invalid` naming Display and the text; the document keeps its value.
3. **Nothing says what changed.** Required: the status bar says `status.style.set` (property, element, value).
4. **A locked element's display can be changed.** Required: a locked element, or one inside one, refuses with
   `status.locked.edit` (spec lock-element).

## props-effects-basic

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Effects (`src/features/inspector/catalogue.js:394-408`, `:438`):
  - **Opacity:** a number field, step 0.05, from 0 to 1 (`:394`).
  - **Blend** (`mix-blend-mode`, eight values, `:398`), **Cursor** (eleven values, `:405`), **Visibility** (`visible`, `hidden`, `collapse`), **Pointer events** (`auto`, `none`), **User select** (`auto`, `none`, `text`, `all`) as menus; **Isolation** (`auto`, `isolate`) under More.

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

The canvas draws the element again at once; the fields show the stored values.

### Result in the document

- Each control writes its property of the node's desktop base style: `opacity: 0.5`, `visibility: hidden`, `mix-blend-mode: multiply`, `isolation: isolate`, `cursor: pointer`, `pointer-events: none`, `user-select: none` (Pager writes `user-select` alone).
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field.

### Problems in Pager

1. **Opacity takes a number only:** `50%`, which CSS takes, is not read as 0.5. Required: opacity takes a number from 0 to 1 or a percentage from 0 to 100 %, written as its number (50 % is 0.5); anything else is refused with a message. The field shows an opacity as a percentage ("100 %"), so a bare number above 1 typed in it is a percentage too ("40" is 0.4; the code audit's S-020, where the field showed 100 and refused 40); above 100 % is refused.
2. **The menus offer a fraction of the values:** eight of the sixteen blend modes, eleven cursors (`catalogue.js:398`, `:405`). Required: each offers every value of its generated list.
3. **User select is written without its prefix,** which Safari needs. Required: user-select is written through its recipe (`-webkit-user-select` and `user-select`, properties.json recipes).

## props-element-specific

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager.

### Trigger

- Pager's inspector catalogue declares a row per property with a `when` test on the selected node (`src/features/inspector/catalogue.js:419-434`, `:492`):
  - table: `borderCollapse`, `borderSpacing`, `tableLayout` and `emptyCells` on a table; `captionSide` on a table or a caption;
  - list: `listStyleType`, `listStylePosition` and `listStyleImage` on a list, an ordered list or a list item (`LIST_ANY`, `catalogue.js:158`);
  - media: `objectFit` and `objectPosition` on the media types (`MEDIA_ANY`, `catalogue.js:157`: image, video, canvas, iframe, svg and picture);
  - form: `resize` on a textarea; `accentColor` and `appearance` on the form types (`FORM_ANY`, `src/model/elements.js:143`); `caretColor` on an input or a textarea.
- A row whose test fails is not drawn. Each row is edited like any other field of the inspector, and the value goes to the node's style.

### Result in the document

- The value is written to the selected element's style at the current breakpoint and state (`style.set`), one undo step, and the page draws it.
- The initial values the inspector shows are Pager's defaults (`catalogue.js:586-588`), for example separate, auto, top, show, disc, outside, none, fill, 50% 50%.

### Our rule

- Each of these properties names its kind in `properties.json` (`appliesTo`): `table`, `tableOrCaption`, `list`, `media`, `textarea`, `formControl` or `textInput`. One owner, `src/core/style/applies.ts`, says whether a kind holds for an element, from the tag the element is written with (a switched tag counts):
  - table: `table`;
  - tableOrCaption: `table`, `caption`;
  - list: `ul`, `ol`, `menu`, `li`;
  - media: the replaced elements the object properties act on, `img`, `video`, `canvas`, `iframe`;
  - textarea: `textarea`;
  - formControl: `input`, `textarea`, `select`, `button`, `progress`, `meter`;
  - textInput: `input`, `textarea`.
- The inspector draws a field of one of these kinds only while every selected element is of that kind. With nothing selected it draws none of them, and Add a property does not offer them for an element they do not apply to.
- **A property that acts on a layout the element is in names a context predicate** in `properties.json` (`appliesTo`), and the same owner says whether the context holds, read on the canvas: what the page computes for the selected element and for its parent (a value the element inherits from a class, another breakpoint or the browser's default counts, because it is the computed value). The predicate asks, on the element's own computed style:
  - `flexContainer`: display holds `flex` (flex or inline-flex); `gridContainer`: `grid`; `flexOrGridContainer`: either;
  - `container`: a box that lays out content (any display but `inline`, `contents`, `none` and the SVG shapes);
  - `positioned`: position is not `static`; `staticBox`: it is (float and clear act in the flow);
  - `multicol`: `column-count` or `column-width` is not `auto` (the element is a multi-column container);
  - `scrollContainer`: `overflow-x` or `overflow-y` is not `visible` (scroll-behavior and scroll-snap-type act on it);
  - `transformed` and `perspectiveContext`: the element is a transformable one — it draws a box and is not a bare `inline` (the computed display is none of `inline`, `contents` and `none`): `transform-box`, `perspective-origin`, `transform-style` and `backface-visibility` act there;
  - `inlineOrCell`: display holds `inline` or is `table-cell` (vertical-align acts there);
  - `fragmented`: a block-level box (any display but `inline`, `contents` and `none`), where the fragmentation properties act.
  On the parent's computed style:
  - `flexItem` / `gridItem` / `flexOrGridItem`: the parent's display holds flex / grid / either (a child of a flex or grid lays itself out with these);
  - `snapChild`: the parent is a scroll container whose `scroll-snap-type` is not `none`.
- A context the editor cannot read (nothing selected, the page not drawn, no parent above the page root) hides nothing: a field of a context predicate shows, so a value is never unreachable because a measurement was late.
- `border-spacing` takes one length for both axes or two (horizontal, then vertical). A bare number takes px. No percentage: CSS refuses one here.
- `list-style-type` offers the menu's counter styles (the property's `menu` subset) and takes any other counter-style name, or a quoted string, typed.
- `list-style-image` takes an image address (written `url("…")`), a gradient, or none.
- `object-position` takes keywords and lengths or percentages, one or two.

### Problems in Pager

1. **The media rows show on elements they do nothing for.** Pager's `MEDIA_ANY` includes `svg` and `picture`; `object-fit` and `object-position` have no effect on either (a picture is not a replaced element; the image inside it is). Required: the media fields show only on `img`, `video`, `canvas` and `iframe`.
2. **The form rows show on options.** Pager's `FORM_ANY` includes `option` and `optgroup`, where Chrome ignores `accent-color` and `appearance`. Required: the form fields show only on `input`, `textarea`, `select`, `button`, `progress` and `meter`.
3. **`object-position` only offers five keywords** (`catalogue.js:430`). Required: a position of keywords, lengths or percentages, one or two values, like the background position.
4. **`border-spacing` takes one length** (`catalogue.js:420`). Required: one or two lengths; anything else is refused, naming the value.
5. **`list-style-image` is free text** (`catalogue.js:427`, placeholder `url(...)`): anything typed is written. Required: an address, a gradient or none, else refused; the address is checked like every other image address (no script source).
6. **`list-style-type` can only take the menu's nine values.** Required: the menu offers them, and any other counter style or a string can be typed.
7. **The kind is read from Pager's own node type, not from the tag**, so a list whose tag was switched keeps or loses its rows by its old type. Required: the kind is read from the tag the element is written with.

### Refusals

- A value the property does not take is refused, the document is unchanged, and the status bar names the value (`status.style.invalidValue`).

### Undo and redo

Each value set is one undo step; undo restores the value the element held before.

## props-filters-clip

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Effects: **Filter**, a text field (placeholder `blur(2px)`, `src/features/inspector/catalogue.js:397`).
- More: **Backdrop filter** (placeholder `blur(8px)`), **Clip path** (`inset(0 round 8px)`), **Mask image** (`linear-gradient(#000,transparent)`), text fields (`catalogue.js:457-459`).

### Hit zones and thresholds

Not applicable: every control is a field of the inspector.

### Visual feedback

The canvas draws the element again at once; the fields show the stored text.

### Result in the document

- Each field stores the typed text as its property: `filter: blur(2px)`, `backdrop-filter: blur(8px)`, `clip-path: inset(0 round 8px)`, `mask-image: …`.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields are keyboard-operable like every inspector field.

### Problems in Pager

1. **The filters are one text field:** changing the blur means retyping every filter, and a typo (`blur(2)`) is stored and dropped by the browser. Required: one field per filter function (Blur, Brightness, Contrast, Saturation, Hue rotation, Grayscale, Invert, Sepia), each setting its function in the filter value (in its place, the others kept) through one command, `style.setFilter`; Remove filters takes them all away; a value the browser does not take is refused with a message and nothing is written.
2. **The mask image takes any text,** a script address included. Required: Mask image takes an image address as the background image does (bare or inside url(), a web address or a path inside the project); another scheme is refused naming the address.
3. **Backdrop filter and clip path store text the browser drops.** Required: a value the browser does not take is refused with a message.

### Our rule (the user's real-use audit, item A3.31)

- **Remove filters takes the declaration away.** The door hands `style.setFilter` `functions: "none"`, and the
  command routes it to `removeStyle` (`src/core/style/reset.ts`), the one owner of taking a declaration away: the
  `filter` declaration leaves the styles of every selected element at the breakpoint and state in view. The document
  and the export hold no `filter` at all, never a `filter: none` left in its place. The status bar names the reset and
  the change is one undo step, as every reset is.

### Our rule: the quick panel's guided Effects and Skew fields (the user's real-use audit, item 6.4)

- The quick panel's **Effects** field writes the whole filter list, and a **bare number in it is a blur radius in px**
  (`2` is `blur(2px)`, through the same `withBareUnit` the per-function fields use; `src/editor/canvas/quick-panel.tsx`
  `functionsTyped`); the full CSS list still works (`blur(2px) brightness(1.2)`, `none` takes them all away), and a text
  that is neither is refused naming the field. The guided per-function controls (a field per filter, its unit its own,
  the sliders) stay in the Style tab's Effects section.
- The quick panel's **Skew X and Skew Y** take a bare number as **degrees** (`10` is `skewX(10deg)`), like the
  inspector's own transform fields: the bare unit of each function comes from one owner
  (`src/core/style/functions.ts` `withBareUnit`: blur px, grayscale %, skew deg, scale a factor), so no door demands
  raw CSS syntax from a person.
4. **The eight filter sliders stayed disabled until the element held a filter** (the audit's S-024: Brightness could not be dragged, eight rows read none). Required: a filter function the element does not hold slides from its identity, which the slider declares (`slider.neutral`: blur 0 px, brightness, contrast and saturation 100 %, hue rotation 0 deg, grayscale, invert and sepia 0 %): the thumb sits there, and releasing it elsewhere writes the function (`brightness(150%)`) in one undo step; releasing it where it started writes nothing.

## props-flex-container

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container with `display: flex` holding three Paragraphs.

### Trigger

- Inspector › Style › Layout, for a flex container (`src/features/inspector/properties.js:2308`, `:2523`):
  - **Direction:** a segmented control of four arrows, `row`, `row-reverse`, `column`, `column-reverse` (`flexDirection`, editor `segmented`).
  - **Wrap:** `nowrap`, `wrap`, `wrap-reverse`.
  - **Align:** the alignment pad (`ppAlignPad`, `properties.js:1988-2044`): a 3 × 3 grid of cells, and beside it **Stretch** and **Spread**.
  - **Justify content**, **Align items**, **Align content** as menus; **Gap**, **Row gap**, **Column gap** as length fields.
- A click on a cell sets where the children sit, as the cell is drawn: the top-left cell puts them at the top left, whatever the direction.

### Hit zones and thresholds

| Part | Mapping |
|---|---|
| Cell (row r, column c) | Horizontal main axis (`row`): justify-content from the column, align-items from the row; vertical main axis (`column`): justify-content from the row, align-items from the column (`valuesAt`, `properties.js:1997-2000`). |
| Reversed direction | The main axis values are mirrored: in `row-reverse`, the left column writes `flex-end` (`mainReverse`, `:1995`). |
| `wrap-reverse` | The cross axis values are mirrored (`crossReverse`, `:1996`). |
| Values written | `flex-start`, `center`, `flex-end` (`PP_MAIN`, `:1987`). |

### Visual feedback

| Stage | What is drawn |
|---|---|
| Alignment set | The cell standing for the justify-content and align-items the element holds is pressed; none while Stretch or Spread holds (`paint`, `:2033-2043`). |
| Stretch / Spread | Their button is pressed while align-items is `stretch` / justify-content is `space-between`. |
| Every change | The canvas lays the children out again at once. |

### Result in the document

- Direction writes `flex-direction`; Wrap `flex-wrap`; each menu its property; Gap writes the gap (both axes), Row gap and Column gap one each.
- A cell writes `justify-content` and `align-items` of the node together, one undo step (`ppWriteMany`, `:3318`).
- Stretch writes `align-items: stretch`; Spread writes `justify-content: space-between`.
- The gap is the distance the iframe measures between two neighbouring children.

### Undo and redo

Each change is one undo step; a cell's two properties are undone together.

### Nested elements

Not applicable: the controls act on the selected container only.

### Zoom other than 100 %

Not affected (the controls are in the Inspector).

### Keyboard equivalent

The cells, Stretch and Spread are buttons: Tab reaches them and Enter or Space presses them. The menus and length fields are keyboard-operable like every inspector field.

### Problems in Pager

1. **Stretch and Spread write both properties:** a click on Stretch also writes the pad's justify-content (`onChange({ justify, align })`, `properties.js:2027`, `:2029`), so an element that held no justify-content gets `flex-start` it was never given. Required: Stretch writes only `align-items`, Spread only `justify-content`.
2. **The cells' names are English text written in the code** (`["Top", "Center", "Bottom"][r] + " " + ["left", "center", "right"][c]`, `:2019`), so they are never translated. Required: each cell is named from the catalogue, in the editor's language.

3. **A container made flex by its class was refused the matrix** (found by the pairing on the design's page, 2026-10-03, AL1): the availability read the element's own display only, so the plans' cards — flex by `.card` — drew the matrix disabled ("Alignment applies to flex and grid containers."), and a grid made by a class could not open the grid editor. Required: an availability predicate that reads one value (`flexOrGridContainer`, `gridContainer`, `positionedSelection`) reads the element's own value, else the one its classes give it, the last of the project's classes that sets it winning, as in the exported stylesheet.

Pager draws the flex controls only for a flex box (`when: isFlexBox`, `catalogue.js:308-316`). In this editor the fields stay drawn, and the cells, whose command is available on a flex or grid container only (the manifest's availability `flexOrGridContainer`), are disabled elsewhere, their title giving the reason (`status.layout.notFlex`), and a click on them writes nothing.

## props-grid-container

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container with `display: grid` holding three cards.

### Trigger

- Inspector › Style › Layout, for a grid container (`src/features/inspector/catalogue.js:313-319`):
  - **Columns:** the track editor (`ppTracks`, `properties.js:2048-2100`; `editor: "tracks"`, `:2319`): one row per track with its size and unit (`fr`, `px`, `%`, `em`, `rem`), a track written as an expression shown as text, and **Add a track** (`:2059-2061`), which adds `1fr`.
  - **Rows:** a text field (placeholder `auto auto`).
  - **Auto flow:** `row`, `column`, `dense`, `row dense`, `column dense`; **Justify items:** `stretch`, `start`, `end`, `center`.
  - **Areas** (More): a text field (placeholder `"head head" "side main"`, `:441`).

### Hit zones and thresholds

Not applicable: every control is a field, a button or a menu of the inspector.

### Visual feedback

The canvas lays the grid out again at once; the track editor's strip shows the rendered size of each column.

### Result in the document

- Columns writes `grid-template-columns` (the tracks joined, `none` for none, `:2067`); Rows `grid-template-rows`; the menus their properties; Areas `grid-template-areas`.
- Add a track appends `1fr` to the columns.
- The children are laid out in the iframe on the tracks written.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable: the controls act on the selected container only.

### Zoom other than 100 %

Not affected (the controls are in the Inspector).

### Keyboard equivalent

The fields, the button and the menus are keyboard-operable like every inspector control.

### Problems in Pager

1. **The track editor's names are English text written in the code** (`"Line names"`, `"Track expression"`, `"Track size"`, `properties.js:2081-2082`), so they are never translated. Required: every name of the grid controls comes from the catalogue.
2. **Areas are stored as typed:** rows of different lengths (`"a b" "c"`) are stored and the browser drops them silently. Required: areas the browser does not take are refused with a message and nothing is written; so are tracks.
3. **Add a track has no door of its own that says what it writes.** Required: Add column is a door of style.set that stands for the tracks it writes (the columns the element has, then 1fr; the first track of a grid with none).

### Our rule

- **The track editor** (the user's real-use audit, item A1.2). The tracks a grid's axis holds are read and written by
  one owner, `src/core/style/tracks.ts`: a value written in the repeat form the templates use
  (`repeat(3, minmax(0, 1fr))`) holds that track three times, a list (`1fr 2fr auto`) holds its own, `none` or no
  value holds none; written back, equal tracks take the repeat form, a single track is written plainly, any other
  list is joined. The editor draws, for a grid container's columns and again for its rows: the count of tracks, one
  field per track keeping that track in its place (`style.setGridTracks` with the place and the text typed), and the
  doors that add and remove a track. The raw value keeps its own field beside the editor.
- Add appends a track like the ones the axis already holds while they are all the same (three equal columns take a
  fourth and keep their `repeat(4, …)`; the acceptance of the audit), the default track `minmax(0, 1fr)` otherwise,
  and the first track of a grid that holds none. Remove takes the last track away (`none` from one). A place the grid
  does not hold, and a track the property does not take, are refused with what was typed named and nothing written.
- Each edit is one undo step, written at the base breakpoint and state like every style write; a locked element
  refuses as every style write does (spec lock-element).

### Our rule: the grid child (the user's real-use audit, item A1.3)

- A grid item's place is written by start and span, one axis at a time: `style.setGridItem` takes `grid-column` or
  `grid-row` and whole numbers for `start` and `span`, writes them as the composite's own value through `style.set`'s
  reader and writer (`"2 / span 3"`, `"span 2"` alone for a span, the plain number for a start), and reads the half a
  door leaves out from the value the item holds. A start or a span below 1 is refused, naming the number; a locked
  element refuses as every style write does. The Style tab draws, for the child of a grid, one field per half on each
  axis (Column start, Column span, Row start, Row span).
- The **Area** field (grid-area) takes the name of an area or a line the parent's `grid-template-areas` holds, as a
  CSS identifier, and writes it into the property's four longhands (grid-row-start, grid-column-start, grid-row-end,
  grid-column-end — the manifest forbids storing a shorthand whole, so the value is written as the composite it is);
  the card moves into that area. It reads no list of its own: an area name is what the person wrote in the parent.
- The **Span in columns** property (`column-span`) belongs to multi-column layouts: its name says so, so it is not
  taken for the grid item's span.

## props-layout-item

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Paragraph inside a flex Container, and one inside a grid.

### Trigger

- Inspector › Style › Layout, group Item (`src/features/inspector/catalogue.js:322-329`), for a child of a flex or grid container:
  - **Grow**, **Shrink** (number fields) and **Basis** (a length field), for a flex item;
  - **Align self** (`auto`, `stretch`, `flex-start`, `flex-end`, `center`, `baseline`), for a flex or grid item; **Justify self** (`auto`, `stretch`, `start`, `end`, `center`), for a grid item;
  - **Order** (a number field);
  - **Grid column** and **Grid row** (text fields, placeholders `2` and `1`), for a grid item.

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

The canvas lays the item out again at once; the fields show the stored values.

### Result in the document

- Each control writes its property of the node's desktop base style: `flex-grow: 1`, `flex-basis: 50%`, `align-self: center`, `order: 2`, `grid-column: 1 / 3`.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable: the controls act on the selected item only.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field.

### Problems in Pager

1. **Order is a number field of any number** (`kind: "num"`, `catalogue.js:327`): a decimal is stored and dropped by the browser. Required: order takes a whole number; anything else is refused with a message.
2. **Grow and Shrink take negative numbers** (a plain number field), which the browser drops. Required: they take a number that is not negative; anything else is refused with a message.
3. **Align self offers six values** (`catalogue.js:325`), leaving out `start`, `end`, `self-start`, `self-end` and `anchor-center`, which every browser takes. Required: it offers every value of the property's generated list.

## props-more

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Layout (`src/features/inspector/catalogue.js:320`) and More (`:439-440`, `:474-489`):
  - **Columns** (a number field, `kind: "num"`, `:320`);
  - **Column span**, **Column fill**, **Column rule width**, **Column rule style** (`none`, `solid`, `dashed`, `dotted`, `double`, `:480`), **Column rule colour**, shown for a multi-column box;
  - **Break before / after / inside**, shown inside a fragmented flow;
  - **Scroll behaviour** (`auto`, `smooth`), **Scroll snap type** (six fixed combinations, `:488`), **Scroll snap align**;
  - **Contain** (`none`, `layout`, `paint`, `size`, `style`, `content`, `strict`), **Content visibility**;
  - **Counter reset** and **Counter increment** (text fields, placeholders `section 0` and `section 1`).

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

The canvas draws the element again at once; the fields show the stored values.

### Result in the document

- Each control writes its property of the node's desktop base style: `columns: 3`, `column-rule-width: 2px`, `break-inside: avoid`, `scroll-behavior: smooth`, `contain: paint`, `counter-reset: section 0`.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field.

### Problems in Pager

1. **Columns is a number field** (`kind: "num"`, `:320`): only a count can be given, never a column width. Required: Columns takes a width, a count or both, in either order (`200px 3`), written as column-width and column-count; what is left out is auto.
2. **Column rule style offers five of the ten border styles** (`:480`). Required: every value of its generated list.
3. **A column rule width over a rule styled none draws nothing.** Required: writing the column rule width while its style is none also writes solid (the manifest's coupling `column-rule-width-shows-style`).

### Our rule (the user's real-use audit, item A3.31)

- **Resetting a rule width takes the style it made with it.** Writing `column-rule-width` while the rule style is
  `none` writes `solid` through the coupling `column-rule-width-shows-style` (Problems in Pager 3). Resetting the width
  must not leave that style orphaned — `column-rule-style: solid` alone draws a `medium` rule, and the export carries
  it. `removeStyle` (`src/core/style/reset.ts`) therefore takes, with the property it is asked to remove, every
  declaration a `setValue` coupling writes for it (trigger `via` null) while that declaration still holds exactly the
  value the coupling wrote; a style the person set otherwise keeps its value. The same rule covers the border widths.

## props-position

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Position (`src/features/inspector/catalogue.js:410-417`):
  - **Position:** `static`, `relative`, `absolute`, `fixed`, `sticky` (a menu).
  - **Top, Right, Bottom, Left** (length fields) and **Z-index** (a number field), shown only for a positioned element (`when: positioned`).
  - **Float** (`none`, `left`, `right`) and **Clear** (`none`, `left`, `right`, `both`), shown for a box outside flex and grid.

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

The canvas lays the element out again at once; the fields show the stored values.

### Result in the document

- Each control writes its property of the node's desktop base style: `position: absolute`, `top: 10px`, `z-index: 5`, `float: left`, `clear: both`.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field.

### Problems in Pager

1. **Z-index is a number field of any number** (`kind: "num"`, `catalogue.js:415`): a decimal is stored and the browser drops it. Required: z-index takes a whole number or `auto`; anything else is refused with a message and nothing is written.
2. **The offsets and z-index disappear while the element is static** (`when: positioned`), so a person cannot prepare them before switching the mode. Required: they stay drawn; the mode is its own control, one button per mode, and its command (`position.setMode`) is the one writer of the mode.
3. **The five mode buttons wrapped onto two lines in the value column** (static relative absolute / sticky fixed; the audit's S-015), so the row was twice as tall as its neighbours and its buttons moved when the column narrowed. Required: keyword buttons never wrap. While their words do not fit the row's value column, the control is a keyword menu instead: a field-like button showing the value (the computed one muted while the element holds none; Mixed for several different values) that opens the list of the values, one item per value, the one held checked; choosing an item runs the same command as the button did (`position.setMode`, one undo step) and the focus returns to the button. Buttons drawn as icons (Direction, Text align) always fit and stay buttons.

### Our rule (the user's real-use audit, item A3.31)

- **The way back takes the inert coordinates away.** `position.setMode` writing `static` or `relative` also takes the
  inset longhands (top, right, bottom, left) the element holds its own, at the breakpoint and state in view: in the
  flow they are inert, and they would go to the export and resurface at the next absolute. They leave in the same
  undo step as the mode, and the element stays where it stands. Two values a person may have meant stay: `z-index`
  (it acts on a later positioned state, and nothing tells the editor who wrote it) and the parent's `position:
  relative` (it is the containing block of any absolute descendant, and other descendants may need it).

## props-size-overflow

How Pager behaves, read from its source. Source references are `path:line` inside Pager. Width and Height are the fields of inspector-number-fields; this feature is the rest of the Size section and the overflow fields.

### Trigger

- The inspector's **Size** section (open at first, its header summarising `width × height`, `auto × auto` when neither is set: `src/features/inspector/properties.js:347`). Its rows (`:2528-2529`): Width, Height, Min width, Min height, Max width, Max height, Box sizing, Aspect ratio, then the media rows. Each applies to an element that is not `display: inline` (`hasBox`, `src/features/inspector/catalogue.js:154`, `:331-337`, `:348-351`).
- **Min width, Min height, Max width, Max height** are number fields with a unit menu (`dimension`, `properties.js:2337-2340`, drawn by `:3270-3279`). The units differ from row to row: Min width offers `ch`, Min height does not; Max width and Max height add `none` (`:2337-2340`); all four add `auto`, `min-content`, `max-content` and `fit-content` (`SIZE_KEYWORDS`, `:3272`; `src/model/values.js:44`).
- **Box sizing** is two icon buttons, content-box and border-box (`choice` with icons, `properties.js:2341`; `ppClosedSet`, `:3430-3434`).
- **Aspect ratio** is a plain text field, placeholder `16 / 9` (`properties.js:2342`; `catalogue.js:351`).
- **Overflow** lives in another section, Layout (`properties.js:2269`, `:2545`, `:2559`): an Overflow row of five icon buttons, visible, hidden, scroll, auto, clip (`:2425`), and, behind a disclosure on that row, Overflow X and Overflow Y with the same buttons (`detailOf`, `:268-273`; the disclosure `:3200-3213`; `:2426-2427`).

### Result

- Each row writes its own property through `setProp` (`catalogue.js:668-707`): refused when the style schema does not accept the value (`:691`) or, for the buttons, when it is not one of the short list (`:690`); the same value writes nothing (`:699`).
- **Overflow** is stored as the `overflow` shorthand beside `overflow-x` and `overflow-y` (three catalogue entries, `catalogue.js:348-350`): writing Overflow after Overflow X leaves both declarations in the node, and which one the page shows depends on the order the stylesheet writes them in.
- A negative size (`-10px`) is refused by the schema with the export toast (`properties.js:2667-2680`).
- The Size summary reads the declared width and height only (`properties.js:347`): an element sized by its content says `auto × auto`, and so does one whose width comes from a class or another breakpoint.

### Visual feedback

| Stage | What is drawn |
|---|---|
| Section open | One row per property; an unset field shows the value in force greyed. |
| After a change | The field shows the new value; the canvas redraws the element. The status bar says nothing. |
| Refused value | A toast with the refusal; the field shows its previous value. |

### Undo and redo

Each kept value is one undo step (`catalogue.js:700-706`).

### Keyboard equivalent

Tab moves between the fields; Enter keeps a typed value; the number field keys apply in the four size fields (inspector-number-fields).

### Problems in Pager

1. **Overflow is stored twice**, as the shorthand and as its longhands, so one element can hold contradicting values. Required: Overflow is the `overflow` composite: keeping a value writes `overflow-x` and `overflow-y` in one command and one undo step (`hidden` writes both `hidden`; `hidden scroll` writes `hidden` and `scroll`, the first value for X and the second for Y), and the document never stores `overflow`. Overflow X and Overflow Y each write their own longhand. The three fields sit in the Size section's overflow group (`properties.json`).
2. **The size fields offer different units for no reason.** Required: every size field offers the units and keywords the generated browser data allows for its property (All properties), a bare number takes px (`200` → `200px`) and a typed unit or keyword is kept as typed.
3. **Box sizing and the overflow fields accept only their short list.** Required: each keyword field offers every keyword the browsers support for its property and also takes a typed keyword kept with Enter (`border-box`, `clip`).
4. **Refusals are a toast about the export.** Required: a value the property does not take (a negative size, `wide` as an aspect ratio, `sideways` as an overflow) is refused with `status.value.invalid` naming the property's label and the typed text; the document keeps its value and nothing is recorded.
5. **Nothing says what changed.** Required: every kept value is reported by the status bar with the property's label, the element's name and the value as stored (`status.style.set`, e.g. `Min height of Actions: 200px.`).
6. **A locked element's size and overflow change.** Required: a locked element, or one inside a locked element, refuses with `status.locked.edit` (spec lock-element) and keeps its values.
7. **The values are only written, never shown to hold.** Required: what the fields write is what the page draws: a min width larger than the max width wins, a max height caps the content box (the padding added outside it) until Box sizing is `border-box`, and an aspect ratio gives an element with a width and no height the height the ratio asks.
8. **The Size summary reads only the declared values.** Required: the collapsed Size header summarises the width and the height the page computes for the element (`sections[].summary` of `properties.json`, spec inspector-panel), whatever sets them.

### Our rule (the user's real-use audit, item A3.30)

- **The Aspect ratio field offers the ratios a screen or a card takes** (16 / 9, 4 / 3, 3 / 2, 1 / 1, 21 / 9, 9 / 16;
  properties.json's `presets` subset, read into the field by `offers.presets`), and writes the one chosen as the CSS
  value it is (`aspect-ratio: 16 / 9`); any other ratio of two numbers stays typed.

## props-spacing

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- The inspector's **Space** section (collapsed at first, its header summarising `P 56px 40px` for a fresh Section): the box model editor `ppSpacing` (`src/features/inspector/properties.js:1211-1325`). A diagram draws the margin around the padding around the content size (`w × h`, read from the frame, `:1226-1238`); beside it, one group per box (Margin, Padding), each with a unit menu, a **Link sides** toggle (`inspector.linkSides`, `:1280-1290`) and four number fields Top, Right, Bottom, Left (`:1294-1318`), placeholder `0`, no scrub glyph.
- Keys in a side field are those of every number field (inspector-number-fields).

### Result

- A side field writes its own longhand (`padding-top`…) with the typed number and the box's unit (`:1300-1304`).
- While **Link sides** is on, a change in any side field writes the same value to all four sides (`:1302`).
- Turning **Link sides** on copies the Top value into Right, Bottom and Left at once (`:1283-1288`), a document change made by a view toggle. The toggle's state is kept per box in a memory shared by every element (`ppCursor("spacing:" + kind)`, `:1281`, `PP_CURSOR`, `:1338-1340`) and lost on reload.
- The unit menu converts all four sides to the chosen unit (`:1262-1278`); `auto` is offered for margins only (`:1259`).
- Nothing bounds the fields: a negative padding is written like any value, and the browser drops it (a negative padding is invalid CSS), so the element keeps its previous padding without a word. A negative margin works.
- Text that is not a value is put back silently (the number field's rule, spec inspector-number-fields).

### Visual feedback

| Stage | What is drawn |
|---|---|
| Section open | The diagram with the content size in its core, the two groups with their four fields; hovering or focusing a field lights its side in the diagram (`:1308-1312`). |
| After a change | The field shows the new value; the canvas redraws the element. The status bar says nothing. |
| Link sides on | The link button pressed; three sides jump to the Top value. |

### Undo and redo

Each side change is one undo step. Turning Link sides on, which rewrites three sides, is one undo step too, though it looks like a view option.

### Keyboard equivalent

Tab moves between the side fields; the number field keys apply (inspector-number-fields).

### Problems in Pager

1. **Turning Link sides on rewrites three sides** from the Top value: a view toggle that silently changes the document. Required: `inspector.toggleSpacingLink` changes only how the box is edited and writes nothing (no undo step); the status bar says the box is linked or unlinked (`status.spacing.linked`, `status.spacing.unlinked`). While a box is linked, its four side fields are replaced by one field for the four sides (the box's composite door), holding the value when the four agree and empty otherwise; keeping a value there writes the four longhands (`style.setSpacing` with `sides: all`) as one undo step. Unlinked, each side field writes its own longhand.
2. **The link's state lives in a memory lost on reload** and shared silently. Required: the link belongs to the element, never to every element at once (J27 of the jornada03 study: one global switch turned on for the footer linked every button's padding too). A box whose four sides hold the same value is linked; any other is not; turning the link on or off is kept for that element while the editor is open (`ui.spacingLinks`, by element), and another element keeps its own.
3. **A negative padding is accepted and then dropped by the browser**, so nothing happens and nothing says why. Required: a negative padding is refused with `status.value.negativePadding` and the document keeps its value; a negative margin is accepted and drawn.
4. **Invalid text is put back without a word.** Required: text that is not a length, a percentage or (for a margin) `auto` is refused with `status.value.invalid` naming the property and the text; the document keeps its value.
5. **Nothing says what changed.** Required: every kept value is reported by the status bar with the property's label, the element's name and the value (`status.spacing.set`, e.g. `Padding top of Hero: 32px.`); a typed unit is kept as typed (`2rem`), a bare number takes px.
6. **A locked element's spacing can be changed** (Pager has no lock on this path). Required: a locked element, or one inside a locked element, refuses with `status.locked.edit` (spec lock-element) and keeps its values.
7. **A side of the box took no arrow, and the Tab walked margin top and left, then the padding, then margin right and bottom** (the audit's S-014). Required: ArrowUp and ArrowDown in a side step the length it holds by one of its unit (Shift ×10, Alt ×0.1), as a number field's arrows do (`field.step` in the `spacing-field` context, one undo step per burst), the side standing for its longhand; the Tab walks each box's four sides clockwise from the top (top, right, bottom, left), the margin's before the padding's.

## props-transforms

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Effects: the transform editor (`ppTransform`, `src/features/inspector/properties.js:1912-1985`): a stage where the box is dragged to move it, its corner to scale it and a ring handle to rotate it, and six number fields, **X**, **Y** (px or %), **Rotate** (deg), **Scale**, **Skew X**, **Skew Y** (deg) (`:1934-1950`); and the text fields **Transform**, **Scale**, **Rotate**, **Transform origin** (`catalogue.js:399-403`).
- More (`catalogue.js:461-465`): **Perspective** (a length), **Perspective origin** (text), **Transform style** (`flat`, `preserve-3d`), **Back face** (`visible`, `hidden`), **Transform box** (five values).

### Hit zones and thresholds

| Part | Mapping |
|---|---|
| The box dragged | X and Y follow the pointer, px (`:1968-1973`). |
| The corner dragged | Scale = start + travel / 90, from 0.2 to 2 (`:1974`). |
| The ring handle dragged | Rotate = the pointer's angle around the ring, whole degrees (`:1975-1979`). |

### Visual feedback

The stage's box shows the transform (its moves clamped to the stage, `:1953-1955`); the canvas draws the element again at once.

### Result in the document

- The editor writes the whole transform as one value (`options.onChange(Object.assign({}, v))`, `:1952`).
- Transform origin, Perspective, Perspective origin, Transform style, Back face and Transform box write their properties.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the controls are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field; the stage's drags have no keyboard equivalent.

### Problems in Pager

1. **Move, rotate and scale are written into one transform value** together with the skews, so one of them cannot be changed without rewriting the others. Required: Move X and Move Y write the translate property (one axis each, the other kept; an axis before the one typed is zero when it has no value), Rotate the rotate property, Scale the scale property; Skew X and Skew Y write their function in the transform value (each in its place, the other functions kept), through one command, `style.setTransform`.
2. **A value the browser does not take is stored** (the text fields keep any text). Required: a value the browser does not take is refused with a message and nothing is written.

## props-transition

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Container.

### Trigger

- Inspector › Style › Effects: **Transition**, a text field (placeholder `all .2s ease`, `src/features/inspector/catalogue.js:404`; editor `text`, `properties.js:2434`).
- More: **Will change**, a menu of `auto`, `transform`, `opacity`, `scroll-position`, `contents` (`catalogue.js:493`).

### Hit zones and thresholds

Not applicable: both controls are fields of the inspector.

### Visual feedback

The field shows the stored value; a transition shows once the element's style changes.

### Result in the document

- Transition stores the typed text as the `transition` shorthand; Will change writes `will-change`.
- The computed transition longhands in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

Both fields are keyboard-operable like every inspector field.

### Problems in Pager

1. **The transition shorthand is stored as typed,** so the document holds text the editor cannot read back by part (a duration alone cannot be changed) and a typo (`opacity 3 ease`) is stored and dropped by the browser. Required: Transition is written as its longhands (property, duration, timing function, delay, behaviour), each holding the transitions' values in order; what a transition leaves out is the initial value; text that is no transition is refused with a message and nothing is written.
2. **Will change is a menu of five values,** leaving out the other properties a page may animate. Required: it takes any property name or list the browser takes, the menu suggesting the common ones.

### Our rule (the user's real-use audit, item A3.30)

- **The Transition field offers the transitions a page usually takes** (`all 200ms ease`, `all 300ms ease-in-out`,
  `opacity 200ms ease`, `transform 300ms ease`, `background-color 150ms linear`; the composite's `presets` subset,
  read into the field by `offers.presets`); the one chosen is written as its longhands, as any typed transition is.

## props-typography-advanced

How Pager behaves, read from its source (source references are `path:line` inside Pager) and checked in `.cache/pager-run`. Test element: a Paragraph.

### Trigger

- Inspector › Style › More, typography (`src/features/inspector/catalogue.js:443-451`), for an element with text:
  - **Font stretch** (five values), **Font variant** (`normal`, `small-caps`, `all-small-caps`, `tabular-nums`, `oldstyle-nums`), **Overflow wrap**, **Hyphens**, **Direction**, **Writing mode**, **Text orientation** as menus;
  - **Font features** (a text field, placeholder `"liga" 1`);
  - **Line clamp** (`WebkitLineClamp`, a number field, `:448`).

### Hit zones and thresholds

Not applicable: every control is a field or a menu of the inspector.

### Visual feedback

The canvas draws the text again at once; the fields show the stored values.

### Result in the document

- Each control writes its property of the node's desktop base style: `font-stretch: condensed`, `font-variant: small-caps`, `font-feature-settings: "liga" 0`, `overflow-wrap: anywhere`, `hyphens: auto`, `direction: rtl`, `writing-mode: vertical-rl`, `text-orientation: upright`.
- Line clamp writes `-webkit-line-clamp: 2` alone.
- The computed values in the iframe match.

### Undo and redo

Each change is one undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the fields are in the Inspector).

### Keyboard equivalent

The fields and menus are keyboard-operable like every inspector field.

### Problems in Pager

1. **Line clamp writes `-webkit-line-clamp` alone** (`catalogue.js:448`), which clamps nothing: the browser needs `display: -webkit-box`, `-webkit-box-orient: vertical` and a hidden overflow with it. Required: Line clamp is written through its recipe (`line-clamp`, properties.json recipes): stored by its id and drawn and exported as all its declarations; a whole number from 1; a later write of the display or the overflow of the element takes the clamp away (the recipe's `otherWrite: clears-recipe`).
2. **Font variant is a menu of five values mixing caps and numeric variants** (`:444`) and stores the shorthand. Required: each variant typed goes to its longhand (small-caps: font-variant-caps, tabular-nums: font-variant-numeric), several at once, the others left as they are; `normal` alone makes every longhand normal.
3. **Font stretch offers five of the nine keywords** (`:443`). Required: every value of its generated list.

### Our rule (the user's real-use audit, item A3.31)

- **A recipe over a declaration the element holds its own is refused.** The line clamp recipe writes `display:
  -webkit-box` and `overflow: hidden` with its own declarations (Problems in Pager 1); if the element already holds
  `display` (or `overflow`) itself, the write would leave two `display` declarations the inspector cannot show, so
  `style.set` refuses it before anything is written, naming the recipe and the property in the way (status
  `recipe.conflict`, "Line clamp needs Display of its own: reset it first."). The other direction is unchanged: a later
  write of the display or the overflow takes the clamp away (the recipe's `otherWrite: clears-recipe`).
4. **The line clamp ignored where it applies** (properties.json declared its recipe for text, and nothing read it). Required: a recipe applies where its `appliesTo` says, as a property does — the line clamp is a text field, offered where the text fields are (the quick panel and Essentials narrow it by what the element holds).

## props-typography

Jornada 03 J15a: opening a field's values menu never confirms its unfinished text. The input, trigger and value list form one editing interaction. Choosing replaces the draft with one document change; Escape closes the list and returns to the unchanged draft. Enter, Tab or leaving the interaction confirms once, against the elements the draft was typed for. The arrows explore the list; its options are not separate Tab stops, so Tab and Shift+Tab leave the list and confirm once.

How Pager behaves, read from its source. Source references are `path:line` inside Pager.

### Trigger

- The inspector's **Text** section (collapsed at first on a Section, open on a text element: `homeSection`, `src/features/inspector/properties.js:279-284`; its header summarises `font-size · font-weight`, `:350`). Its rows, in order (`:2533-2536`): Font, Size, Weight, Style, Line height, Letter spacing, Word spacing, Align, Colour, Decoration, Case, Indent, Text overflow, White space, Word break, Vertical align. Each row applies where the catalogue says (`src/features/inspector/catalogue.js:352-369`): every element that can hold text, text overflow only on a clipping box (`:365`), vertical align only on an inline, inline-block or table-cell element (`:368-369`).
- Each property has its editor (`properties.js:2358-2375`, drawn by `ppEditor`, `:3245-3404`):
  - **Font**: a button that opens a popover listing six families, each drawn in its own face with a sample, and a "Custom" text field under the list (`ppFontPicker`, `:2108-2147`; the list `PP_FAMILIES`, `:2100-2107`).
  - **Size, Letter spacing, Word spacing, Indent**: the number field with a unit menu (`dimension`, `:3270-3279`; units `px rem em %` for Size and Indent, `em px rem` for the spacings, `:2360`, `:2364-2365`, `:2371`).
  - **Weight**: a button that opens a popover of the nine numbered weights, each drawn in its weight with its name, "Thin" … "Black" (`ppWeightPicker`, `:2150-2181`; names `src/core/i18n.js:2606-2614`).
  - **Line height**: a plain text field, placeholder `1.5` (`text`, `properties.js:2363`; `catalogue.js:358`).
  - **Align**: six icon buttons, left, center, right, justify, start, end (`ppSegmented`, `properties.js:2366-2367`, `:1070-1101`).
  - **Style, Case, Decoration, Text overflow, White space, Word break, Vertical align**: a closed set (`ppClosedSet`, `:3430-3438`): icon buttons when every value has an icon and there are six or fewer, text buttons when they fit, otherwise a button that opens a menu (`ppSelect`, `:1019-1051`). The values are the catalogue's short lists (`catalogue.js:356-369`).
- Keys: the number field's keys in the length fields (inspector-number-fields); in a menu button ArrowDown and ArrowUp pick the next or previous value at once (`properties.js:1036-1042`).

### Result

- Every editor writes its property through `setProp` → `setProps` (`catalogue.js:668-707`, `:716-718`): the value is refused when it is not in the property's short list (`:690`) or when the style schema does not accept it (`:691`); the same value writes nothing (`:699`); otherwise one inspector transaction writes it to the node, in the current breakpoint and state (`writeProp`, `:645-658`).
- A number field writes the typed number with the chosen unit (`properties.js:3278`); Line height writes the text as typed (the default text field, `:3402-3403`); the Font's Custom field writes whatever it holds (`:2138-2139`).
- **Decoration** is stored whole as the `text-decoration` shorthand (`catalogue.js:362`), and **White space** as the `white-space` shorthand (`:366`).
- The Weight popover offers only the numbered weights (`ppWeights` keeps the values above 0, `properties.js:2148`): `normal`, `bold`, `lighter` and `bolder`, which the catalogue lists, cannot be chosen.
- The Font list mixes stacks the page never loads (`'Sora'`, `Inter`, `'JetBrains Mono'`, `properties.js:2102-2103`, `:2105`): choosing one draws the page in whatever fallback the browser finds.
- A refused value shows a toast, "{prop} would not take "{value}" — the export refuses declarations CSS cannot parse…" (`properties.js:2667-2680`, `src/core/i18n.js:688`), and the field repaints its old value.

### Visual feedback

| Stage | What is drawn |
|---|---|
| Section open | One row per property, its label with a small icon (`properties.js:3440-3447`); an unset field shows the value in force greyed, with the element it inherits from ("from Page"). |
| Font or Weight popover | Each family or weight drawn in itself, the current one marked `aria-selected`. |
| After a change | The field shows the new value; the canvas redraws the element. The status bar says nothing. |
| Refused value | A toast with the refusal; the field shows its previous value. |

### Undo and redo

Each kept value is one undo step (`catalogue.js:700-706`). A menu browsed with ArrowDown writes one undo step per key press.

### Keyboard equivalent

Tab moves between the fields; Enter keeps a typed value; the number field keys apply in the length fields (inspector-number-fields); ArrowDown and ArrowUp in a closed menu pick the neighbouring value.

### Problems in Pager

1. **The short lists shut values out.** A weight of 450, `text-align: match-parent`, `text-transform: full-width` or a vertical align of `4px` cannot be written: `setProps` refuses anything outside the catalogue's short list (`catalogue.js:690`), and the Weight popover hides even the weight keywords. Required: every text field is one `style.set` door per property (the manifest's `style.set#inspector-*` doors of this feature); in All properties its list offers every value the generated browser data allows plus the presets the manifest declares for it (the font stacks, the named weights 100 to 900 with their names), Essentials only offers the declared subset and never a value All properties lacks, and any value the property takes can also be typed into the field and kept with Enter, a keyword menu included.
2. **The font list offers faces the page never loads**, so the page silently shows a fallback. Required: the font menu lists the system and web-safe stacks of the manifest (`font-family` subset `stacks`), each ending in its generic family; another family can be typed.
3. **Decoration and White space are stored as shorthands** the browsers expand differently from the fields that read them. Required: Decoration is the `text-decoration` composite and White space the `white-space` composite: keeping a value writes every longhand of the composite in one command and one undo step (`text-decoration-line`, `-thickness`, `-style`, `-color`; `white-space-collapse` and `text-wrap-mode`), a longhand the typed value does not name taking its initial value (`underline dotted` writes `underline`, `auto`, `dotted`, `currentcolor`; `nowrap` writes `collapse` and `nowrap`); the document never stores the shorthand.
4. **Line height is free text that cannot say what a bare number means.** Required: a bare number kept in Line height stays a unitless multiplier (`1.5`, drawn as 1.5 times the font size); in every length field a bare number takes px (`18` → `18px`) and a typed unit is kept as typed (`1.25rem`).
5. **Refusals are a toast about the export, and they hide the element and the text.** Required: text the property does not take (`abc` in Size, `1200` in Weight, a white space that is not a keyword) is refused with `status.value.invalid` naming the property's label and the typed text; the document keeps its value and nothing is recorded.
6. **Nothing says what changed.** Required: every kept value is reported by the status bar with the property's label, the element's name and the value as stored (`status.style.set`, e.g. `Font size of Intro: 18px.`). Keeping the value the element already has records nothing.
7. **A locked element's text properties change** (the refusal Pager gives names a move, `src/core/i18n.js:1773`). Required: a locked element, or one inside a locked element, refuses with `status.locked.edit` (spec lock-element) and keeps its values.
8. **Where a property does not apply, its row still stands in the list or vanishes without a word.** Required: a property's field is drawn where its `appliesTo` predicate holds (text overflow on a box that clips its overflow, vertical align on an inline element or a table cell); once the element qualifies (its overflow set to `hidden`, its display set to `inline`) the field is drawn and writes like the others.

### Our rule: the lists (the user's real-use audit, item A3.33)

- A field of a fixed list of values (Display, Font, Font weight, Font style, Case, Cursor) draws a button beside its
  text that opens **every value it offers at once** — the generated list plus its presets — whatever the field holds,
  so a typed value never hides the others, with the value held marked and the list keyboard-reachable (the menu's own
  context). A value the catalogue names (the font weights: "Thin 100" … "Black 900", `value.font-weight.<n>`) reads by
  its name; every other value reads as itself. **Text align** offers the four a text block takes (left, centre, right,
  justified) in Essentials, one row of buttons, and every value the browser data allows in All properties.
- A field whose door declares its Essentials list (`adapter.offers.essentials`: Display's nine of the 22 the browser
  takes) opens with that list first; in All properties the rest wait behind **More values** (Fewer values folds them
  again), in Essentials only the list is all it offers (the audit's S-027: the menu listed 22 raw keywords at once).
  The item checked is the value the element holds, else the one the page computes (no item was checked while the
  element held none).
- A blur that commits a field's text waits one task (`window.setTimeout(…, 0)`): committing inside the press on a
  control of the same field changed the row's layout under the pointer — the reset appears and the field narrows — so
  the release landed on another element and the control's click was swallowed.

## quick-panel

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Heading, Paragraph].

### Trigger

- The quick panel (`#selbar`) appears whenever exactly one element or a group is selected and the stage is at least 40 × 40 px (`src/features/selection/selection.js:203-279`). It is hidden during a drag (`style/08-ui-system.css:837`).
- Fields commit on Enter or blur; Escape restores (`src/features/inspector/quick-panel.js:208-219`). The tag select, the colour buttons and the "Edit on canvas" select commit on change.
- **Grip drag:** press on the `⠿` grip (`data-context-drag`) and move: the panel follows the pointer; the offset from the element is remembered **per element key** for the session (`src/features/windows/index.js:810-835`, `src/features/windows/context-position.js:28-33`). `Escape` during the drag restores the previous offset.

### Hit zones and thresholds

- Default placement (`context-position.js:3-26`): inside the stage minus a 20 px inset, the panel is centred on the element horizontally and tried **above** (12 px gap plus 20 px for the element's chip), then **below**, then **right**, then **left**; the first that fits wins; if none fits it is pinned at the top of the stage. A remembered manual offset is used when it fits and does not cover the element; otherwise the candidate nearest to it is used.
- The panel is limited to the stage width minus 40 px (`selection.js:262-264`).
- The grip drag has no threshold of its own; it moves from the first `pointermove`.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Section selected | A dark floating bar above the element: tag select `section`, grip `⠿`, `⋯` More actions, `W 1392`, `H 151`, `Fill` (colour swatch), and the "Edit on canvas" select. Padding and Margin fields exist but were not visible in the 399 px bar. | ![section](img/quick-panel--01-section-selected.png) |
| After dragging the grip (+300, +250 px) | The bar sits where it was dropped. | ![dragged](img/quick-panel--02-dragged.png) |
| Paragraph selected | Text fields appear: family, Size, weight, alignment, text colour; the Edit text action. | ![paragraph](img/quick-panel--03-paragraph.png) |
| Section at the top of the page | The remembered offset from the drag is reused (bar below the Section at y = 292). | ![top](img/quick-panel--04-top-of-page.png) |

The "Edit on canvas" select kept showing `Shadow offset` after that mode had been left with Escape (observed), so it can show a mode that is not active.

### Result in the document

- Typing `900` in W and Enter wrote `width: 900px` on the Section; status `W set to 900px.` Fields write through the same style writer as the Inspector (`quick-panel.js:354-390`), on the active breakpoint/state layer.
- With several elements selected, fields whose values differ show the placeholder `Mixed` (`:254`, `:433`) and a commit writes to every selected element in one transaction.
- The grip offset is not part of the document.

### Undo and redo

Each committed field is one history entry. Moving the panel is not.

### Nested elements

The panel follows the primary selection.

### Zoom other than 100 %

The panel is window chrome; its placement uses the zoomed element box, its size does not change.

### Keyboard equivalent

The panel's controls have `tabindex="-1"` (sealed out of the Tab order, `quick-panel.js:198`, `:221`, `:230`); there is no keyboard route into it.

### Problems in Pager

1. **The remembered offset is lost on reload** (a `WeakMap` in memory). Required: a dragged quick panel keeps its offset for that element across reloads (manifest feature `quick-panel`), stored with the workspace preferences.
2. **The "Edit on canvas" select shows a stale mode** after the mode ends. Required: the select always shows the active mode, or its neutral label when none is active.
3. **Fields do not fit:** Padding and Margin fields were present but not visible in the bar. Required: every control the panel offers is visible without overlap or clipping.
4. **Not reachable by keyboard.** Required: a shortcut opens and closes the panel from anywhere (Ctrl+Shift+Q; F6 stays the key that moves the focus between regions, `keyboard-panel-navigation`); Tab walks its fields; Escape closes it wherever the focus is inside it and gives the focus back to the canvas (manifest feature `quick-panel`, command `quickPanel.setOpen`).
5. **Controls for unbuilt features must be disabled with "not available yet"** (the manifest intent); Pager has no such distinction. Required: each control reads its availability from the one feature registry.
6. **Several visual properties have no control on the canvas:** Pager's panel offers W, H, Fill (a colour) and font Size, but no text colour, gradient, border, opacity, effects or transform. Required: the quick panel also offers Text colour (text elements), Border, Opacity, Effects and Transform (Move X, Rotate, Scale), and Fill opens the same fill editor as the inspector (solid colour or gradient); every control runs the inspector's command for that property (manifest feature `quick-panel`).
7. **More actions opens a separate strip** of action buttons. Required: More actions opens the element's context menu at the button, the same menu as a right-click (see `context-menu.md`).
10. **The open panel lay over the handles Edit on canvas draws** (a band of a text's left margin under the panel's grip). Required: choosing a mode in Edit on canvas folds the panel to its chip, so the handles it draws are never under it; the chip opens the panel again, the mode still on.
9. **Pinned at the top of the stage when no side held it whole, the panel covered an element near the top, and the handles of Edit on canvas drawn on it** (the canonical frame's tab row took 28 px of the stage). Required: when no side of the element holds the whole panel inside the stage, the panel takes the side where, held inside the stage, it covers the least of the element (on a tie the first of above, below, right and left, so a panel over a wide element stays centred and its side edges keep their handles).
8. **Its bar showed align and distribute always disabled, and its fields a Reset "not available yet" with nothing to reset** (the user's real-use audit, item 1.4: 8 buttons and 19 Resets that looked usable and did nothing). Required: the bar draws an action only while it can act (its door built and its command able to run on the selection; a list of choices, Edit on canvas, while built); a field's Reset is drawn only while the element holds a value of its own (inspector-provenance-reset, Problems in Pager 5).

### Our rule: the fields follow the element kind, and every style door shares one context (the user's real-use audit, items 6.1 and A3.8)

- The panel draws, per element kind: a container's direction, alignment, padding and gap (the layout rule of
  props-element-specific, read from the same context the Style tab reads); a text's typography and colour; an image's
  source, alternative text, object fit and radius; a link's address and new tab; a button's text and its type; the
  transformations in their group. A field of a layout the element is not in is not drawn, exactly as in the Style tab
  (`shownForContext`). An attribute field is drawn for the element kinds the attribute names (elements.json).
- **One context for every door**: the Style tab, the panel, the canvas handles and the Edit-on-canvas modes write to
  the same style target, at the same breakpoint and state. `geometry.resize` (a handle's drag) writes through
  `styleHolders`, so a drag with a class as the target lands in that class's styles, and the panel and the canvas label
  say the context they write in ("Button 24 · .card2 · Hover · Tablet": the element's name and tag, the class target,
  the state and the breakpoint, each when it is not the plain element at Base).

### Our rule: the remembered positions and the history across a reload (the user's real-use audit, item A3.42)

- The offsets a dragged panel leaves (`quickPanelOffsets`, per element) are **pruned of the elements the document no
  longer holds as they are written**: a delete, or another project opened, leaves no entry behind, so the list never
  grows with dead ids.
- **The history does not survive a reload**, and the editor says so: undo steps belong to the session, while the
  document itself comes back from the autosave. Restoring says it in the status bar ("Your work was recovered from the
  last session. Undo starts again from here."), so nobody looks for an undo that is not there. Restoring a version from
  the recovery dialog starts the history again the same way.

### Our rule: the panel's keyboard (the user's real-use audit, item 6.3)

- The panel's open state is the editor's, one command: `quickPanel.setOpen` (`ui.quickPanelOpen`; the chip's own door
  in the panel's region, the global shortcut Ctrl+Shift+Q, and Escape inside the panel; not undoable, and nothing in
  the document changes).
- **Opening it puts the focus in its first field**, so a person types at once and Tab walks its fields; **closing it
  gives the focus back to the canvas** (its chip stands beside the selection's label, in the canvas's key context), so
  Delete and the other canvas keys work again — a scenario proves it by deleting the selection right after Escape.
- **The panel's key context absorbs the fields inside it** (`interactions.json`: `quick-panel` with `absorbsFields`;
  `keymap.ts` `focusChain`): a key of the focus is looked up in the panel's context first and in the field's own after
  it, so Escape closes the panel from any of its fields while Enter keeps what a field holds and the arrows step it.
  No other region absorbs its fields: an inspector field keeps the field's own keys.
- **Closing the panel cancels what a field held unkept**: the panel's fields are drawn with `keepOnLeave={false}`, so a
  value typed and not kept with Enter is dropped when the panel closes, as Escape in an inspector field drops it; the
  inspector's own fields keep the rule that leaving a field keeps what was typed.
11. **The panel's groups were ranges of placement orders in the code** (the audit's U-044: object-fit landed in Settings, the radius in Paint by a magic order). Required: the groups are manifest data — layout.json's `quickPanelGroups` (id and name, in the order the panel draws them) — and each quick panel field names its group (`group`; null for the panel's head: the tag, More actions, Edit on canvas); manifest:check refuses a group the layout does not list and a group that holds no field (rule `quick-panel-group`).
12. **The Effects, Text, Transform and Layout fields had no visible name, and the values read the browser's text** (the audit's U-008: `rgba(0, 0, 0, 0)`, `1 · none · 32px · 700 · normal`). Required: every style field of the panel names itself inside, before its value (the canonical `.qp-f` key): its door's short face label (`faceLabelKey`: Weight, ↕ line height, ↔ letter spacing, Align, Items), else its label (W, H, Opacity, Size, Move X…); a field whose door has an icon (Effects) shows the icon; a colour field in a two-column group shows its swatch as its key. At rest a field shows the inspector's face (a colour's hex or `transparent`, a length's number and unit); focused, its text.
- **The panel was wider than the canonical one and Background image named itself in two words** (jornada03 plan, stage
  5: the canonical anatomy). Required: the panel is the canonical 196 px wide (68 % of the inspector's 288); the
  background image field's key is **Image**; Paint lays its fields two to a line as the canonical panel does (the
  colour's swatch is its key), Padding and Justify take a whole line, a field's Reset sits beside its value. Settings
  keeps one attribute to a line, its label beside it. The bar holds more than the canonical one (the grip, Edit on
  canvas, the close button), so it is two lines: the grip, the element's name and the close button, then the context,
  the tag and the actions.
- **A block could not be laid out from the quick panel** (the dogfooding pass, 2026-09-30: "where are the smart layout tools?"): the panel's Layout group held Direction, Gap, Items and Padding, which apply only to a flex container, and no Display, so a block never showed them; it came last, after Transform. Required: the Layout group comes right after Size and starts with **Display** (`style.set#quick-panel-display`, block, flex, grid… from its values menu); once the element is a flex container its Direction, **Justify** (`style.set#quick-panel-justify-content`, new), Gap and Items follow, and the canvas draws its gap bands. The visual baselines `quick-panel-dark/light` were taken again for this change.
- **Justify showed the last letter of its value** in half a line of the Layout group (the dogfooding pass). Required: the Justify field takes the group's whole line.
- **The chip drew another glyph than the canonical one** (the audit's AUD-28: Lucide's sliders-horizontal, three lines with ticks, where design/final draws two lines with round knobs). Required: the chip draws Lucide's settings-2, the canonical's two sliders.

## radius-border-gap-handles

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > Container (`400 × 220 px`, `padding: 16px`, `display: flex; flex-direction: column`, three Paragraphs), Container selected.

### Trigger

- The quick panel's "Edit on canvas" select offers, after Margin and Padding: **Radius, Border, Gap, Row gap, Column gap, Shadow offset, Shadow blur** (`DIRECT_PROPERTIES`, `src/features/inspector/quick-panel.js:44`, select built at `:416-425`). The three gap options are hidden unless the selection is a container (`:435`).
- **Radius** and **Border** (and Column gap in a column flex, and Row gap in a row flex) show one **direct handle**: a 16 × 16 px round handle with a label (`:68-79`, `:83-85`).
- **Gap** in a row or column flex, and the gap that matches the flow axis (Row gap in a column flex, Column gap in a row flex), switch to **spacing bands** between the children instead (`:420-424`, see `spacing-handles.md`).
- Press on the handle and move at least **4 px** (`:95`); release commits. Release without moving opens a typed field on the handle (`:108`). With the handle focused, ArrowLeft/Down −1, ArrowRight/Up +1, Shift ×10, each press committed at once (`:112`). `Escape` cancels a drag and leaves the mode (`:114`).

### Hit zones and thresholds

| Mode | Handle position | Value change |
|---|---|---|
| Radius | 12 px right of the element's left edge, 10 px below its top (`quick-panel.js:73-74`) | + horizontal movement ÷ zoom (vertical movement is ignored), ≥ 0 |
| Border | horizontal centre, 10 px below the top | + horizontal movement ÷ zoom, ≥ 0; writes `border-style: solid` when the style was `none` (`:61`) |
| Column gap (direct) | 6 px left of the right edge, 10 px above the bottom | + horizontal movement |
| Row gap / Gap (direct, when not the flow axis) | horizontal centre, 10 px above the bottom | + vertical movement |
| Gap bands (flow axis) | a band between each pair of children, as thick as the gap, min 6 px (`src/features/spacing/model.js:36-49`) | + movement along the flow axis ÷ zoom, ≥ 0 |

With Snap on the value snaps to 0, sibling values, ruler steps and grid steps within the snap distance; Ctrl suspends it (`quick-panel.js:98`, `src/features/spacing/handles.js:26-39`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Radius mode | A round 16 px handle near the top-left corner with the label `Radius 0`. | ![radius mode](img/radius-border-gap-handles--01-radius-mode.png) |
| Dragging it (+24, +18 px) | The corners round live; the label reads `Radius 24`. No status message. | ![radius dragging](img/radius-border-gap-handles--02-radius-dragging.png) |
| Border mode, after +6 px | A 6 px solid border on all four sides. | ![border](img/radius-border-gap-handles--03-border-after.png) |
| Gap mode on the column flex | Two 6 px bands between the paragraphs with value chips `0`. | ![gap mode](img/radius-border-gap-handles--04-gap-mode.png) |
| Dragging a gap band down 12 px | The paragraphs spread live; status `Gap 12px`, then `Gap set to 12px.` | ![gap dragging](img/radius-border-gap-handles--05-gap-dragging.png) |

### Result in the document

- Radius +24 → `borderRadius: 24px` (one value for all corners).
- Border +6 → `borderWidth: 6px`, `borderStyle: solid` (all sides).
- Gap band +12 in the column flex → `rowGap: 12px`; the measured distance between the first two paragraphs in the iframe was 12 px.
- The direct-handle writes go to the active breakpoint/state layer (`quick-panel.js:63-67`).

### Undo and redo

One history entry per drag, and one per arrow-key press on a focused handle.

### Nested elements

Only the selected element.

### Zoom other than 100 %

The change is the pointer movement ÷ zoom; the handle keeps 16 screen px.

### Keyboard equivalent

Focus the handle and use the arrows; the Inspector's Border section is the full route.

### Problems in Pager

1. **Radius is changed by sideways movement of a handle placed near a corner,** not by dragging a corner handle inward. Required: Radius mode shows a corner handle labelled with the current radius; dragging it toward the element's centre increases the four corner radii (the `border-radius` composite writes its four longhands in one command), dragging it back decreases them (manifest feature `radius-border-gap-handles`).
2. **Border mode writes all four sides from one handle.** Required: Border mode shows a handle per side; dragging a side writes that side's border width only.
3. **Direct handles write nothing to the status bar.** Required: the live value during the drag and `<Property> set to <value>` at the end, like the spacing bands.
4. **Gap mode writes `row-gap` in a column flex and a direct handle offers `column-gap` there too,** where it has no visible effect. Required: Gap writes `row-gap` and `column-gap` together (the `gap` composite, one command); Row gap and Column gap write their own longhand; options that cannot change the layout (column-gap in a single-column flex) are disabled with the reason.
5. **The gap bands followed one axis** (the user's real-use audit, item 2.1: horizontal bands in a grid of 3 columns). Required: the column gap is drawn as a band between each two columns and the row gap between each two rows, from the children's real boxes, in a grid, a flex that wraps, and a single row or column alike (a grid of 3 columns shows 2 vertical bands).

## rename-element

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `F2` with the canvas focused and exactly one element selected opens a modal prompt (`src/features/input/index.js:814-832`, prompt `win_prompt` `:576-599`).
- Layers: **Rename** in the row context menu replaces the row's name with a text input (`src/features/layers/layers-panel.js:561-581`). **Double-clicking a row does nothing** (observed: no input appeared; no `dblclick` handler on the tree).
- Locked elements are refused (`🔒 <name> is locked …`).

### Hit zones and thresholds

Not a pointer gesture. In the prompt, Enter confirms and Escape cancels (`input/index.js:583-596`). In the inline input, Enter commits, Escape cancels, blur commits (`layers-panel.js:576-580`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| F2 on the Section | A modal dialog titled `Name for this node` with a text field pre-filled and selected (`Section`), and Cancel / Confirm buttons. | ![F2 dialog](img/rename-element--01-f2-dialog.png) |
| Confirm with `Intro` | Status `Renamed to Intro.`; the Layers row and the canvas chip show the new name. | — |
| Layers → Rename | The name in the row becomes a text input with the current name selected. | ![inline](img/rename-element--02-layers-inline.png) |

### Result in the document

- F2 → `Intro`, then inline → `Hero` (observed; the canvas chip read `<section>Hero`).
- An empty name keeps the previous name: F2 writes `trim() || previous` (`input/index.js:830`); inline skips the write when empty (`layers-panel.js:572-574`). Observed: clearing the field and pressing Enter left `Hero`.
- Escape in the inline input restored `Hero` (observed).

### Undo and redo

Each rename is one history entry (`nwRename` inside a transaction).

### Nested elements

Applies to the selected node only.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

`F2`.

### Problems in Pager

1. **Double-clicking a Layers row does not rename.** Required: double-clicking the row's name edits it in place; Enter commits, Escape cancels, blur commits (manifest feature `rename-element`).
2. **Two rename implementations** (modal prompt for F2, inline input for the menu) with different empty-name handling paths. Required: one rename command and one inline edit: F2 edits the selection's name in place in its Layers row, exactly like double-clicking the row name, with no dialog (manifest feature `rename-element`).

## resize-handles

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > Container (`width: 300px; height: 200px`, light background), selected.

### Trigger

- Primary-button press on one of the eight handles drawn on the selection outline (`nw n ne e se s sw w`, `src/features/resize/index.js:45`, `:339-350`), with exactly one element selected that is not locked or hidden (`:102-106`).
- The resize starts after **4 px** of movement (screen px, `:123`); release before that does nothing.
- Modifiers are read on every move (`src/features/drag/drag.js:307-311`): **Shift** keeps the aspect ratio, **Alt** resizes symmetrically, **Ctrl** suspends snapping.
- `Escape`, `pointercancel`, lost capture, window blur, or any document change cancel (`resize/index.js:208-231`).

### Hit zones and thresholds

- Each handle is an 8 × 8 px circle (`--handle: 8px`, `style/02-tokens.css:230`) centred on the corner or edge centre; it is inverse-scaled so it keeps 8 screen px at any zoom (`style/06-canvas-chrome.css:159`). When the element is smaller than 48 px on either axis the outline gets `compact-handles` (`resize/index.js:377`).
- Handles are hidden for multi-selections, locked, hidden or "borrowed" (zero-size) selections (`:372-378`).
- Size change in CSS px = pointer movement in screen px ÷ zoom (`:129-146`, `a.scale`). Measured at 50 %: dragging the E handle 50 screen px to the right changed `width` from 300 px to 400 px.
- Minimum box: 8 px on each axis (`BOX_MIN_PX`, `src/platform/box-geometry.js:5`).
- Snapping (only when Snap is on): edges within the snap distance (default 6 px, times the zoom) of targets jump to them (`box-geometry.js:125-137`, see `snap-while-moving.md`).
- Written values are `width`/`height` in px, corrected for padding and border when `box-sizing` is `content-box` (`resize/index.js:139-147`), and corrected so a flow element's visible edge follows the pointer (`:151-174`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging the E handle 100 px left | The element is previewed live at its new size (temporary inline declarations, never in the document, `:148-149`); the selection outline follows; a label chip next to the pointer reads `Container · 200 × 200` (`src/platform/overlay.js:284`, `:316`). The status bar reads `Coordinates (0, 0)` during the drag. | ![E handle](img/resize-handles--01-e-handle-dragging.png) |
| Released | Status `Resized to 200 × 200.` | ![released](img/resize-handles--02-e-released.png) |
| SE with Shift | Proportional: the label follows the constrained size. | ![Shift](img/resize-handles--03-se-shift.png) |
| W with Alt | Symmetric change (see Result). | ![Alt](img/resize-handles--04-w-alt.png) |
| At 50 % zoom | Same chrome; handles keep 8 screen px. | ![zoom 50](img/resize-handles--05-zoom-50-dragging.png) |

### Result in the document

Observed sequence (all values from the document JSON):

| Gesture | width × height |
|---|---|
| start | 300px × 200px |
| E handle −100 px | 200px × 200px |
| S handle +80 px | 200px × 280px |
| SE handle +60, +30 | 260px × 310px |
| SE handle +60, +10 with Shift | 320px × **381.54px** (aspect kept, fractional px written) |
| W handle −40 px with Alt | 400px × 381.54px (width grew by 80; the left edge stayed where it was because the element is in flow) |
| Escape during an E drag | unchanged; status `Cancelled — nothing changed.` |

Each resize writes only `width` and/or `height` on the active breakpoint and state layer (`:232-251`). Positioned (absolute/fixed) elements also get their offsets rewritten so the opposite edge stays put (`:175-183`).

### Undo and redo

One history entry per resize: Ctrl+Z after the Alt resize restored `320px × 381.54px` (observed).

### Nested elements

Only the selected element is resized; its children reflow.

### Zoom other than 100 %

The CSS change is the pointer movement divided by the zoom (observed at 50 %); handles and label keep their screen size.

### Keyboard equivalent

None for resizing in Pager (the Size fields in the Inspector and quick panel are the typed route).

### Our rule: the dragged edge follows the pointer, and the parent bounds the box (the user's real-use audit, items 4.2 and A3.16)

- **A start-edge drag moves the edge, not the size.** A west or north handle moves the edge the pointer holds and keeps
  the opposite one where it was: a block-level element in the flow compensates with its own margin (a Title 1360 px
  wide shrunk to 1200 on its west handle gets `margin-left: 160px`, and its right edge does not move), a positioned
  element with its left/top, and a shape of an SVG with its geometry attributes. The element keeps its own start edge
  only where the parent lays it out — a flex or a grid item, an inline-level element — and there the handles that carry
  a start edge (north, west, and the corners that include them) are drawn disabled, faint, with the reason on their
  tooltip (`canvas.resize.parentPlaces`, "the parent places this element"); a press on one is not a resize, so what
  lies under it (the element itself) takes the press.
- **The width stops where the space its parent gives it ends** (A3.16): the parent's content box, or, for a grid item,
  the cell its own box touches (the tracks the browser resolved). A card 200 px wide in a three-column grid of 453 px
  tracks dragged east stops at 453 px, whatever the pointer asks. Only the width is bounded: a page grows downwards
  with its content, so a height is never capped.
- **A medium keeps its own ratio by default, and Shift releases it** (A3.16). The ratio is the element's intrinsic one
  where the page knows it (an image's own size), else its box's; a corner drag follows the side the pointer pulled
  further, an edge drag carries the other dimension. Every other element keeps its ratio only while Shift is held, as
  before. The `resize` gesture's modifier is declared once, as `toggle-aspect-ratio` (interactions.json).
- **The label carries the element's own size** (`canvas.measure.size`, `data-chrome="label-size"`), live while a resize
  goes on, and **it never covers a handle** (A3.16): it stands a handle's half above the element's top edge, so the
  north, north-west and north-east handles stay takeable.

The scenarios of this feature say the above: `the-west-handle-moves-the-left-edge-and-keeps-the-right-one`,
`the-north-handle-moves-the-top-edge-and-keeps-the-bottom-one`, `a-north-east-corner-handle-moves-the-top-edge`,
`a-south-west-corner-handle-moves-the-left-edge`, `a-north-west-corner-handle-moves-both-start-edges` and
`the-east-handle-stops-at-the-grid-cells-edge`. The three older scenarios (an edge handle, a top or bottom handle, a
corner handle) keep their own end-edge doors, whose diffs are unchanged.

### Problems in Pager

1. **The status bar shows `Coordinates (0, 0)` while resizing.** Required: the status bar shows the live size `W × H` during the drag and `Resized to W × H` at the end (manifest feature `resize-handles`).
2. **Shift writes fractional pixels** (`381.54px`). Required: resize results are rounded to whole CSS px (the aspect ratio is kept to the nearest pixel).
3. **Alt on a flow element doubles the change on one side instead of resizing around the centre.** Required: Alt resizes symmetrically around the centre; for an element whose left edge cannot move in its flow, the status explains that the change is applied to the width (`Width changed on both sides by N px`), and the preview shows the true result.
4. **The resize modifiers had two readings:** the old `snap-while-moving` entry gave Alt the snap switch while `resize-handles` gave Alt the symmetric resize, so Alt would have meant two things in one gesture (report PG-14). Required, one meaning per modifier: during a resize **Shift** keeps the aspect ratio, **Alt** resizes from the centre, and **Ctrl** suspends snapping for that gesture. The modifiers are declared once, in the `resize` gesture of `manifest/interactions.json`.
5. **Handles are 8 px circles,** hard to hit. Required: handles have the minimum target size given in `DESIGN.md`, and a hover state.
- **The handles covered small elements** (the user's real use, 2026-09-27): at the fit zoom a link measures about 23 × 10 screen pixels, its eight 12 px handles cover all of it, and a press on it resized it instead of dragging it. Required: a handle is drawn only where it has room (interactions.json resize.handleRoom): the top and bottom handles where the element is at least that tall on the screen, the sides where it is that wide, a corner where it is both; a press on the rest of the element drags it.
- **The handles of a selected element covered its neighbour** (the canvas audit of 2026-09-28): with a card selected, its south handle's hit area stood wholly outside its bottom edge — over the card drawn right below it, 23 screen pixels tall — so a press meant to drag that card resized the one above (or cleared the selection), and the neighbour could not be taken at all while the element above stayed selected. Required: a handle's hit area never covers a neighbouring element (a sibling's box); the room the neighbour leaves outside is all the handle keeps, the rest of its square moves inside the selected element, its dot stays on the element's own edge, and a press there still resizes.
- **Only the handle at a side's middle resized** (the dogfooding pass, 2026-09-30): a person narrowing a full-width section took its right edge a quarter of the way down, where the right padding band lies, and wrote `padding-right` instead of the width. Required: each whole side of the one selected element is a resize grip too (doors `handle-resize-edge-n/e/s/w`, the same gesture and writes as the side's handle), `resize.edgeGrip` (6) screen px deep inside its border, over the padding band, under every other control (the handles, a grid item's span grip, a radius dot, an anchor tab); a side's grip is drawn where its handle has room and not on a start edge the parent places; the pointer on it shows the resize cursor and tints the side. The padding band further inside still drags the padding.

## reusable-components

Jornada 03 correction: the shared [nonmodal layer contract](#nonmodal-layers-j8) supersedes the legacy shielding behavior described below.

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager.

### Trigger

- Pager's state can hold `components: Record<name, { tree, group?, variants? }>` (`src/core/state.js:44-49`). A node can name its component (`component`, `state.js:16`).
- Layers flags such a node (`src/features/layers/layers-panel.js:314-318`, "Component of {name}"). The inspector shows a Component chip on it (`src/features/inspector/properties.js:2803`). The provenance names the component a node comes from (`src/model/provenance.js:29-36`).
- Pager has no command that makes a component, places an instance or detaches one. An instance does not follow its component: nothing copies a change of the component into its instances.

### Our rule

#### Data

- A component belongs to the project: the document's `components`, a list in the order they were made. Each has a name, unique in the project, and its definition, a tree of elements like a page's.
- An instance is a real subtree of a page.
  - Its root names its component (`component`: the component's name).
  - Each of its elements records the place of the definition element it comes from (`componentPart`: the child indexes from the definition's root; `[]` for the root).
  - Everything else (rendering, selection, Layers, the export) sees ordinary elements.

#### Commands

- **Create a component** (`components.create`: the context menu's item, the command bar; one element selected).
  - The selected element and its subtree become the definition of a new component, named after the element. A name the project already has a component of takes a number: "CardA 2".
  - The element itself becomes its first instance.
  - One undo step, `status.components.created`.
  - The page root is refused (`status.components.root`). So is an instance, or an element inside one (`status.components.inInstance`), an element that holds an instance (`status.components.holdsInstance`: an instance never lies inside another), and a locked element (`status.locked.edit`).
- **Place a component** (`components.insertInstance`) inserts a new instance of the component.
  - The Insert view shows a tile per component, in a Components group after the element groups (DESIGN.md `insert` 7).
  - The tile's click places it where element.insert places a tile: into the selected container, after a selected leaf, else at the end of the page. The tile's drag places it where it is dropped, as a palette tile's creation drag does.
  - The instance's elements take the definition's elements, each with a new id and a name no other element has.
  - HTML `id` attributes in the new instance take fresh values, and references to targets inside the instance follow its new nodes. The definition keeps the first instance's declared HTML ids.
  - The content model and locks refuse it as they refuse an element (`placementRefusal`). One undo step. The instance becomes the selection.
- **Detach from the component** (`components.detach`: the context menu's item, the command bar; predicate `instanceSelected`, an instance's root selected alone) turns the instance into an ordinary subtree: its elements forget their component and their parts. One undo step, `status.components.detached`.

#### Instances follow their component

- A style write on an element of an instance (every write of `core/style/set.ts`: style.set, spacing, border, filters…) goes to the definition's element and to the same element of every instance of the component, in every page. One undo step. The status bar names the element written.
- A text or an attribute set on an element of an instance stays on that instance: it is its override. A new instance takes the definition's text and attributes.
- An element added inside an instance, or taken out of it, belongs to that instance alone.
- The export writes every instance as plain HTML. The elements of instances that come from the same definition element, and hold the same styles, share one generated class, so the stylesheet writes the component's styles once.

### Refusals

- `status.components.root`: the page root.
- `status.components.inInstance`: an instance, or an element inside one.
- `status.locked.edit`: a locked element, for Create a component.
- `placementRefusal` and `status.locked.insert`, for Place a component; `status.components.inInstance` for an instance placed inside an instance.

### Problems in Pager

1. **No command makes, places or detaches a component.** Components only come from an imported file. Required: the three commands, each through its doors.
2. **Instances do not follow their component.** Nothing copies a change of the component into its nodes. Required: a style write on an instance's element reaches the definition and every instance, one undo step.
3. **An override has no rule.** Pager keeps no difference between what an instance changes and what it takes from its component. Required: a text or an attribute set on an instance stays on it, and a style is the component's.
4. **The export repeats the styles.** Each node gets its own class. Required: the elements of instances share one class per definition element, so the component's styles are written once.

### Undo and redo

- Each command is one undo step.
- A style write that reaches every instance is one undo step.
- Undo restores the document and the selection.

## repeat-element

Our own feature (the dogfooding pass, 2026-09-30: "where are the repeaters?"). Pager had none: a list of cards was
built by duplicating one and then styling every copy again.

### Trigger

- **Repeat (linked copy)** (`components.repeat`): Ctrl+Shift+D, the context menu, Arrange › Repeat, the command bar.
  One selected element.

### Result in the document

- The selected element gains a linked copy right after it in its parent: a new instance of its component (spec
  reusable-components). An element that is not an instance yet first becomes a component, named after it as
  Create a component names one, and its first instance; an instance repeats its own component.
- The new item becomes the selection, so the command run again adds the next one after it ("CardA", "CardA 2",
  "CardA 3"). Wrapping the items in a row or a grid (R, G) lays them out.
- The items share their component's styles: a style written on any of them reaches all of them (and the definition);
  a text or an attribute set on one stays on it, so each item holds its own content.
- The status bar says `{name} repeated: {count} items share its style.`, counting the component's items in that
  parent. Detach from the component makes one item ordinary again.

### Refusals

- The page root (`status.components.root`), an element inside an instance (`status.components.inInstance`), a locked
  element (`status.locked.edit`) or a locked parent (`status.locked.insert`), and a parent whose content model takes
  no second element of that kind (the placement refusals of element.insert).

### Undo and redo

One undo step per run; undo gives back the selection from before.

In the Arrange menu, Repeat stands alone after a separator (layout.json breaks), apart from the grid editor's item.

### Fill from data

- **Fill the selected repeated items with this data** (`components.fillFromData`): the action on the row of a project
  data file in the Explorer (a JSON list, of objects or of lists, or the one list an object holds; or a CSV whose first
  line names the columns; a TSV the same with tabs), drawn as a labelled button (its face says Fill, shown without a
  hover: jornada03 J13) on JSON, CSV and TSV rows only, available while a repeated item (an instance) is selected. The
  Data panel's Fill (spec data-binding) fills from a collection, with each element's field chosen.
- The items are the instances of the selected item's component in its parent, in order; item *n* takes row *n*. Each
  field of an item, in document order — an element that holds text, an image's source — takes the column named like
  the definition element it comes from (any case: a `PlanTitle` column fills every item's title), else the next column
  not taken yet **of its kind**: a column whose every filled cell names an image goes to the images, any other to the
  texts, in the columns' order. A field the row has no value for keeps its own.
- **A sheet as people bring it fills as it is** (jornada03 J1/C4: Carla's `cardapio.csv`, columns nome, preco, foto,
  with photos named `graos.png`, filled the photo column into nothing and the name into the image source, and the whole
  fill failed silently). An image cell names a project file by its path, a project image by its file name (any case,
  with or without the extension: `graos.png` or `graos` for `img/graos.png`), or a web address (`https://…`). A cell
  that names none of these is refused before any change, naming the row, the column and the cell
  (`status.data.imageNotFound`).
- Rows beyond the items add new items after the last one (instances named on from the selected item's name, filled
  with their rows); items beyond the rows keep their content. Texts and sources set this way are each item's own
  (spec reusable-components), so the shared styles stay shared.
- One undo step; the selection stays; the status bar says `Filled {count} items of {name} from {path}.` A file that
  holds no rows is refused (`status.data.unreadable`), and so is a locked parent.
- The scenario's project is the `catalog` fixture: two Plan items and `data/plans.json` with three rows.

## rotation-handle

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

**Pager has no rotation handle.** Rotation exists only as text properties in the inspector: `transform` (placeholder `rotate(2deg)`) and `rotate` (placeholder `6deg`) (`src/features/inspector/catalogue.js:399`, `:402`). The canvas selection shows resize handles only; no canvas code handles rotation (no rotation in `src/features/resize`, `src/features/spacing`, `src/features/selection` or `src/platform/overlay.js`).

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

Pager writes rotation only through the inspector's text fields.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Our rule: four zones, the live angle, and a chrome that turns (the user's real-use audit, item 4.4)

- **One rotation zone outside each of the four corners** (not one handle at the north-east): each is the same door
  (`style.set#handle-rotate`), drawn `--space-4` outside its corner, `--space-6` square, round, with the grabbing
  cursor — a hit area with no circle drawn, the north-east one alone showing the rotate glyph (layout.json's `glyphs.rotate`,
  in the selection colour; the audit's U-015: four white circles swamped a small element) — and held inside the canvas as the
  old single handle was — held *by its turned place*: the zone is round, so
  the element's own rotation moves it along its circle rather than turning it in place, and the clamp applies after
  that move (a wide turned element's corner can lie beyond the canvas, where a CSS turn could not hold it in).
- **The label carries the angle while the element holds a rotation** (`canvas.rotate.angle` = `{angle}°`,
  `data-chrome="label-angle"`): live while a rotate drag goes on, since every move writes the document, and kept
  afterwards. The label itself does not turn (its text stays readable and its chips stay upright).
- **The outline and the handles turn with the element**, about the element's centre: each drawn control carries the
  element's rotation as a transform whose origin is the vector from that control's own corner to the centre
  (`chrome.tsx` `spun`), so the outline, the eight resize handles and the four zones follow the turn at any angle. The
  label keeps clear of the turned controls as it does of the straight ones (`--space-6` + `--space-4`, item 4.2).
- Shift still steps by `rotate.snapStep` (15°) and every drag is one undo step; the status bar names the angle
  ("Rotate of CardA: -90deg.").
- **Known limit, recorded in PROGRESS.md**: a resize of an *already turned* element measures and writes its
  axis-aligned box (the audit asks the chrome to follow the turn, not the resize to work in the turned frame).

### Problems in Pager

1. **No rotation on the canvas.** Required (manifest feature `rotation-handle`):
   - A rotation handle sits outside the selection outline at a fixed screen distance; over it the cursor shows rotation.
   - Dragging it rotates the element around its transform-origin and the angle follows the pointer; Shift snaps to 15° steps; the status bar shows the live angle.
   - The handle and the inspector's Rotate field run the same command and write the `rotate` property, never the `transform` list (manifest property layer: translate, rotate and scale are their own properties); a whole drag is one undo step.
   - The angle does not depend on the zoom; the outline and handles follow the rotated box.

## rulers

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

Rulers are always drawn along the top and left of the canvas unless switched off in Guides & Grids ("Rulers", stored in the `pe-guides-v2` preference; `src/features/precision/index.js:372-377`). They redraw on zoom, scroll, resize and selection change (`src/features/rulers/index.js:425-474`, `src/features/workspace/camera.js:108`).

### Hit zones and thresholds

- Bands: 20 px (`--ruler-size: 20px`): the top ruler spans the canvas width (observed 984 × 20 px at y = 44), the left ruler its height (20 × 754 px at x = 280).
- Units: page CSS px, 0 at the page's top-left corner; negative values to the left of/above the page (observed labels `-625 … 0 … 250` at 40 %).
- Tick step: the smallest of 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000 px whose screen size is at least **6 px**; every 5th tick is major and labelled (`rulers/index.js:35-39`, `:68-71`, `:78-120`). Observed: at 100 % minor ticks every 10 px, labels every 50 px (50 screen px apart); at 40 % minor every 25 px, labels every 125 px (50 screen px apart).
- Pressing on a ruler starts a guide drag (see `guides-manual.md`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| 100 %, Heading selected, pointer over the page | Ticks and labels; the selected element's extent is highlighted on both rulers (`ruler-selection`, observed `left: 108px; width: 1312px` on the top ruler); a pointer marker follows the pointer on each ruler (`ruler-pointer`, `:456-472`). | ![100](img/rulers--01-at-100.png) |
| 40 % | Labels every 125 px; negative labels left of the page. | ![40](img/rulers--02-at-40.png) |

### Result in the document

Rulers never change the document.

### Undo and redo

Not applicable.

### Nested elements

The highlight shows the primary selection's box.

### Zoom other than 100 %

Tick steps adapt so labels stay 50 screen px apart or more (see Hit zones).

### Keyboard equivalent

None.

### Problems in Pager

1. **Label spacing can drop to 30 screen px** (for example at 60 %, where the 10 px step gives 6 screen px ticks and labels every 50 px = 30 screen px). Required: labelled ticks sit on round values (10, 25, 50, 100, 250, 500…) chosen so neighbouring labels are at least 40 screen px apart at any zoom (manifest feature `rulers`).
2. **The pointer markers stay visible in preview** (two blue ticks at the left edge in `preview-mode--01-preview.png`). Required: rulers and their markers are hidden in preview.

## select-click

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 % unless stated) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Primary-button `pointerdown` on an element in the canvas iframe selects it immediately, on the press, not on the click (`src/app/boot.js:449-502`, selection at `:496` through `selectOnly`). The press also arms a move drag (`:497`); if the pointer is released before it moves 4 px, the press stays a plain selection (`src/app/boot.js:527-539`).
- A press on the Page root (the page background) is taken by the marquee listener, which runs first in the capture phase (`src/features/marquee/index.js:63-78`, `:211`). Released without moving 4 px, it selects the Page root (`:147-151`).
- Hover: every `pointermove` over the canvas resolves the element under the pointer and paints the hover outline (`src/app/boot.js:517-523`, `src/features/selection/selection.js:34-62`). The Page root is never hovered (`selection.js:36`).
- `Escape` with focus on the canvas or on a panel clears the selection (`src/features/input/index.js:682-684`).

### Hit zones and thresholds

- The element hit is the deepest element whose box contains the pointer (`src/app/boot.js:465-477`, `pointerInNode` in `src/features/drag/drag.js:1378`). Padding belongs to the element that owns it: a press in a Section's padding, away from its children, selects the Section.
- Empty page area (inside the page, outside every element) selects the Page root.
- The element's selection label (the tag above the outline) and the hover label are also hit targets: they carry `data-handle`/`data-for` and select or drag the element they name (`selection.js:53`, `:241-242`, `boot.js:462-466`).
- Click-versus-drag threshold: 4 px Euclidean distance in screen pixels (`src/core/pointer.js:3`, used at `src/app/boot.js:507`). It does not change with zoom.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Hover | A 2 px outline in the accent ground colour exactly on the element's measured box, and a label chip above its top-left corner reading `<tag> Name` (monospace 11 px, `style/06-canvas-chrome.css:306-315`). When there is no room above the element inside the stage, the chip goes inside the box, 3 px below its top (`selection.js:60`). Hover never changes the selection. | ![hover](img/select-click--01-hover.png) |
| Selected | A 1 px accent outline on the measured box (`style/06-canvas-chrome.css:140`), a tag chip on the outline's top-left reading `<tag> Name` (min 120×24 px, `:153`), eight 8 px round resize handles on corners and edge centres (`:159-175`, `--handle:8px` in `style/02-tokens.css:230`), and a floating quick panel next to the element. The Layers row of the element is highlighted. | ![selected](img/select-click--02-selected.png) |
| Section padding clicked | The same selection chrome on the Section box. | ![section](img/select-click--03-section-padding.png) |
| Empty page clicked | Selection chrome around the whole page; the chip reads `<div> Page`. | ![page](img/select-click--04-page-root.png) |
| Escape | All selection chrome and the quick panel are removed. | ![escape](img/select-click--05-escape.png) |

The status bar facts (breadcrumb, size) update with the selection; the message line does not announce a plain selection.

### Result in the document

Selection is editor state only; the document JSON never changes. Measured in Pager: selecting the paragraph gave the outline `x 388, y 187.19, 1312 × 19.5`, identical to the element's box mapped from the iframe.

### Undo and redo

Selecting is not an undo step. After an undo or redo Pager keeps the selection that the restored document state had (the node ids survive).

### Nested elements

The deepest element under the pointer wins; to reach an ancestor, click its padding, use the breadcrumb, ArrowUp (see `keyboard-tree-walk`), or the Layers panel.

### Zoom other than 100 %

The outline follows the element at any zoom (mapped through the iframe's CSS zoom). The chips and handles are inverse-scaled so they keep their screen size (`--chrome-inv`, `style/06-canvas-chrome.css:159`, `:302`).

### Keyboard equivalent

`Escape` clears. Selecting by keyboard is covered by `keyboard-tree-walk`, `layers-keyboard-navigation` and `select-container-children`.

### Problems in Pager

1. **A click on the dark stage outside the page selects the Page root.** The stage's own handler would clear the selection (`src/features/workspace/dock.js:112-117`), but the marquee capture listener takes the press first (`marquee/index.js:70`) and, on release, selects the Page root. Required: a click outside the page clears the selection; only a click on empty page area selects the Page root.
2. **Selection happens on `pointerdown`.** A press that turns into a drag has already changed the selection, which is what the feature wants, but a press on a multi-selection member collapses the group on release only if no drag started (`boot.js:530-537`). Required: select on press for a single element; for a member of a multi-selection keep the group until release, and only reduce it to that element if no drag started (as Pager does), with the rule written once in the selection owner.
3. **The hover and selection chips cover neighbouring content.** The chip sits above the element's top-left corner and hides the text of the previous sibling (visible in `select-click--02-selected.png`, where the heading text is covered). Required: the chip must not cover the text of other elements while nothing is being dragged; place it outside the element box where there is room (above, else below, else inside), and keep it the same height as the design token for canvas labels.
4. **The Page root's chip reads `<div> Page`,** although the Page renders as `<body>`. Required: the chip shows the real tag of the node that is exported (`<body>` for the Page root).
5. **The Page root shows eight resize handles,** which invite a resize the page does not support. Required: the Page root selection shows the outline and chip but no resize handles.
6. **Where every place around the element covers text, the label still took presses** (jornada03 J16: a button's label
   over a card's price; a press on the price selected and dragged the button). Required: the label covers the least it
   can, and then takes no press — a press there reaches the page under it; the label takes presses (select, drag) only
   where it covers nothing.


The Select tool is the canvas toolbar's first tool (view.selectTool, also V): the editor's ordinary way of working, where a click selects and a drag moves or resizes what is selected. Choosing it puts any other tool away (the Layout tool, the grid edit mode); its button is pressed while no other tool is on.
## select-container-children

How Pager behaves, read from its source and checked by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- Pager has **no keyboard binding** for this: `Ctrl+A` is not in any keymap row or command chord (searched: no `Ctrl+A` in `src/`). Observed: with Paragraph 2 selected on the canvas, `Ctrl+A` changed nothing (selection unchanged, no text selected, no status message).
- The behaviour exists only as a command-bar entry, **Select every element in this container** (`canvas.selectContainerChildren`, `src/features/marquee/index.js:202-206`, with `k:""`). Observed: Ctrl+K, typing `select every`, Enter → the three Paragraphs selected, status `3 elements selected.`

### Hit zones and thresholds

`selectSiblingsOfSelection` (`marquee/index.js:187-196`): the board is the parent of the current selection when that parent is a container; the new selection is every child of it that is neither locked nor hidden. With nothing selected the command is not offered (`when: () => !!state.sel && …`, `:204`).

### Visual feedback

Union outline and chip `N elements`; status `N elements selected.` (`canvas.marquee.took`).

### Result in the document

Selection only; the document JSON never changes.

### Undo and redo

Not an undo step.

### Nested elements

Only the direct children of the selection's parent, never deeper.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No `Ctrl+A` binding.** Required: `Ctrl+A` on the canvas selects the selected element and all its siblings; with nothing selected it selects every child of the Page; while editing text it selects the text and does not change the element selection (manifest feature `select-container-children`).
2. **Locked and hidden siblings are silently skipped.** Required: they are skipped and the status says how many were left out (`3 elements selected, 1 locked left out.`).
3. **With nothing selected the command is not available at all.** Required: it selects every child of the Page.
4. **Ctrl+A on a control outside the canvas selected the whole interface's text** (the audit's AUD-25, 2026-10-02: with the focus on a sidebar button the chord was the browser's own). Required: Ctrl+A in the global key context (a button, the Layers, a toolbar, every context that inherits it: `key-ctrl-a-in-global`) is the same command as on the canvas, so it selects the page's elements and the browser never selects the interface; a field and a text being edited keep their own Ctrl+A (their text).

## semantic-tag-switch

How Pager behaves, read from its source (it was not run for this spec). Source references are `path:line` inside Pager.

### Trigger

- The inspector's **Tag** row (`catalogueProperty({id:"tag",kind:"sel",…})`, `src/features/inspector/catalogue.js:248-249`), in its attributes group: a `<select>` drawn only when the element has more than one equivalent tag (`when: semanticTags(n).length>1`). Its options are the element's equivalent tags (`src/features/inspector/properties.js:3251`, `semanticTags(node)`).
- The quick panel's **Semantic type** select (`src/features/inspector/quick-panel.js:406-413`), with the same options, acting on every selected element.
- No shortcut.

### Result

- The equivalent tags (`semanticTags`, `src/model/tree.js:431-437`): a Button or a Link takes `button` or `a`; a Heading, a Paragraph, a Badge or a Preformatted element takes any of `h1`…`h6`, `p`, `span`, `pre`; a container whose tag is one of `div`, `section`, `header`, `main`, `footer`, `nav`, `aside`, `article` takes any of them. Every other element has its own tag alone and shows no Tag row.
- Choosing an option writes the node's `tag` field (`attrBind("tag")`, `catalogue.js:233-236`); the element keeps its type, name, children, text and styles, and the canvas draws the new tag.
- A tag outside the element's equivalents is refused without saying which rule refused it: the write returns `false` (`catalogue.js:677`) and the toast says only that the value was refused for the property (`properties.js:2666-2671`, `inspector.refused`). The quick panel puts the old value back without a word (`quick-panel.js:409`).
- A locked element, or one inside a locked element, refuses the write (`catalogue.js:674-675`) and the toast names the lock (`cmd.lockedNode`).
- An empty value clears the field (`attrBind`, `catalogue.js:235`), and the node falls back to its type's default tag (`tagOf`, `src/model/tree.js:163-166`); an unknown tag stored in a project is silently replaced by the default the same way.
- Nothing checks where the new tag lands: a container inside a `<footer>` can become a `<header>` (HTML forbids a header or a footer inside a header or a footer, and a `<main>` inside an article, an aside, a nav, a header or a footer), and the page exports invalid HTML.

### Visual feedback

| Stage | What is drawn |
|---|---|
| Element selected | The Tag row shows the current tag in its select. |
| After a switch | The canvas draws the new element (a heading drawn at its new level's size, a `pre` in a monospace font); the select shows the new tag. The status bar says nothing. |
| Refused | A toast with a generic refusal (inspector) or nothing at all (quick panel); the select shows the old tag again. |

### Undo and redo

Each switch is one undo step (`runEditorOperation`, `quick-panel.js:411`); undo gives back the old tag, redo the new one. A refused switch records nothing.

### Keyboard equivalent

Tab to the Tag select, then the arrow keys and Enter, as for any `<select>`.

### Our rule: the switch drops what the new tag cannot hold (the user's real-use audit, A3.7)

- **The attributes the new tag cannot hold go with the switch**, and the status names them in their HTML names
  (`status.tag.setLost`: "Link is <button> now: href left out."). The test is HTML's own: the generated tag table
  (`manifest/generated/html-elements.json`) through the content model's `takesAttribute`; an attribute marked `global`
  in elements.json (id, classes, title, the page's language and direction) is never dropped, and a tag the table lists
  no attributes for (a canvas) is never guessed at. One undo step gives the tag and its attributes back together.
- **The Settings follows the tag**: a field of an attribute the tag does not take is not drawn (after a Link becomes a
  button, no Link address and no Open in a new tab), so no field offers data the element cannot carry.

### Problems in Pager

1. **A heading and a paragraph share one list of tags** (`tree.js:433`): a Heading switched to `span` or `p` stays a Heading in the layers and the inspector while the page draws a paragraph, and a Paragraph switched to `h2` is a heading that says it is a paragraph. Required: an element's equivalent tags are its own tag and the `alternativeTags` of its element type in `elements.json`, and nothing else: `div`, `section`, `header`, `main`, `footer`, `nav`, `aside` and `article` for a container, `h1`…`h6` for a Heading, `p`, `span` and `pre` for a Paragraph. Any other tag is refused with `status.tag.notEquivalent`, which names the tag and the element (`<p> is not an equivalent tag for Title.`); the document keeps its tag and nothing is recorded.
2. **A refused tag is not explained** (a generic toast in the inspector, silence in the quick panel). Required: every refusal is said in the status bar with the rule that refused it (Problems 1, 3 and 4), and the field shows the element's tag again.
3. **Nothing checks where the new tag lands**, so a switch can build HTML the content model forbids. Required: a switch is refused when the new tag may not sit in its parent (the content model's closed lists, `status.refused.onlyAccepts`: a `div` inside a `<dl>` cannot become a `section`), when an ancestor excludes the new tag from its descendants, or when the new tag excludes a tag among the element's descendants (the permitted descendants of `manifest/generated/html-elements.json`: no `header` or `footer` inside a `header` or a `footer`, no `main` inside an `article`, an `aside`, a `nav`, a `header` or a `footer`). The descendant rule is refused with `status.refused.notInside`, which names both tags (`Refused. <footer> cannot sit inside <header>.`); the document keeps its tag and nothing is recorded. The rules live in the content model (`src/core/elements/content-model.ts`), the one owner of which element may sit inside which.
4. **The lock is named, but not which lock** when the element sits inside a locked element. Required: a locked element refuses with `status.locked.edit` (`Unlock Hero before changing it.`); an element inside a locked element refuses with `status.locked.byAncestor`, which names the element and the lock (spec lock-element). The document keeps its tag and nothing is recorded.
5. **An emptied value silently writes the type's default tag**, and an unknown stored tag silently becomes the default. Required: the tag is the element's own and is never guessed: an emptied field changes nothing (the element keeps its tag, nothing is recorded, and the field shows the tag again); a project whose tag is not an equivalent tag of its element is refused when it is opened (document validation).
6. **The switch is a select only**, so a professional who knows the tag cannot type it. Required: the **HTML tag** field of the inspector's Settings tab (`element.setTag#inspector-tag`, drawn as a one-line text field after the text of a text element) takes a typed tag, kept on Enter or when the field loses the focus, and offers the element's equivalent tags as suggestions under it (the list read from `elements.json`, never re-listed in code). The typed tag is taken without the spaces around it and in lower case (`H4` keeps `h4`). A kept tag changes only the node's `tag`: its type, name, children, text, attributes, classes and styles stay, the canvas draws the new element, and the change survives an immediate reload. Each switch that changes the tag is one undo step, undo restoring the tag and the selection; keeping the tag the element already has records nothing. The status bar names the element and its new tag (`status.tag.set`, `Hero is now <article>.`).

## settings-audit

This extends the Inspector, form, class and inline-text specs for audit 7.1 and A3.1, A3.3, A3.5, A3.7, A3.9, A3.25 and A3.39. Pager has no separate Settings tab (`inspector-panel.md`); the existing Builder tab and the audited real-use cases define the interface. The manifest is authoritative for field doors, attribute applicability and section membership.

### Settings layout

Settings shows the manifest's General, Link, Image, Accessibility, SEO and Attributes sections in that order. A section is shown when the selected element has a field assigned to it; Attributes also holds the custom-attribute editor. Every shown section has its description. General identifies the element and its content. Link appears only for links, Image only for images, and SEO only for the page. A link shows General, Link and Attributes. The page's editor-grid controls live in Guides & Grids, not in Settings. A button whose type is not stored displays the HTML default `submit` as a muted default, while the document remains without an explicit type.

A boolean attribute (Open in a new tab, Required, Disabled, Hidden from assistive readers, Autoplay…) is a two-option segmented control, **Off | On**, never a checkbox (jornada02 GENERALISATION 1.3; the canonical has no checkbox): the option the element stores is pressed, a press on the other writes it through the attribute's command in one undo step, and the pair is one Tab stop with the arrows between its options. Every label keeps the shared 100 px column, wrapping to a second line when it is longer.

### Attribute rules

`src/core/elements/attributes.ts` owns validation of a value and its relationship to the selected element. Input type is a closed choice of every HTML input type listed in `elements.json`; a typed value outside it, including `potato`, is refused beside the field and changes nothing. Switching type states which stored attributes it will discard before the person accepts; confirming changes type and removes only inapplicable attributes in one undo step. Number, range, progress, meter, date, time, colour, pattern, autocomplete, name, rows, columns and canvas dimensions are checked against their HTML meaning. The autocomplete value is read token by token against the `autocompleteTokens` list of `elements.json` (the HTML field names, the modifiers `home`, `work`, `mobile`, `fax`, `pager` and the prefixes `shipping`, `billing`, `section`), so `shipping email` is accepted and `banana` refused; the field suggests that same list (item A3.30), one list read by both. A minimum above an existing maximum, an out-of-range value and a malformed BCP 47 page language are refused beside the field. The controls for date/time, colour and range offer suitable native input affordances but dispatch the same manifest door.

Custom attribute names are case-insensitive for validation. A name owned by a dedicated field (`id`, `class`, `style`, `href`, `src`, `title`, `hidden`, `tabindex` and other manifest attributes), `srcdoc`, `contenteditable`, an editor-only `data-*` name, or an `on*` event handler is refused with a reason that names its owner where one exists. URL values use the one address rule of A3.2 when it arrives. The rejected draft belongs to the current node and is cleared on selection change. Until Interactions is built, an event-handler refusal does not direct the person there.

### Element grammar and tag changes

A label accepts phrasing content and at most one labelable control, whether insertion uses click, drag, paste or a structural command. A paragraph aimed inside a label is refused in place with a reason. In a single select, setting one option's Selected clears the former option in the same undo step; the options editor edits the option's text and value. Summary, Legend, table Caption, cells and list items expose their text in Settings. Changing an element's tag warns which incompatible fields will be removed. Link to button removes `href` and `newTab` in the same transaction; Settings immediately follows the new tag and hides Link fields. Undo restores the previous tag and attributes.

### Classes and marked text

The Settings Classes field uses the same project class registry as the Style selector bar. Adding a valid name creates a class definition if absent, and its chip can be selected as a style target. Renaming a class from Styles changes its project definition, every element's class list and the exported CSS together in one undo step. Deleting states its use count, asks for confirmation, removes the definition and its uses, and is undoable. The class picker is an overlay that does not reduce inspector width.

In inline text editing, Ctrl+B and Ctrl+I with no selection toggle marks for subsequent typing. The Settings text field indicates when the content has inline formatting, and editing its plain text preserves the existing marks where their ranges survive. The document's `inline` tree, canvas and export agree.

### Type-specific fields

Settings includes cite on blockquotes; start, reversed and type on ordered lists; Caption text and th scope in tables; accept and multiple for file inputs; cols, maxlength and minlength on textareas; low, high and optimum on meters; title, allow and loading on iframes; playsinline and preload on video. A page's body title is labelled Tooltip to distinguish it from Page title. Empty iframe title is reported by Checks (7.5). Each field renders to its HTML attribute, survives reload and is undoable.

### Problems in Pager and the prior Builder

Pager has no Settings tab or project class controls; Builder's flat field list buried context and omitted these type-specific fields. The audited Builder accepted malformed values, leaked reserved attributes into export, left stale drafts on another selection, kept hidden link data after a tag switch, let labels contain paragraphs, and made formatting shortcuts with an empty selection inert. Each correction above is required, including refusal without document change, one undo step per accepted edit and an exported terminal.

## settings-class-management

This is audit 7.1c (A3.3 and A3.9). It extends `settings-audit.md` and `shared-style-classes.md`. The existing Settings Classes field and the Style selector bar act on the same project registry in `src/core/design/classes.ts`.

### Custom attributes

The Add an attribute name is a draft of the selected element only. A new selection clears it even after a refusal. Names owned by dedicated fields (`style`, `class`, `id`, `href`, `src`, `title`, `hidden`, `tabindex`, `srcdoc`, `contenteditable` and the HTML names of manifest attributes) are refused before any document change. The message beside Attribute name points to the owning field; `style` directs the person to Style. Event handlers remain refused without promising an unavailable Interactions panel. Undo history remains unchanged by any refusal.

### Class application and targets

Typing valid words in Settings Classes replaces the element's class list and creates empty project class definitions for names not already defined, in one undo step. A class applied this way is immediately visible in Styles and its Style chip can be selected as the target. Renaming one project class changes its definition and every use on every page in one undo step; exported selectors and `class` attributes use the new name. A rename to an invalid or taken name is refused. Deleting a class states the number of elements using it in the confirmation, then removes the definition and every use in one undo step. Cancel leaves the project unchanged. A locked use prevents either action. The class picker is an overlay and never changes the inspector's width.

A legacy document may already list a valid class on elements without a project definition (the Aurora example lists `.card`). Clicking such a class chip registers its empty definition in one undo step and selects it as the Style target. Undo removes the new definition. Existing project-class chip clicks remain editor-only changes with no undo entry.

### End artifacts

The document's `classes` list and each element's classes agree after application, rename, delete, undo and immediate reload. The ZIP's HTML and CSS agree with the same names. A selected class target receives a Style edit shared by its users.

### Prior behavior

The audited Settings field wrote only an element's raw class words, leaving no project definition; its chip was inert. Styles listed classes without Rename or Delete. The Add a property draft could follow the next selection, and reserved custom names could leak an inline `style` or duplicate `id` into export. These are the defects this part removes.

## shadow-editor

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test element: a Container 240 × 120 px, white. The editor is `ppShadow` (`src/features/inspector/properties.js:1526-1660`), shown in Effects → Shadow (`data-prop="box-shadow"`).

### Trigger

- **Add a shadow** (shown with `No shadow yet.`) appends a layer `0px 4px 12px 0px rgba(15, 23, 42, 0.24)` and selects it (`properties.js:1550-1554`).
- **Light pad:**
  - Press anywhere in the pad, or on its round handle, and drag: X and Y become the pointer's offset from the pad's centre, in px (`dragTo`, `:1628-1634`; `startLight`, `:1635-1639`).
  - A plain click in the pad jumps the light to that point.
- **Layer rows:**
  - One row per layer: swatch, the values text, an eye (`Hide`/`Show`), `×` (`Remove`) (`:1596-1618`).
  - Clicking a row selects that layer for editing.
- **Fields for the selected layer:**
  - `X`, `Y`, `Blur` (min 0), `Spread`, all number fields with scrub glyphs (`:1557-1569`).
  - The colour field, which opens the colour picker.
  - `Inset`, a toggle button (`:1571-1579`).
- `Reset` in the header removes every layer.
- **Text shadow** is not this editor: `textShadow` is a plain text field in Effects (`properties.js:2404`, `editor: "text"`), where the CSS value is typed by hand.

### Hit zones and thresholds

| What | Value | Source |
|---|---|---|
| Pad | 267 × 102 px | measured |
| Handle | 12 × 12 px | measured |
| Mapping | X = round(pointer x − pad centre x), Y = round(pointer y − pad centre y), 1 screen px = 1 CSS px, **unbounded** | `:1631-1632` |
| Handle drawing | clamped to ±46 px horizontally, ±34 px vertically from the centre | `:1592-1593` |
| Drag start | immediate on pointerdown (`trackGesture(…, true)`) | `:1636` |
| Handle keys | ArrowLeft/Right/Up/Down ±1 px, Shift ±10 px | `:1641-1652` |

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| No shadow | `No shadow yet.` and `Add a shadow`. | ![empty](img/shadow-editor--01-empty.png) |
| Added | The pad with a cross at the centre, a preview square carrying the shadow, the handle at (0, 4); the layer row; X/Y/Blur/Spread; colour and Inset. | ![added](img/shadow-editor--02-added.png) |
| Dragging the light | The handle follows the pointer; the row text, the X/Y fields, the preview square and the canvas update live (observed `20px 12px 12px 0px`). Past ±46/±34 px the handle stays pinned at the edge while the values keep growing (observed `170px 112px`). | ![light](img/shadow-editor--03-dragging-light.png) |
| Two layers | Two rows, the selected one highlighted. | ![two](img/shadow-editor--04-two-layers.png) |
| After hiding the first layer | The hidden layer's row **disappears**; only the other layer is left. | ![hidden](img/shadow-editor--05-first-hidden.png) |

### Result in the document

- `box-shadow` is written as the comma list of the layers in row order (observed: `0px 4px 0px 4px rgba(15, 23, 42, 0.24), 0px 4px 12px 0px rgba(15, 23, 42, 0.24)`); `Inset` prefixes `inset`. The computed `box-shadow` in the iframe matches.
- Blur `-5` + Enter was clamped to `0px` silently.
- **Hide** drops the layer from the written list, and because the editor is rebuilt from the stored value, the hidden layer is lost: its row is gone and it cannot be shown again (observed: after Hide on the first of two rows, one row and one shadow remained).
- Remove on the last layer writes `box-shadow: none`.

### Undo and redo

Each change is one undo step: a light drag (whole gesture), a field commit, Inset, Add, Hide, Remove (observed: after Add + Hide + Remove, two Ctrl+Z brought back first the two layers and then the state before Add; Ctrl+Shift+Z twice re-applied them). Escape during a light drag cancels it (`properties.js:619-621`).

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected (the pad maps screen pixels to CSS pixels regardless of canvas zoom).

### Keyboard equivalent

- With the handle focused, one arrow key moves the light 1 px (Shift 10 px).
- After that first key the Inspector re-renders and **focus jumps to the X field** (observed). The following arrows then act on the X field: ArrowDown decreased X and Shift+ArrowDown decreased X by 10. Y never changed.
- The handle has `tabindex="-1"`, so Tab does not reach it.

### Problems in Pager

1. **Hiding a layer destroys it.** Required: a hidden layer stays in the editor (row shown dimmed with the eye crossed) and in the document JSON, marked hidden; only the CSS leaves it out; Show puts it back in its place (manifest feature `shadow-editor`).
2. **No text-shadow editor.** Required: a Paragraph's text shadow uses the same layered editor (X, Y, blur, colour; no spread or inset) and writes `text-shadow`; the computed `text-shadow` in the iframe matches.
3. **Keyboard on the light pad works for one key only,** because focus jumps to the X field after the first move. Required: focus stays on the handle; arrows move X/Y by 1 px (Shift 10 px) for as long as it is focused.
4. **A text shadow could only be built layer by layer** (the user's real-use audit, item 1.3: typing `0 1px 2px #000` wrote nothing). Required: the text shadow also has a text field, "Text shadow", in the Text section with the rest of the typography, showing its layers as CSS and taking CSS text (`style.setShadows` with the edit `{ css }`): each comma-separated layer's lengths are X, Y and blur (a bare number is px), the rest its colour (currentcolor when none is typed); an emptied field takes every layer away; a text the browser does not take is refused naming what was typed.

### Our rule (the user's real-use audit, item A3.34)

- **A layer's row reads as words.** Each row of a shadow's layers shows the layer's colour as a swatch and what it is in
  one line ("0px, 4px · blur 12px · rgba(15, 23, 42, 0.24)", `inspector.shadow.summary`), never the raw CSS; Inset and
  a hidden layer are said beside it. The row is the handle the layer is dragged by: `style.setShadows` with the edit
  `{ move: { from, to } }` takes the layer at `from` to the place of `to` (both clamped to the layers held), the others
  closing the gap, in one undo step; the output and the export write the new order.
- **Two editors, two titles.** The shadow editors are titled with the property they edit (Box shadow, Text shadow: the
  property's own label), once, before the editor's first control, so two editors one after the other read as two.
- **The controls of a layer are drawn only while the value holds one:** with no shadow the editor shows Add a shadow,
  the Text shadow's CSS field and "No shadow yet." — never a Hide or a Remove for a layer that does not exist.
5. **An empty shadow editor cost three rows** (the audit's S-025): Add a shadow on a row of its own, "No shadow yet." in the label column, and a disabled Remove every shadow. Required: the editor's head is one row — the property's name, "No shadow yet." while it holds no shadow, and Add a shadow as the small + at the row's end (named after its property: "Add a shadow to Box shadow", "… to Text shadow"); the rows of the layers follow it; Remove every shadow is drawn only while there is a shadow to remove, as a layer's own controls are.

## shadow-handles

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: a Container (`400 × 220 px`) with `box-shadow: 4px 4px 8px rgba(0,0,0,.3)`, selected.

### Trigger

- Quick panel "Edit on canvas" → **Shadow offset** or **Shadow blur** (`src/features/inspector/quick-panel.js:44`, `:416-425`).
- One 16 × 16 px direct handle appears at the element's horizontal centre, 10 px above its bottom edge (`:73-76`). Press, move at least 4 px, release to commit (`:86-109`). Release without moving opens a typed field. Arrow keys on the focused handle step by 1 (Shift 10) and commit each press (`:112`). `Escape` cancels and leaves the mode (`:114`).

### Hit zones and thresholds

| Mode | What the movement changes |
|---|---|
| Shadow offset | first shadow's X = start X + horizontal movement ÷ zoom; Y = start Y + vertical movement ÷ zoom (`:54-59`, `:97-99`) |
| Shadow blur | first shadow's blur = start blur + horizontal movement ÷ zoom, ≥ 0 |

Only the **first** shadow layer is edited. When the element has no shadow, a default layer is created from `blankShadowValue()` (observed: `8px 12px 12px 0px rgba(15, 23, 42, 0.24)` after an (8, 8) px drag). With Snap on, the X value snaps (Ctrl suspends).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Shadow offset mode | A round handle at the bottom centre labelled `Shadow offset 4` (only the X value is shown). | ![offset mode](img/shadow-handles--01-offset-mode.png) |
| Dragging (+10, +6 px) | The shadow moves live; the label reads `Shadow offset 14`. No status message. | ![offset dragging](img/shadow-handles--02-offset-dragging.png) |
| Shadow blur, after +12 px | The shadow softens; label `Shadow blur 20`. | ![blur](img/shadow-handles--03-blur-after.png) |

### Result in the document

- Offset drag (+10, +6) → `boxShadow: 14px 10px 8px 0px rgba(0, 0, 0, 0.3)`.
- Blur drag (+12) → `14px 10px 20px 0px …`; then ArrowRight and Shift+ArrowRight on the focused handle → blur `31px`.
- The computed `box-shadow` in the iframe follows the stored value.

### Undo and redo

One history entry per drag; Ctrl+Z after creating a shadow on a shadow-less element removed `boxShadow` entirely (observed).

### Nested elements

Only the selected element.

### Zoom other than 100 %

Movement ÷ zoom; the handle keeps its screen size.

### Keyboard equivalent

Arrow keys on the focused handle; the Inspector's shadow editor is the full route.

### Problems in Pager

1. **The handle does not follow the pointer and its label shows only X.** During the drag the handle stays at the element's bottom centre (observed: same position before and during the drag) while the shadow moves. Required: the handle moves with the pointer during the drag and its label shows `X, Y` for offset and the blur value for blur.
2. **Silent defaults:** starting on an element with no shadow invents `rgba(15, 23, 42, 0.24)` with blur 12. Required: the shadow modes are disabled (with the reason) when the element has no shadow (the manifest intent starts from "a Container with a box shadow").
3. **No status message.** Required: live value during the drag and `Shadow set to <value>` at the end.
4. **Text shadows have no canvas handles.** Required: on a text element with a text shadow, Shadow offset and Shadow blur edit its first text shadow (X, Y and blur) and write `text-shadow`, each drag one undo step (manifest feature `shadow-handles`).

## shared-style-classes

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager.

### Trigger

- Pager keeps class styles in each page's settings, `classStyles: Record<name, styles>` (`src/core/state.js:34`, blank in `src/commands/persist/envelope.js:23`), with their breakpoint and state layers (`bp`, `states`, `bpStates`).
- Pager writes each class as a rule of its own in the canvas and in the export (`src/model/css.js:363-400`). A class name that is not a CSS identifier is left out (`css.js:184`, `authoredClassName`).
- Pager has no control that creates a class, applies one, removes one or edits its styles: `classStyles` only reach a project from an imported file.

### Our rule

#### Data

- A class belongs to the project: the document's `classes`, a list in the order the classes were made, each a name and its styles (the same breakpoints, states and properties as an element's). The list is absent while there is no class.
- An element names its classes in its `classes` list. A name with no class in the project is an author class that holds no styles, as before.

#### Commands

- **Save the styles as a class** (`classes.create`, the selector bar's icon button; one element selected). The button opens a name field; Enter keeps the typed name, Escape closes the field. The name is trimmed. The result:
  - a new class of that name holds the element's own styles, every breakpoint and state;
  - the element holds no style of its own any more;
  - the class is added last to the element's classes.
  One undo step. The page looks the same: the element now takes those values from the class. The status bar says `status.classes.created`.
- **+ Class** (`classes.apply`, the selector bar's text button) opens a list:
  - first, the project's classes that not every selected element has;
  - then a field to type a name;
  - choosing a class, or Enter in the field, runs the command.
  The class is added last to every selected element that does not have it. A name the project has no class of is made a class with no styles, so it can be styled as a target. One undo step. The status bar says `status.classes.applied`.
- **The × of a class chip** (`classes.detach`) removes the class from every selected element that has it. The class stays in the project. One undo step, `status.classes.detached`.
- **The target chips** (`inspector.setStyleTarget`): Element first, then each class every selected element has.
  - Choosing a chip makes it the style target and draws it pressed.
  - A class target holds only while every selected element has the class. A new selection returns the target to Element. So does a class that is detached or undone away.
  - Choosing a chip of a project class changes nothing in the document and records nothing. Audit 7.1c: a legacy applied class with no project definition is registered as an empty project class on its first target click, in one undo step; the target becomes that class immediately. This is the only target click that changes the document.

#### Editing a class

- While a class is the target, every style write of the inspector goes to the class's styles instead of the elements': style.set, the spacing, border, filter, transform, shadow, alignment and colour fields, and Reset. One undo step. Every element with the class changes. The status bar names the class as `.name`.
- The fields show the class's values.
- Below the chips, the selector bar says how far the edit reaches (`inspector.affects.one` / `inspector.affects.other`: ".button-primary affects 3 elements").

#### The element over its classes

- An element's own values override its classes' values. In the canvas and in the export, the class rules come before the element rules, with the same specificity.
- With the Element target, a field whose property the element holds no value of, but one of its classes does, shows the class's value marked as coming from that class (the origin `class` and the class's name). A value of the element's own shows as before.

#### Export

- The stylesheet writes each class that holds styles as one rule, `.name { … }`, in the project's order, after the design tokens' `:root` and before the element rules.
- An element's rule holds only its own values, the overrides. An element with a class and no style of its own gets no generated class of its own: its `class` attribute is its classes alone.

#### Styles view

- The Styles view lists the project's classes, each with the number of elements that have it. Audit 7.1c adds Rename and Delete there: Rename updates the project definition and all uses in one undo step; Delete confirms the use count and removes the definition and every use, also in one undo step. A class's style values are still edited through the selector bar.

### Refusals

- A name that is not a CSS class name (a letter, `_` or `-` first, then letters, digits, `_` and `-`) is refused naming it (`status.classes.badName`), in Save as a class and in + Class.
- Save as a class with a name the project already has a class of is refused (`status.classes.nameTaken`).
- A locked element, or one inside a locked element, refuses every class command that would change it (`status.locked.edit`).

### Problems in Pager

1. **No control creates, applies, removes or edits a class.** Classes only come from an imported file. Required: the four commands above, each through its door in the selector bar.
2. **Classes are kept per page** (`envelope.js:23`, page settings), so the same class on two pages can hold different styles. Required: a class belongs to the project; one definition is used by every page.
3. **A class beats the element's own values.** The class rules are written after the element rules (`css.js:363-400`), with the same specificity. Required: an element's own values override its classes; the class rules come first.
4. **An invalid class name is silently left out of the stylesheet** (`css.js:184`). Required: an invalid name is refused when it is typed, naming it.
5. **Classes are written sorted by name** (`css.js:377`), not in the order the author made them. Required: the project's order.

### Undo and redo

- Each class command is one undo step.
- A style write to a class target is one undo step.
- Undo restores the document as it was, the selection with it.

## shortcuts-e2e-sweep

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Each binding below was pressed with the real keyboard in its context. Source references are `path:line` inside Pager. Test page: Section > [Heading, Paragraph, Container > Paragraph 2].

### Trigger

Pager's bindings live in **several tables**:

| Table | Where | Contexts |
|---|---|---|
| `KEYMAP` (29 rows) | `src/features/input/index.js:660-833` | `drag`, `global`, `hand`, `canvas`, `dock` |
| Command chords (`defineCommand({… keys})`) | `src/features/workspace/dock.js:551-611`, `src/app/boot.js:228` | any focus not in a text field |
| Text editor chords | `src/app/boot.js:695-701` | while editing text in place |
| Guide keys | `src/features/precision/index.js:396-422` | a guide is active |
| Absolute nudge | `src/features/input/index.js` (arrows without Alt on absolutely positioned selections) | canvas |

The Keyboard shortcuts panel is generated from `KEYMAP` only (see `shortcuts-panel.md`), so the chords of the other tables are not listed there.

### Hit zones and thresholds

The sweep, context by context (all observed):

| Context | Keys | Result |
|---|---|---|
| global | Delete, Backspace | selected Paragraph removed; `Removed: Paragraph`; nothing selected |
| global | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | `↶ Undone` restores; `↷ Redone` re-applies |
| global | Ctrl+C then Ctrl+V | `Pasted: Heading 2` (a second Heading) |
| global | Escape | selection cleared |
| global | `?` | status explains the layout: `display is block. The parent lays out as block, …` |
| canvas | Alt+ArrowDown / Alt+ArrowUp | `Moved 1 selected elements within Section.` |
| canvas | ArrowRight / ArrowLeft | next / previous sibling selected (`Paragraph selected. Sibling 2 of 3.`) |
| canvas | ArrowUp / ArrowDown | parent / first child selected |
| canvas | P | `Promoted Paragraph 2 into Section, position 4.` |
| canvas | R / C | `Wrapped Heading in a row. Row selected.` / `… in a column. Column selected.` |
| canvas | Enter | `TEXT Editing plain text — Enter or click away to keep it, Escape to cancel.` |
| canvas | F2 | inline rename (see `rename-element.md`) |
| canvas | M | `Holding Heading. Arrows aim, Enter places, Esc drops. …` |
| hand | ArrowDown / ArrowRight | aim moves: `Position 2 of 3` → `Position 3 of 3` |
| hand | ArrowUp | climbs: `Page will receive. Position 2 of 2. Level 2 of 2.` |
| hand | ArrowLeft | at level 1 nothing changed |
| hand | Enter | `Placed. Heading in Section, position 3 of 3.` |
| hand | Escape | `Dropped. Nothing changed.` |
| drag | ArrowUp / ArrowDown | the level changes (`… · ↑1`, `↑2`, back to `↑1`), but **only after the next pointer move**; with the pointer still, the label stayed `Move to position 4 · Section` |
| drag | Escape | `Cancelled — nothing changed` |
| any | Ctrl+D | `Duplicated: Heading 2` |
| any | Ctrl+B / Ctrl+Alt+B | `Elements / Layers hidden.` / `Inspector hidden.` (inspector 320 → 0 px); again shows them |
| any | Ctrl+\\ | `Every dock collapsed — Ctrl+\ puts back what was open.`; again `The docks are back as they were.` |
| any | Ctrl+= / Ctrl+- / Ctrl+0 | zoom 1 → 1.1 → 1; Ctrl+0 → 100 % |
| any | Ctrl+' | `Layout grid on, 12 columns …` / `… off …` |
| any | Ctrl+K | command bar opens |
| any | Ctrl+P, Ctrl+Enter | preview on (`Preview — interact with the page. Press Esc to return to editing`); Escape leaves it |
| dock | arrows, Enter | see `keyboard-panel-navigation.md` |

### Visual feedback

Each binding's own feedback is described in its feature's spec. The sweep adds none.

### Result in the document

As per binding (above).

### Undo and redo

As per binding.

### Nested elements

The canvas walk keys follow the tree (parent, first child, siblings).

### Zoom other than 100 %

The bindings do not depend on zoom.

### Keyboard equivalent

This is the keyboard feature.

### Problems in Pager

1. **Bindings are spread over several tables, and the shortcuts panel shows only one of them.** So no single list can be swept, and a chord such as Ctrl+D, Ctrl+B or Ctrl+' is invisible in the panel. Required (manifest feature `shortcuts-e2e-sweep`):
   - One keymap table holds every binding.
   - Each row declares its context setup and its check next to its binding, so a sweep test runs every row in its context and checks the document JSON, the selection or the UI state it changes.
   - Rows added later are swept without editing the test.
   - A unit test on the table proves that no two bindings in the same context use the same keys.
2. **The drag level keys act only on the next pointer move** (observed lag). Required: pressing ArrowUp/ArrowDown during a drag updates the proposal and its indicator at once.
3. **Ctrl+Enter enters preview but does not leave it** (see `preview-mode.md`). Required: Ctrl+Enter also leaves preview (manifest feature `preview-mode`), and the sweep checks it.

### Our sweep

The sweep is the manifest's own rules, run every time: every shortcut door runs, with the real keyboard, in at least one
scenario that sets its context up and checks what it changes (`door-coverage`), and no chord is bound twice in one
context (`chord-conflict`). A row added to the keymap is a door, so it is swept without editing any test. The feature's
own scenario, `keys-pressed-one-after-another-run-their-commands-in-their-context`, presses two keys in a row on the
canvas (Alt+ArrowDown, then R); its tooth proof switches the keymap off (`src/editor/input/keymap.ts`).

## shortcuts-panel

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Command bar → `Open Keyboard shortcuts` (observed), or the workbench tab when Developer tools are on. There is no Help → Keyboard shortcuts row (Help lists shortcuts as runnable rows instead; see `app-menu.md`).
- The panel is a workbench (`bench`) tool (`src/features/shortcuts/index.js:51-62`).

### Hit zones and thresholds

The panel is generated from the `KEYMAP` table in `src/features/input/index.js:660-833`, grouped by `when` (`shortcuts/index.js:29-49`). Keys are shown with modifiers (`Ctrl+`, `Shift+`, `Alt+`) and single letters upper-cased.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Panel open | The workbench opens with tabs `Engine read-out` and `Keyboard shortcuts` (selected). Groups with counts: **During a drag** (3), **Anywhere** (8), **With a node in hand** (6), **On the canvas** (11), **On the panel tabs** (3) — 31 rows, e.g. `cancel the drag — Escape`, `raise the receiver level — ArrowUp`, `undo — Ctrl+Z`, `redo — Ctrl+Y`. | ![panel](img/shortcuts-panel--01-open.png) |

### Result in the document

None.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Not applicable.

### Problems in Pager

1. **The panel lists only the `KEYMAP` rows.** Shortcuts declared as commands (`Ctrl+D`, `Ctrl+K`, `Ctrl+B`, `Ctrl+Alt+B`, `Ctrl+\`, `Ctrl+=`, `Ctrl+-`, `Ctrl+0`, `Ctrl+'`, `Ctrl+P`, `Alt+Shift+Arrows`), text-editing keys (`Ctrl+B/I/K`, Enter, Shift+Enter, Escape), guide keys, spacing-band keys and menu keys are missing. Required: one keymap table holds every binding; the panel lists all of them grouped by context (anywhere, on the canvas, while editing text, during a drag, with something in hand, on panels) with keys and a description (manifest feature `shortcuts-panel`).
2. **Descriptions are lower-case developer phrases** ("raise the receiver level") in English only. Required: descriptions come from i18n (English by default, pt-BR available).
3. **No Help → Keyboard shortcuts door.** Required: Help → Keyboard shortcuts opens the panel as a tab in the bottom workbench.

## smart-guides

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. The drag gesture and the snap targets are those of `absolute-free-drag.md` and `snap-while-moving.md`.

### Trigger

- In Pager, "smart guides" are **the snap switch under another name**: the Guides & Grids panel row **Smart guides** ("Alignment and spacing hints") calls the same `gdpSetSmart` as the top bar's Snap menu (`src/features/precision/index.js:115-123`, `:384-391`). There is no way to see alignment hints without snapping, or to snap without them.
- **Equal spacing** is a separate switch in the same panel ("Detect repeated gaps while dragging in Free mode"), stored in `page.snap.equalSpacing` (`:435-442`).

### Hit zones and thresholds

- Alignment: the dragged box's left/centre/right and top/middle/bottom against siblings, parent and page, within the snap distance (default 6 px × zoom) — see `snap-while-moving.md`.
- Equal spacing: for every pair of siblings that overlap by at least 25 % on the other axis, the gap between them is a candidate; the dragged box is pulled so its gap to one of them equals that gap, within 1.5 × the snap distance, only on an axis where no edge snapped (`src/platform/box-geometry.js:57-83`, `:116-120`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Alignment during a free drag | A dashed accent line through the aligned edge (`gd v` / `gd h`), violet when the match is a centre (`style/06-canvas-chrome.css:104-110`); distance markers to the nearest element above and to the left (`src/platform/overlay.js:253-259`). | ![alignment](img/snap-while-moving--01-left-edge-snap.png) |
| Equal spacing | **Nothing is drawn**: the snapped position is applied, but no marker shows the repeated gap (`drag.js:705` computes `eq`; `overlay.js` never draws it). | — |

### Result in the document

The stored `left`/`top` are the snapped values (see `snap-while-moving.md`).

### Undo and redo

Part of the drag; one history entry.

### Nested elements

Siblings only.

### Zoom other than 100 %

Thresholds scale with the zoom.

### Keyboard equivalent

None.

### Problems in Pager

1. **Smart guides and snap are one switch.** Required: the Guides & Grids dialog has a Smart guides toggle under Visibility and an Equal spacing toggle; turning smart guides off removes the alignment lines and equal-spacing markers but does not turn snap off; the snap distance comes from Snap settings (one setting) (manifest feature `smart-guides`).
2. **Equal spacing is invisible.** Required: when the gaps are equal, equal-spacing markers are drawn on both gaps with their value, and with snap on the box snaps to the equal-gap position.
3. **Alignment lines appear only when a snap happened.** Required: alignment lines appear whenever edges or centres align with other elements (within the snap distance), whether or not snap is on.

## snap-toggle-settings

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- Top bar: a **Snap** button labelled `Snap: Off` / `Snap: On` and a chevron; both open the same small menu with **Off**, **On** (radio items) and **Snap settings…** (`src/features/precision/index.js:44-70`). Clicking the button does **not** toggle snap by itself; it opens the menu.
- Snap settings… opens a modal dialog `Snap settings` with nine checkboxes and a distance field, **Cancel** and **Apply** (`:56-65`).
- The Guides & Grids panel's **Smart guides** switch is the same flag (`gdpSetSmart`, `:115-123`, `:384-391`).

### Hit zones and thresholds

- Default: snap **off** (`gdpFlagsDefault.smart = false`, `:77`); the on/off flag is a preference in `localStorage` (`pe-guides-v2`), the targets and distance are stored in the page (`page.snap`, `:107-113`).
- Targets: Page, Parent, Elements, Guides, Rulers, Grid, Centers, Edges, Spacing (`SNAP_TARGETS`, `:26`), all on by default.
- Distance: default **6 px**, range 0-64 px (`:62`, `:110`); it is multiplied by the zoom when compared with screen positions.
- With snap off the radius is −1: no target attracts (`:115`, `MEASURE_LIMITS.SNAP`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Top bar, snap off | `Snap: Off` button with a chevron. | ![off](img/snap-toggle-settings--01-top-bar-off.png) |
| Menu open | `Off` (checked), `On`, `Snap settings…`. | ![menu](img/snap-toggle-settings--02-menu.png) |
| Snap settings dialog | Two columns of checkboxes (Page, Parent, Elements, Guides, Rulers, Grid, Centers, Edges, Spacing), `Snap distance (px)` = 6, Cancel / Apply. | ![dialog](img/snap-toggle-settings--03-settings-dialog.png) |

Choosing On changes the button to `Snap: On` (observed).

### Result in the document

- Apply writes `page.snap = {targets, equalSpacing, distance}` into the project through `editProject` (so it is part of the document and of the history), then turns snap on if the distance is ≥ 0 (`:64`).
- Cancel discards the dialog's changes.
- On/Off is a preference, not document data.

### Undo and redo

Apply is a project edit (undoable); toggling On/Off is not.

### Nested elements

Not applicable.

### Zoom other than 100 %

The distance is in CSS px at 100 % and scales with the zoom on screen.

### Keyboard equivalent

None (the code comment mentions a `G` key, but no binding exists).

### Problems in Pager

1. **The top-bar button does not toggle;** it opens a menu, so switching snap takes two clicks. Required: the button toggles between `Snap: Off` and `Snap: On`; the chevron opens the menu with Snap settings (manifest feature `snap-toggle-settings`).
2. **Apply silently turns snap on.** Required: Apply stores the settings in the preferences store and leaves the on/off state as it was (manifest intent: "Apply stores the settings in preferences").
3. **Snap targets and distance are stored in the page document** while the on/off switch is a preference. Required: all snap settings are workspace preferences, in the one preferences store.
4. **"Smart guides" and "Snap" are one flag under two names.** Required: separate settings, as `smart-guides.md` requires (smart guides can be visible while snap is off and vice versa).

## snap-while-moving

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900, zoom 100 %, Snap: On, default settings) and read from its source. Source references are `path:line` inside Pager. Test document: Section (`position: relative; height: 420px`) with three absolute 120 × 80 px Containers at (60, 40), (300, 200) and (600, 60).

### Trigger

Snapping applies during: free drags of positioned elements (`src/features/drag/drag.js:689-692`), resize handles (`src/features/resize/index.js:129-131`), guide drags (`src/features/rulers/index.js:309`) and property handles/bands (`src/features/spacing/handles.js:26-39`). Snap must be on (`snap-toggle-settings.md`). **Ctrl** suspends it for the gesture (`drag.js:689`, `resize/index.js:130`); **Alt does not** (observed: an Alt drag still snapped to the same ruler target).

### Hit zones and thresholds

- Radius: the snap distance (default **6 px**) × zoom, in screen px (`drag.js:689`).
- Target lists per axis (`src/platform/box-geometry.js:20-40`), each switchable in Snap settings: siblings' edges and centres (Elements, Edges, Centers), the parent's edges and centre (Parent), the page's edges and centre (Page), manual guides (Guides), grid lines (Grid), and **every ruler tick** (Rulers) — the ruler step is the smallest of 1, 2, 5, 10, 25… px whose screen size is ≥ 6 px (`rulers/index.js:35-39`, `:68-72`), i.e. every 10 CSS px at 100 %.
- For a move, the box's left, centre and right (top, middle, bottom) are tested; the nearest target within the radius wins per axis (`box-geometry.js:46-55`, `:108-122`). For a resize, only the dragged edges are tested (`:125-137`).
- Equal spacing: after edge snapping, if an axis did not snap, the box is pulled to repeat a gap between two siblings, within 1.5 × the radius (`box-geometry.js:57-83`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Container 2 dragged so its left edge passes 4 px from Container 1's left edge | The box jumped to a **ruler tick** (x = 66, 2 px away) rather than to Container 1's left edge (4 px away); a dashed vertical line is drawn across the receiver at the snapped x (`gd v ruler`), a dashed horizontal line at a centre alignment (`gd h ctr`, violet for centres, `style/06-canvas-chrome.css:104-110`); distance markers `96px` and `66px` show the gaps to the thing above and to the left. | ![snap](img/snap-while-moving--01-left-edge-snap.png) |

### Result in the document

The stored value is exactly the snapped position: `left: 66px; top: 216px` (observed). With Ctrl held the proposal did not snap (`gx: null`) — and Ctrl also turned the drag into a duplicate (a copy `Container 2` copy was inserted; undone).

### Undo and redo

Snapping is part of the gesture; the gesture is one history entry.

### Nested elements

Targets are the dragged element's siblings, its parent and the page; not cousins.

### Zoom other than 100 %

The radius and the ruler step are recomputed from the zoom, so the snap feels the same in screen px.

### Keyboard equivalent

Nudges never snap.

### Our rule: the line, its colour and its measure (the user's real-use audit, item 4.5, and A1.5)

- **The snap line is 2 px wide** (`--size-snap-line`, a token as the drop line is) **in its own colour**
  (`--color-canvas-snap`, both themes), never the target colour it shared with the column grid. It runs the whole
  alignment: from the moving box to a target with a span, and along the page side for a line that names no box (a
  guide, a column grid line, a ruler tick). It carries its **measure**: the distance the moving box stands from the
  element it aligned with (the snap offset), or the place itself for a guide or a grid line (`snap-line__value`).
- **A resize in flow draws the distances to its neighbours** (`chrome__distance`, the marks the Alt measurement uses):
  from the box being resized to the nearest sibling on each axis the handle drags, live, gone with the release — the
  same numbers Alt shows by hand, drawn by the gesture that needs them (the audit: the distances were a manual
  reading and only for absolute elements).
- **The column grid and its gutters are snap targets** (A1.5): with Snap and the column grid on, a box four page px
  from a column edge snaps onto it and the line of that edge is drawn. A ruler tick nearer than the column wins, as
  the nearest target does; the rulers are a target of their own.

### Problems in Pager

1. **Ruler ticks every 10 px act as snap targets with a 6 px radius,** so almost every position snaps to the 10 px ruler grid and element alignment loses (observed: 2 px to a tick beat 4 px to a sibling edge). Required: only enabled targets snap (manifest feature `snap-while-moving`), and when several enabled targets are within the snap distance, element edges and centres, guides, the parent and the page win over ruler ticks and grid lines; the priority order is one table in the snapping owner.
2. **Ctrl both suspends snapping and duplicates** (report PG-14). Required, one meaning per modifier: holding **Ctrl** suspends snapping for that gesture, when resizing and when moving a positioned element; Ctrl never duplicates. **Alt** keeps its one resize meaning, resizing from the centre, and does not touch snapping. The modifiers are declared once per gesture in `manifest/interactions.json` (`resize`, `free-drag`).
3. **Equal-spacing snaps are applied but never drawn** (the `eq` result is computed, `drag.js:705`, but `overlay.js` has no drawing for it). Required: see `smart-guides.md`.
4. **The snap line spans the receiver only.** Required: the snap line spans from the moving element to the target it snapped to, and the target is named or highlighted, so the person sees why it snapped.

## spacing-handles

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section (`padding: 56px 40px`) > Paragraph, Section selected.

### Trigger

- Choose **Padding** or **Margin** in the quick panel's "Edit on canvas" select (default label `Adjust`; `src/features/inspector/quick-panel.js:416-425`), or press the quick panel's Margin / Padding action buttons (`:392-395`). This turns on a spacing mode (`setSpacingMode`, `src/features/spacing/handles.js:74-75`).
- In a mode, the four sides of the selected element are drawn as bands; primary-button press on a band arms a drag (`handles.js:164-193`), which starts after **4 px** (`:203`).
- Modifiers: **Shift** changes all four sides, **Ctrl/Cmd** changes the side and its opposite, and also suspends snapping (`src/features/spacing/model.js:70-79`, `handles.js:205-207`). **Alt does nothing** (observed).
- A press released without moving opens a typed field on the band (`handles.js:235`, `:273-283`); double-click and Enter on a focused band do the same (`:120-123`).
- `Escape` cancels a drag (`:246-250`); `Escape` outside a drag also closes the quick panel mode (`quick-panel.js:114`).
- Ctrl + hover measurement lines (`initMeasureHover`, `handles.js:370-499`) offer a second door: dragging a container distance line drags that container's padding on that side.

### Hit zones and thresholds

- Padding bands lie inside the border, as thick as the padding on that side and never thinner than **6 px** (`SPACING_MIN_BAND_PX`, `model.js:3`, times the zoom); top and bottom span the full width, left and right fill between them (`model.js:13-22`). Measured on the Section: top band 1392 × 56 px, left band 40 × 20 px.
- Margin bands lie outside the border, as thick as the margin, min 6 px; negative margins are drawn inward (`model.js:23-35`).
- Change = pointer movement along the side's normal ÷ zoom: dragging the top padding band **down** grows it, the bottom band **up** grows it; margins grow outward (`model.js:55-66`). Padding never goes below 0; margins can be negative (`:75`).
- With Snap on, the value snaps within the snap distance to 0, sibling values, ruler steps and grid steps (`handles.js:26-39`).
- The typed field accepts `12`, `12px`, `1.5rem`, `%`, `em`; `auto` for margins; ArrowUp/ArrowDown ±1, Shift ±10 (`model.js:82-98`, `:143-156`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Padding mode on | The bands themselves are not tinted; only a small grey value chip per side is visible (`56`, `40`, `56`; the right one is off screen). Each band has a resize cursor and the tooltip `Padding top: 56px — drag to change; Shift moves all four, Ctrl the opposite pair`. The quick panel select reads `Padding`. | ![padding mode](img/spacing-handles--01-padding-mode.png) |
| Dragging the top band down 20 px | The element re-lays out live; the chip shows the live value; status `Padding 76px 40px 56px`. | ![dragging](img/spacing-handles--02-padding-top-dragging.png) |
| Margin mode, top band dragged up 16 px | Status `Margin 16px 0px 0px`, then `Margin set to 16px 0px 0px.` | ![margin](img/spacing-handles--03-margin-top-dragging.png) |
| Click on a band | In the code this opens a typed field on the band; in the run, a click at the middle of the top band did not leave a field open. | ![click](img/spacing-handles--04-click-opens-field.png) |

### Result in the document

Observed on the Section (`padding: 56px 40px`):

| Gesture | Written |
|---|---|
| top band +20 px | `paddingTop: 76px` (the `padding` shorthand stays) |
| left band +10 px with Alt | `paddingLeft: 50px` only |
| left band +10 px with Ctrl | `paddingLeft: 60px`, `paddingRight: 50px` |
| bottom band −8 px with Shift | all four sides +8: `84px 58px 64px 68px` |
| margin top +16 px | `marginTop: 16px` |

Only the sides that changed are written, as longhands, on the active breakpoint/state layer (`handles.js:209-210`, `:253-269`); status `Padding set to 76px 40px 56px.`

### Undo and redo

One history entry per drag or typed value.

### Nested elements

Only the selected element's own padding and margin; in a flex/grid parent the parent reflows.

### Zoom other than 100 %

Band thickness and the minimum 6 px scale with the zoom; the value change is the pointer movement ÷ zoom.

### Keyboard equivalent

Focus a band (it is focusable) and press Enter to type a value; the Inspector's Space section is the full keyboard route.

### Our rule: the bands without a mode, and the mode that lets go (the user's real-use audit, items 4.1 and A3.15)

- **The bands are drawn on any selected element, with no mode chosen.** Each padding and margin band waits faint
  (opacity 0.06) and comes out while the pointer is on it (0.55), so a side is dragged without opening the quick
  panel; the `spacing-band` gesture's modifiers (Shift, Alt, Ctrl) act on a band the same way whether its mode is on
  or not. Choosing a mode pins its bands (opacity as drawn); Escape on the canvas leaves the mode and its bands stay,
  faint again. A mode is the shortcut the panel offers, never the door that has to be opened first.
- **A gap band is drawn only where there is a gap to edit.** The gap bands (row, column and Gap) are drawn only while
  the element's computed display is flex or grid; on a block container no gap band is drawn and the Edit on canvas menu
  leaves Gap disabled with its own reason, "Gap does not apply to the element" (`canvas.editMode.notApplicable`); a
  shadow mode on an element holding no shadow keeps its reason (`canvas.editMode.nothingToEdit`).
- **Shift adds the same displacement to the four sides.** Each side keeps its own value and takes the travel of the
  drag: a padding of `56px 40px 56px 40px` dragged +14 px on its top band with Shift becomes
  `70px 54px 70px 54px`, in one undo step. The four sides' values are read once, when the band is pressed, so the
  live re-render of the bands cannot count the travel twice. The status names the band the pointer holds and its own
  value ("Padding top of Hero: 70px.").
- **While a mode is on the canvas toolbar reads "Mode: Padding · Esc exits"** (`data-chrome="mode-hint"`), the mode
  named by the same words the menu uses; a drag's own hint takes its place while one goes on.
- **A mode never stays over a selection it cannot edit.** The chrome lets it go, through the manifest's own leaving
  door (the Escape shortcut of `canvas.setEditMode`), when the selection is not one resizable element (none, several,
  the page, a locked or hidden element), when the element takes none of the mode's values (Gap on a block container,
  Shadow blur on an element with no box-shadow), or when a project is opened or created (the selection becomes empty).
  The resize handles a mode hides come back with it, so no one is left without a handle to resize what they selected.

### Problems in Pager

1. **The bands are invisible except for their value chips.** Required: in Padding or Margin mode the four sides are drawn as tinted bands with their values (manifest feature `spacing-handles`), padding and margin in different design-token colours.
2. **The modifiers differ from the manifest intent:** Ctrl changes the opposite pair and Alt does nothing. Required: Alt changes the opposite side by the same amount; Shift changes all four sides.
3. **Ctrl both pairs sides and disables snapping** in the same gesture. Required: one modifier per meaning, declared once in the `spacing-band` gesture of `manifest/interactions.json`: **Shift** changes all four sides, **Alt** changes the opposite side by the same amount, **Ctrl** suspends snapping.
4. **The drag writes longhands next to an existing shorthand** (`padding: 56px 40px` plus `paddingTop: 76px`), so the Inspector and export must resolve two sources. Required: the written result is one coherent value per side: the document stores only the four longhands, never the `padding` or `margin` shorthand, and the band writes its side's longhand.
5. **A click on a band does not reliably open the typed field** (observed: no field after a click in the middle of the top band). Required: a click without drag opens the typed field; Enter commits, Escape cancels.
6. **A thin band's number spilled out of it** (the audit's U-036: numbers drawn in 4 to 6 px bands). Required: a band thinner than `spacing.valueMinBand` (12 screen px) shows its number only while the pointer is over it or the keyboard's focus is on it; a wider band shows it always.
- **The band a drag pulled went faint under the drag** (the dogfooding pass, 2026-09-30): a band no mode pins shows itself only under the pointer, and the pointer leaves it as soon as it moves, so the side being changed and its number vanished while the value changed. Required: the edit handle a drag pulls (a spacing band, a gap, a radius, a shadow handle) stays drawn as taken, with its live value readable, until the drag ends or is cancelled; then it waits again.

## state-styles

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager.

### Trigger

- Pager: a State control sets the state the inspector edits (`setEditState`, `src/features/workspace/camera.js:290-296`); the page is marked with the state (`paper.dataset.uistate`) so the canvas shows it, and a badge reads "Editing Hover" with the selector the values go to (`paintStateBadge`, `:279-289`). Values live per breakpoint and per state (`n.bpStates[bp][state]`, `src/model/style-layers.js:35`), written as `:hover` and so on in the CSS (`src/model/css.js:242`).

### Our rule

- The State menu (`view.setStyleState`) lists the states of properties.json: Base, Hover, Focus, Active, Disabled, Invalid, Placeholder shown; the chosen one checked.
- While a state other than Base is chosen, every style write goes to that state's layer, at the active breakpoint; the base values do not change. A canvas badge reads "Editing Hover" (`canvas.badge.editingState`), and the canvas draws the selected elements with that state's values applied, as if the state held.
- A field shows the value of the chosen state when it has one, else the base value (the origin "state" names where it comes from).
- The export writes each state's values under its pseudo-class (`:hover`, `:focus`…), inside the breakpoint's media query when the state value belongs to one; in the exported page, hovering the element changes its computed style.
- The chosen state is editor state: it goes back to Base at a reload, and records nothing.

### Refusals

As style.set's.

### Problems in Pager

1. **The chosen state is not shown on the canvas for the element alone:** the whole page is marked. Required: the selected elements drawn with the state applied.

### Undo and redo

Each write is one undo step; choosing a state records nothing.

### Our rule: which states an element kind stands on (the user's real-use audit, item A3.36)

- `properties.json`'s `states` name, each, the element ids it stands on (`elements`; null for every element): `hover`,
  `focus`, `focus-visible`, `active`, `first-child`, `last-child`, `before` and `after` stand on any; `visited` on a
  link; `disabled` on input, textarea, select, button, option, optionGroup and fieldset; `invalid` on input, textarea
  and select; `placeholder-shown` on input and textarea. The State menu offers only those of the selected element (an
  h2 or a paragraph lists no Disabled, Invalid, Placeholder shown or Visited) and the validator refuses a stored layer
  of a state its element does not take — so the export and the canvas never carry a rule a browser would ignore
  (`:disabled` in an h2's CSS). `before` and `after` are written as the pseudo-elements they are (`::before`).
- **The canvas says the state being edited**: beside the element's name and tag, the label names it as its selector
  writes it ("Heading 2 · :hover", `chrome__state`, its name in the tooltip), the selection's outline and the label wear
  the state's colour (the canonical .ov-sel.is-state), the badge says "Editing <state>", and the class bar's line names
  the rule the writes land in (".card:hover affects 3 elements").
- **A class target's state shows on the canvas too**: while a state other than Base is edited, the preview stylesheet
  applies the selected nodes' own values of that state *and* those of the classes they wear, after them, as the class
  rules do (maintenance of a class's hover is seen where it lands).
- A class with no value left (its only element lost it) is signalled in the Styles view with its Delete, with A3.9.
- **A state kept for an element that does not take it** (the audit's AUD-03, 2026-10-02): Visited chosen for a link
  stayed chosen while a heading was selected, and the next style write went to a layer the model refuses (in the editor,
  AUD-01's blank window). Required (the user's decision of 2026-10-02, DEC-38): when the selection comes to hold an
  element the edited state does not stand on (after a new selection, or after any command), the editor goes back to Base
  and the status bar says so ("Visited does not apply to Heading: editing Base."); choosing a state the selection does
  not stand on is refused with words ("…: choose a state it takes, or Base."); and every style writer refuses, with the
  same words, a write that would go to a state an element written does not take (the writers through `writeStyle`, the
  ones behind `editableSelection`), so no write reaches a layer the validator refuses. The rule has one owner,
  `stateStandsOn` (`src/core/document/validate.ts`). In the same family: a label's target is set only from a label and
  only to a form control, and a guide is created only at a place on its ruler.

## status-bar

This file covers the interactive parts of the status bar (the breadcrumb and the zoom controls) and what each part shows. Observed by running Pager from `.cache/pager-run` (Chrome, window 1600×900) and read from its source; references are `path:line` inside Pager.

### Trigger

- Clicking an ancestor in the breadcrumb selects it (each crumb is a button calling `select(node)`, `src/features/workspace/shell.js:214-224`, wired in `src/features/workspace/camera.js:57-60`).
- The zoom `−`, `+`, percentage and `Fit` controls (see `zoom-keyboard-buttons.md`).
- Messages are written by commands through the read-out line and mirrored into the status bar (`src/app/boot.js:801-803`).

### Hit zones and thresholds

The status bar is one 26 px line: tag + message on the left (`role="status"`), then the facts: breadcrumb (`#sbPath`), size (`#sbSize`), breakpoint / state (`#sbBp`), node count (`#sbNodes`), zoom controls, save state.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Heading inside Section > Container selected | `ENGINE <last message>` · `Page › Section › Container › Heading` · `1313 × 19` · `Desktop / Base` · `4 nodes` · `− 100% + Fit` · `● Saved`. | ![facts](img/status-bar--01-facts.png) |

Clicking `Section` in the breadcrumb selected the Section; the facts became `Page › Section`, `1393 × 151` (observed). The message tag changes with the source: `ENGINE`, `TEXT`, `CANVAS`, `WORKSPACE`, `GRID`, `GUIDES`, `BREAKPOINTS`, `STATES`, and `REFUSED` for refusals.

### Result in the document

Breadcrumb clicks change only the selection.

### Undo and redo

Not applicable.

### Nested elements

The breadcrumb lists every ancestor of the primary selection.

### Zoom other than 100 %

The zoom percentage is part of the bar.

### Keyboard equivalent

The status bar is a Tab stop (`data-region="status"`), but its breadcrumb buttons are sealed out of the Tab order.

### Problems in Pager

1. **Messages go stale:** the last message stays until another command writes one (e.g. `Text edit cancelled — …` remained while other things happened), with no time or fading. Required: the message line shows the last command's message in an aria-live region and is cleared or replaced when the context changes (manifest feature `status-bar`).
2. **The breadcrumb is not reachable by keyboard.** Required: breadcrumb items are buttons reachable with Tab/arrow keys inside the status region.
3. **The breadcrumb's buttons stood 26 and 28 px tall in the 24 px bar** (the audit's U-038). Required: every control of the bar is as tall as the bar.
- **The element count summed every page** (the dogfooding pass, 2026-09-30): a new, empty page read "20 elements". Required: the count is that of the page on the canvas.
- **A refused change blanked the whole editor** (the audit's AUD-01, 2026-10-02): the status bar named the refused command by its label, "Set {property} to {value}", with none of its values, the text could not be formatted while it was drawn, and nothing caught it, so every region went with it. Required: a command whose label has placeholders also has a name without them (the manifest's `nameKey`, which `manifest:check` requires, rule `command-name`), and a refused or failed change is named by it ("“Set a style” was not applied…"). Required: each region of the editor (top bar, activity bar, sidebar, canvas, right dock, dock, inspector, status bar, the overlays, the preview) stands behind its own error boundary: a region that cannot draw says so in its place ("This part of the editor could not be drawn…"), the incident feed records what it threw, the other regions stay drawn, and it is drawn again at the next change.

## table-commands

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test table: Table > Head > Row > [Header cell, Header cell]; Body > Row > [Cell, Cell], Row > [Cell, Cell]. Inserting **Table** from the palette creates an **empty** `<table>` (observed), so the structure was built cell by cell.

### Trigger

- Two table commands exist, both registered in `src/app/boot.js:222-227` and implemented in `boot.js:300-323`:
  - `selection.addColumn`, labelled by context:
    - from a cell: `add a column after this one, in all N rows`;
    - from the table, a row group or a row: `add a column at the end of all N rows`.
  - `selection.deleteColumn`, `remove this column from all N rows`, available only from a cell.
- **Their only door is the command bar** (`Ctrl+K`, type `column`). They are not in the context menu (whose items are fixed, see `context-menu.md`), not in the selection bar or its `More actions`, and have no key.
- There is **no add-row and no remove-row command**:
  - `create <tr> inside` (the natural-child command, see `natural-child-command.md`) on a Body appends an **empty** `<tr>` with no cells (observed: `Created inside: Row`, `children: []`);
  - Delete on a selected Row removes it (`Removed: Row 3`).

### Hit zones and thresholds

The column index is the selected cell's index in its row + 1 (`boot.js:306`); from a non-cell the column goes to the end. The rows are every row of every row group of the table (`tableRows`). A new cell is `th` in a head row and `td` elsewhere (`cellTypeFor`, `boot.js:308`). A locked row or cell refuses the whole command (`cmd.lockedNode`, `:303-304`, `:316-317`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| A Cell selected, `More actions` open | The selection bar offers no table command. | ![actions](img/table-commands--01-cell-selected-actions.png) |
| Command bar, query `column`, a Cell selected | `add a column after this one, in all 3 rows` and `remove this column from all 3 rows` at the top. | ![command bar](img/table-commands--02-command-bar-column.png) |
| After adding a column after the first cell | The new cells are created **without any style**, so in this table (cells styled 140 px with a border) the new column collapses and is **not visible**; the first cell stays selected. | ![column added](img/table-commands--03-column-added.png) |

### Result in the document

Observed (cells named by key):

| Action | Rows after |
|---|---|
| start | `[th1 th2] [td1 td2] [td3 td4]` |
| add a column after `td1` | `[th1 th3 th2] [td1 td5 td2] [td3 td6 td4]`; status `Column created in 3 row(s)`; `td1` stays selected |
| add a column at the end (Body selected) | `[th1 th3 th2 th4] [td1 td5 td2 td7] [td3 td6 td4 td8]` |
| remove this column (`td2`, index 3) | `[th1 th3 th4] [td1 td5 td7] [td3 td6 td8]`; status `Column 3 removed from 3 row(s)`; the **table** becomes the selection |
| `create <tr> inside` on the Body | a new empty `[]` row |
| Delete on the last Row | the row is removed; status `Removed: Row 3`; nothing selected |

### Undo and redo

Each command is one transaction and one undo step (observed: Ctrl+Z after adding a column restored `[th1 th2] [td1 td2] [td3 td4]` with `↶ Undone`; Ctrl+Shift+Z re-added it).

### Nested elements

Only the rows of the selected cell's own table are touched; a table nested in a cell is a different table (`tableOf` finds the nearest).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

Ctrl+K, type, Enter. No direct keys.

### Problems in Pager

1. **No row commands.** Required: `Add a row after this one` copies the row's cell structure (same count, `th`/`td` per position) with empty cells, and `Remove this row` removes it; each is one undo step (manifest feature `table-commands`).
2. **Table commands are missing from the context menu.** Required: with a cell selected, the context menu offers `Add a column after this one`, `Add a column at the end`, `Remove this column`, `Add a row after this one` and `Remove this row`, running the same commands as the command bar.

## templates-layout

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- The Elements panel's **Templates** group lists `Container <div>`, `Row <div flex>`, `Column <div>`, `Grid <div grid>` (`src/features/palette/index.js:51-53`), followed by the content templates.
- Click a tile: the same insert as any palette click (placement at the selection, see `palette-click-insert.md`).
- Drag a tile: the same palette drag as any element (see `palette-drag-insert.md`); the ghost reads `⠿ Grid`.
- Enter/Space on a focused tile inserts too.
- The trees are built by `PRESET` in `src/model/templates.js:114-121`.

### Hit zones and thresholds

As for palette click and palette drag (4 px drag threshold; same drop zones).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Dragging the Grid tile below a Paragraph | The ghost chip `⠿ Grid`, the receiver (Section) tinted, the insertion line after the Paragraph, and the pill `Move to position 3 · Section · after Paragraph`. | ![drag](img/templates-layout--01-dragging-grid.png) |
| After the drop | The Grid is inserted and selected (outline, `<div> Grid` chip, quick panel). | ![dropped](img/templates-layout--02-grid-dropped.png) |

### Result in the document

Observed (Section selected, one click each):

| Template | Tree inserted (styles in the document JSON) | Status |
|---|---|---|
| Container | `div "Container" {display:flex; flex-direction:column}` > Paragraph `Content` | `Placed. Container in Section, position 1 of 1.` |
| Row | `div "Row" {display:flex; flex-direction:row; gap:16px}` > 2 × `div "Column" {display:flex; flex-direction:column}`, each with a Paragraph `Column 1` / `Column 2` | `Placed. Row in Section, position 2 of 2.` |
| Column | `div "Column 3" {display:flex; flex-direction:column}` > Paragraphs `Block 1`, `Block 2` | `Placed. Column in Section, position 3 of 3.` |
| Grid | `div "Grid" {display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px}`, with `tablet: repeat(2, minmax(0, 1fr))` and `phone: minmax(0, 1fr)` overrides > 3 × `div "Cell" {display:flex; flex-direction:column}` with Paragraphs `1`, `2`, `3` | `Placed. Grid in Section, position 4 of 4.` |

- The template's root is selected after each insert.
- Dragging the Grid below the Paragraph inserted it at position 3 in the Section. The computed `grid-template-columns` in the iframe was `426.656px 426.672px 426.656px`.
- Names are numbered across the page: the Column template became `Column 3` because the Row had already created `Column` and `Column 2`.

### Undo and redo

One insert, one undo step (observed: one Ctrl+Z removed the whole Grid; Ctrl+Shift+Z restored it).

### Nested elements

The template is inserted as one subtree; its inner containers are ordinary nodes afterwards.

### Modal runtime in Preview and export

The Modal template keeps its original `<dialog>` tree in the document. Preview and exported pages load the site script for a page containing it, even with no authored interactions. The script creates an opener beside the dialog using its heading text, opens it with `showModal()`, and closes it from the template's button, native Escape, or a backdrop click. A dialog whose `open` setting was enabled enters modal mode at load. The editing canvas and the saved document are not changed by these runtime actions.

The Tabs template likewise keeps its original two-child tree: a three-button navigation and one authored content container. In Preview and exported pages, the runtime gives the first container a tab-panel role and creates two additional panels whose initial text comes from their tab buttons. Clicking or using Left/Right/Home/End switches the visible panel, updates `aria-selected`, and keeps `aria-controls` and `aria-labelledby` linked through unique runtime IDs. These DOM changes do not alter the document.

### Zoom other than 100 %

As for palette drag.

### Keyboard equivalent

Enter/Space on a focused tile.

### Problems in Pager

1. **Template wrappers and wrap-command wrappers have different styles:**
   - The Row template has `gap: 16px`, the `R` wrapper has none and sometimes adds `align-items: center` (`src/features/input/index.js:801-810`).
   - The template columns are flex columns, the side-drop wrappers are built by other code (`src/features/drag/drag.js:1192-1198`, `:1259-1262`).

   Required: templates and wrap commands take their Row/Column layout styles from the same owner (manifest feature `templates-layout`). Solved by the wrappers of elements.json: `wrappers[].styles` (the row's `column-gap`, the column's `row-gap`) and `wrappers[].childStyles` (the row's children grown alike, `flex-grow:1`) are what every path builds — the R and C keys, a side drop, and the templates' own trees (spec wrap-row-column, Problems in Pager 5; the user's real-use audit, item 3.11).

2. **An element placed in the Grid went after its empty cells** (the audit's AUD-20, 2026-10-02, journey M2: Insert › Grid, then Insert › Card, left a row of three empty dashed cells above the card). Required: an element placed at a grid's end with no place asked for (a palette click with the grid selected) takes the grid's first empty cell — a container holding nothing, untouched (no styles, classes or attributes of its own, neither locked, hidden nor a component's) — in its place, one undo step; a drop at a place keeps that place, and a grid without an empty cell takes the element at its end.

## text-edit-inline

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > [Paragraph, Heading].

### Trigger

- **Double-click** on a text element on the canvas (`dblclick` on the canvas, `src/app/boot.js:731-734`), or two single clicks on the same selected element within **450 ms** (`boot.js:715-729`).
- **Enter** with the canvas focused and exactly one element selected (`src/features/input/index.js:762-764`).
- The quick panel's "edit text" action calls the same door (`provide("editText")`, `boot.js:575`).
- Refused silently (returns false, nothing happens) when the element is not textual, is locked, is part of a multi-selection, or in preview (`boot.js:586-587`). Textual types: the `TEXTUAL` set, `textarea`, and `input` except `file` (`src/features/inspector/catalogue.js:246`).

### Hit zones and thresholds

- The whole element box is the double-click target.
- While editing, the element is `contenteditable="true"` and focused without scrolling the canvas (`boot.js:603`, `:640`); if it is outside the stage it is first scrolled into view (`:592-597`). The caret is placed at the **end** of the text, not where the click landed (`:641-646`).
- Keys while editing are the editor's: the canvas keymap ignores events whose focus is a contenteditable (`keyFocus` → `FOCUS_TEXT`, `input/index.js:465-491`). Observed: Delete, ArrowLeft and `r` changed the text only; the tree was unchanged.
- `Enter` commits (`boot.js:690-694`); `Shift+Enter` inserts a line break character (`insertPlain("\n")`); `Escape` cancels (`:685-687`); **blur** (clicking elsewhere) commits (`:660`).
- Paste inserts `text/plain` only (`:661-665`); dropped text is inserted as plain text (`:666-672`); browser formatting commands other than bold, italic, link and remove-format are blocked (`src/features/text-edit/index.js:10-17`).
- A multi-character `insertText` repeated within 250 ms is ignored (IME/autofill burst guard, `boot.js:673-683`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After double-click | The selection chrome stays exactly as for a selected element (outline, chip, handles, quick panel); the caret blinks at the end of the text. The status bar tag switches to `TEXT` with `Editing plain text — Enter or click away to keep it, Escape to cancel.` | ![editing](img/text-edit-inline--01-editing.png) |
| Enter after typing `Hello world` | Editing ends; status `Text kept.` | ![committed](img/text-edit-inline--02-committed.png) |
| Escape after typing | The text returns to what it was; status `Text edit cancelled — the element is back to what it said.` | ![escaped](img/text-edit-inline--03-escaped.png) |

### Result in the document

- On commit the element's text (and its inline tree when it has marks, see `text-inline-formatting.md`) is written in one transaction, only if it changed (`boot.js:656`, `text-edit/index.js:101-105`).
- Observed: `A freshly created paragraph.` → double-click, Ctrl+A, type `Hello world`, Enter → `text: "Hello world"`. Enter again, type ` more`, Escape → still `Hello world`. Double-click, type ` again`, click the Heading → `Hello world again`, and the Heading becomes the selection.
- Shift+Enter then `line2`, Enter → the stored text was `Hello world againline2`: **the line break was lost** (observed).

### Undo and redo

A committed edit is one history entry; a cancelled edit adds none.

### Nested elements

Only the double-clicked element becomes editable; inline marks inside it stay editable text.

### Zoom other than 100 %

Editing happens in the zoomed iframe; the caret and text scale with the zoom.

### Keyboard equivalent

`Enter` on the selected element starts editing; `Enter` commits, `Escape` cancels.

### Problems in Pager

1. **Shift+Enter loses the line break.** The inserted `\n` is collapsed on read-back (observed `…againline2`). Required: either Shift+Enter stores a real line break that survives commit, render and export, or Shift+Enter is not offered; never a keystroke that silently disappears.
2. **The editing state looks identical to the selected state** (same outline, handles and quick panel), so only the status bar tells the person that typing goes into the text. Required: while editing, the resize handles and quick panel are hidden and the outline uses a distinct editing style from the design tokens. The canvas toolbar says the keys while a text is edited ("Enter or Esc keeps the text · Ctrl+Z takes it back", the canonical toolbar's hint; the canonical's "Esc cancels" is not this editor's behaviour: Escape keeps the edit).
3. **Refusals are silent** (double-click on a locked or multi-selected element does nothing and says nothing). Required: the status bar says why editing did not start.
4. **A text left empty could not be seen nor clicked** (the user's real-use audit, A3.38: a heading whose text was cleared was 0 px tall on the canvas, reachable only through Layers). Required: on the canvas only (never in the document nor the export), a text element whose text is empty keeps canvas.emptyTextMinHeight of height and a dashed outline in its own colour, so it can be seen and clicked; the Layers row says it is empty; the element edited in place drops the mark while it is edited.
5. **Escape threw away what was typed** (the dogfooding pass: a title typed on the canvas and left with Escape, as one leaves an edit in the design tools, was lost). Required — overriding Pager's "Escape cancels" above: Escape leaves the edit keeping the text, as Enter and a click away do (`text.set#key-escape-in-text-editing`), one undo step that Ctrl+Z takes back; a text left as it was says so ("Kept the text of Intro unchanged.", no undo step); the status bar says it while editing ("Enter, Escape or a click away keeps it; Ctrl+Z takes it back."). A field of the Settings tab keeps its own Escape, which puts back the value it held, as every field does.

6. **Spaces typed in a button were dropped** (jornada03 J4: "Conhecer os planos" became "Conhecerosplanos").
   Required: Space in text editing inserts at the caret or replaces the selection without activating the element.
   Buttons, links, and the text children of labels and summaries follow the same rule. Enter and Escape keep the
   text as one undo step. The keymap uses the edited element's own document, including the canvas iframe.

## text-inline-formatting

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test: a Paragraph edited in place (see `text-edit-inline.md`) with the text `one two three four`.

### Trigger

While a text element is being edited, `Ctrl` (or `Cmd`) + `B`, `I`, `K` or `U` is handled by the text editor, `preventDefault` + `stopPropagation`, so no editor shortcut runs (`src/app/boot.js:695-702`, `src/features/text-edit/index.js:61-84`).

| Keys | Effect |
|---|---|
| Ctrl+B | wrap the selected text in `<strong>`; inside an existing `<strong>`, unwrap it |
| Ctrl+I | same with `<em>` |
| Ctrl+K | open the modal prompt `Link address (empty removes the link)` pre-filled with the current link's `href` or `https://`; the answer wraps the selection in `<a href>`, re-addresses an existing link, or (empty / `https://`) removes it |
| Ctrl+U | swallowed: nothing happens (no underline element) |

### Hit zones and thresholds

- The wrap applies to the current text selection inside the element; a collapsed selection does nothing for B/I (`text-edit/index.js:47`).
- "Inside a mark" is decided by the closest ancestor of the selection's common container (`:25-29`, `:44-46`): pressing Ctrl+B with a selection inside a bold word removes the whole `<strong>`, not only the selected part.
- Link addresses pass the URL safety rule: only `http`, `https`, `mailto`, `tel`, `ftp` (`src/model/urls.js:5-7`, `text-edit/index.js:78`). An unsafe address is ignored silently.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| `one` + Ctrl+B, `two` + Ctrl+I | Live in the element: `<strong>one</strong> <em>two</em> three four`. | ![bold italic](img/text-inline-formatting--01-bold-italic.png) |
| `three` + Ctrl+K | A modal dialog over the whole window, titled `Link address (empty removes the link)`, field pre-filled `https://`, Cancel / Confirm. | ![link prompt](img/text-inline-formatting--02-link-prompt.png) |

### Result in the document

Observed step by step (innerHTML of the edited element):

1. Ctrl+B on `one`, Ctrl+I on `two` → `<strong>one</strong> <em>two</em> three four`
2. Ctrl+K on `three`, `https://example.com` → `… <a href="https://example.com">three</a> four`
3. Ctrl+B again inside `one` → the `<strong>` is removed; Ctrl+U → no change
4. Ctrl+K on `four` with `javascript:alert(1)` → no change, no message
5. Pasting `text/html` `<b>RICH</b> <i>x</i>` at the end → inserted as plain `RICH x`
6. Enter → the node stores `text: "one two three fourRICH x"` and `inline: ["one ", {tag:"em", children:["two"]}, " ", {tag:"a", href:"https://example.com", children:["three"]}, " fourRICH x"]`; the export writes `<p …>one <em>two</em> <a href="https://example.com">three</a> fourRICH x</p>`.

The plain `text` is always stored; the `inline` tree is stored only when there is formatting (`text-edit/index.js:101-105`).

### Undo and redo

Formatting is part of the text edit: the whole edit, marks included, is one history entry on commit. There is no undo inside the edit other than the browser's own.

### Nested elements

Marks nest (a `<strong>` inside a link is kept); links are not nested inside links (`src/model/inline-markup.js:27-29`).

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

The shortcuts are the doors; there is no toolbar for marks.

### Problems in Pager

1. **An unsafe link is dropped silently.** Required: the prompt shows an error (`Links must start with http, https, mailto or tel`) and stays open; nothing is written (manifest intent: unsafe URLs such as `javascript:` are refused).
2. **Ctrl+B inside part of a bold run removes the whole run.** Required: toggling a mark applies to the selected range only (splitting the run when needed).
3. **Pasting rich text drops all formatting:** the paste inserts `text/plain` only (`src/app/boot.js:661-665`). Required: pasted content keeps the supported marks (strong, em, and links with safe URLs) and drops everything else, other tags becoming their plain text and scripts removed (manifest feature `text-inline-formatting`).

## theme-switch

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager.

### Trigger

- Pager: the app menu's Theme submenu, Light, Dark and System (`src/features/workspace/dock.js:375-387`), sets the document's colour scheme and stores the choice with the workspace.

### Our rule

- **Theme › Light, Dark, System** (`preferences.setTheme`), radio items, the chosen one checked.
- Light and Dark force the editor chrome's colour tokens (`data-theme` on the document); System follows `prefers-color-scheme`, live, as the browser's scheme changes. The page inside the frame keeps its own colours: the theme is the editor's, never the page's.
- The choice is a preference, restored after a reload; the default is environment.json's.

### Refusals

None.

### Problems in Pager

1. **Choosing System does not follow a later change of the browser's scheme** until a reload. Required: System follows it live (the tokens are declared under `prefers-color-scheme`).

### Undo and redo

Not affected: the theme records nothing.

## timeline-keyframes

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

**Pager has no timeline and no keyframe editor.**

- The workspace mentions a timeline: the bench description "read-out, code, history, timeline" (`src/features/workspace/shell.js:57`), a `timeline` icon (`src/features/workspace/camera.js:349`), and a comment about "Timeline track rows" (`src/features/workspace/dock.js:44`).
- No timeline panel is registered (observed: Ctrl+K `open` lists no Timeline; the workbench tabs are `Engine read-out` and `Keyboard shortcuts`).
- Animation exists only as CSS text: `animation-name` is a free text property with the placeholder `fade-in` (`src/features/inspector/catalogue.js:467`). Pager has no `@keyframes` model; the keyframes have to exist somewhere else.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

Pager stores only the property value (e.g. `animationName: "fade-in"`) on the node.

### Undo and redo

Not applicable in Pager.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager: the timeline is outside the canvas.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No keyframes.** Required (manifest feature `timeline-keyframes`):
   - An animation's keyframes are drawn as diamonds on its track, at their percentage along the track.
   - `Add keyframe` adds one at the playhead.
   - Dragging a diamond along the track changes its offset (the offset follows the pointer as a percentage of the track width, clamped to 0–100 %). The whole drag is one undo step.
   - Each keyframe has its own easing. Deleting a keyframe is one undo step.
2. **The Inspector cannot edit keyframe values.** Required:
   - While the playhead sits on a keyframe, the Inspector edits that keyframe's values (e.g. opacity, Move Y) and not the base styles, and a badge in the Inspector says so.
   - Keyframe offsets, values and per-keyframe easing are stored in the document JSON.
3. **The panel was boxes floating in the dock's padding** (jornada02 pairing 5.6): 28 px transport buttons in frames, a track in a rounded well, two settings to a line squeezed to nothing in the side, an animation's delete spelled out. Required: the canonical anatomy — a 236 px side (the animations, their small trash buttons, the name and the settings one per line with their labels in the 72 px column) beside the track area: a 32 px transport bar of 24 px buttons, the ruler and the lane under it, and a bar for the keyframe's actions.

## timeline-preview

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

**Pager has no timeline, so it has no Play, Pause, Stop, Loop or playhead.** See `timeline-keyframes.md`:

- No timeline panel is registered (observed via Ctrl+K and the workbench tabs).
- Animation exists only as the free text property `animation-name` (`src/features/inspector/catalogue.js:467`).
- An element whose `animation-name` refers to `@keyframes` that exist in the page's CSS would simply run in the iframe with no preview controls.

### Hit zones and thresholds

None in Pager.

### Visual feedback

None in Pager.

### Result in the document

Not applicable.

### Undo and redo

Not applicable: previewing is not an edit.

### Nested elements

Not applicable in Pager.

### Zoom other than 100 %

Not applicable in Pager.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **No preview controls.** Required (manifest feature `timeline-preview`):
   - `Play` animates the element on the canvas from the stored keyframes.
   - `Pause` freezes it at the current time.
   - `Stop` returns it to its base styles.
   - With `Loop` on, playing repeats.
2. **No scrubbing.** Required:
   - Dragging the playhead along the timeline shows the interpolated state at the playhead on the canvas.
   - At 50 % of a linear 0-to-1 opacity animation, the computed opacity in the iframe is 0.5.
3. Previewing (play, pause, stop, loop, scrub) never changes the document JSON and never adds an undo step.

## ui-language

How Pager behaves, read from its source and observed by running it from `.cache/pager-run` (Chrome, window 1600×900). Source references are `path:line` inside Pager.

### Trigger

- Pager has two catalogues in one module, English and `pt-BR` (`src/core/i18n.js`, the `LOCALES` table; the names `locale.name.en` "English" and `locale.name.pt-BR` "Portuguese (Brazil)", `:2776-2777`), and a switch, `setLocale(next)` (`:2789-2798`), which refuses an unknown locale and tells its subscribers (`onLocaleChange`, `:2786-2787`).
- **Nothing calls `setLocale`**: no menu item, button, command or key reaches it (the only occurrence of the name outside its definition is the command bar hint `command.hint.locale`, `:1352`). Observed: the app menu (File, Edit, Arrange, View, Help, Theme) has no language entry; every text shows in English, always.

### Result

- The active locale lives in a module variable (`activeLocale`, `:2781`), set to "en" at load and never stored: even if a switch existed, a reload would come back in English.
- Numbers and dates have one formatter each per locale (`formatNumber`, `formatDate`, `:2805-2826`); plural forms follow `Intl.PluralRules` (`pluralFormOf`, `:2834-2837`).

### Keyboard equivalent

None.

### Problems in Pager

1. **The Portuguese catalogue cannot be reached.** Required: View › Language and the status bar's language button offer English and Português (Brasil) (`preferences.setLanguage`, one door per language); choosing one re-renders every text of the editor at once, without a reload: menus, panels, tooltips, accessible names and the status bar's messages, which are written in the language shown when they are written.
2. **The choice is not stored.** Required: the language is kept in the preferences (the one preferences store, `src/editor/preferences/preferences.ts`) and restored after a reload; a fresh profile shows English.
3. **Nothing proves the two catalogues agree.** Required: a unit test proves that `en.json` and `pt-BR.json` have the same keys and, for every key, the same placeholders; a key missing from a catalogue throws, never falls back to another language.
4. **The page's own language is not the editor's.** Required: switching the editor's language never changes the page being edited (its content and the document's language settings are user content).
5. **Copy fits and agrees in both languages (J28, STG-5.17).** A warning about wrapping elements describes its visible effect in plain words, without a technical wrapper noun. Portuguese reset messages name the value of a property so the sentence does not guess the property's gender. Counts displayed as labels before their numbers do not imply a plural noun after `1`. The top bar says `Export ZIP` / `Exportar ZIP`, fitting at 1280 px without clipping. The catalogues own every phrase; the browser-language and wrap flows verify their rendered text.
6. **Count-bearing messages use complete locale forms.** When a message has a numeric `count`, its catalogue's `.one` form is used for one and the base form for zero or another number; the existing locale plural rules decide the form. A count that is itself a localized noun (`1 linha`, `2 linhas`, `1 página`) makes the outer message use the same form, so its adjective and verb agree with the noun. A catalogue entry without a `.one` form keeps its base text. The status, Styles, Layout, motion and data messages that can describe one item carry both English and Brazilian Portuguese forms; zero stays plural.

## undo-redo

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

| Input | Where it works | Source |
|---|---|---|
| `Ctrl+Z` (also `Cmd+Z`) | anywhere except while typing in a text field or a contenteditable (focus "chrome" or canvas) | `src/features/input/index.js:669-670` |
| `Ctrl+Shift+Z` | same | `:671-672` |
| `Ctrl+Y` | same | `:673-674` |
| Top bar Undo / Redo buttons (`#bU`, `#bR`) | click | `src/app/boot.js:355-358` |
| Edit menu Undo / Redo | click | `src/features/workspace/dock.js:401-403` |

All five doors call the same two functions, `historyBack` and `historyForward` (`src/commands/transactions.js:150-157`). While a pointer drag is live, keys go to the drag instead (`boot.js:548-554`).

### Hit zones and thresholds

- History granularity: one entry per transaction. A transaction whose document is unchanged at the end is dropped (`transactions.js:161-169`), so no-op commands never create entries.
- Depth: at most **80** undo entries; the oldest is dropped (`transactions.js:210`).
- Any new command empties the redo stack (`transactions.js:210`, `REDO=[]`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After three undos | The document returns step by step; the status bar reads `↶ Undone` each time; both buttons are enabled while each stack has entries (`boot.js:351-353` disables a button whose stack is empty). | ![after undos](img/undo-redo--01-after-three-undos.png) |
| New command after an undo | Redo becomes disabled. | ![redo cleared](img/undo-redo--02-redo-cleared.png) |

Redo shows `↷ Redone`. There is no preview of what will be undone (the buttons' tooltips name only the action).

### Result in the document

Observed with a Section and three palette inserts (Heading, Paragraph, Badge):

| Key | Tree after | Selection after |
|---|---|---|
| (start) | Section > Heading, Paragraph, Badge | Badge |
| Ctrl+Z | Heading, Paragraph | Paragraph |
| Ctrl+Z | Heading | Heading |
| Ctrl+Z | (empty Section) | Section |
| Ctrl+Shift+Z | Heading | Heading |
| Ctrl+Shift+Z | Heading, Paragraph | Paragraph |
| Ctrl+Y | Heading, Paragraph, Badge | **Heading** (see Problems) |
| Ctrl+Z, then insert Divider | Heading, Paragraph, Divider; redo disabled | Divider |

Each state is restored exactly (same node ids), because an entry is a full snapshot (`historyUnit`, loaded with `restoreSnapshotSelection`, `transactions.js:150-157`).

### Undo and redo

This feature is the history itself.

### Nested elements

Snapshots cover the whole project, so nested changes restore exactly.

### Zoom other than 100 %

Zoom and scroll are not part of the history.

### Keyboard equivalent

The shortcuts above.

### Problems in Pager

1. **Redo restores the selection that existed when Undo was pressed,** not the one that belonged to that document state: after inserting Badge (Badge selected), selecting the Heading and pressing Ctrl+Z three times then redo three times, the final state showed Badge in the tree but the Heading selected. The undo entry saves the current selection at the moment it is pushed (`transactions.js:152`). Required: every history entry stores the selection that belongs to its document state; undo restores the selection before the command, redo the selection after it (manifest feature `undo-redo`).
2. **The status text carries arrow glyphs (`↶ Undone`, `↷ Redone`).** Required: no glyphs; the status says Undone or Redone with what it undid or redid (Problems in Pager 3), through i18n.
3. **"Undone" says nothing of what was undone** (the user's real-use audit, item 1.5). Required: the status names it, `Undone: Height of Hero: 900px.` / `Redone: …` (`Desfeito: …` / `Refeito: …` in Portuguese): the action is the status message the undone step's command gave (a gesture's: its last), else "the last change"; a step merged from several commands names the latest.

## unsaved-work-guard

Jornada 03 J23: an unconfirmed canvas or value-field draft also activates the browser's leave-page warning, even when the confirmed document is saved. Its text is journaled during editing, independently of whether the browser sends a departure event; the guard only flushes the latest caret position as an additional safeguard.

Read from Pager's source (`reference/Pager`); references are `path:line` inside Pager. Our autosave is `autosave-restore.md`.

### Trigger

- Pager writes the project after a delay (`docAutosave`, `src/features/documents/index.js:296-305`), and flushes what is pending on `pagehide` and on `visibilitychange` to hidden (`:342-343`).
- While something is not written (`docDirty`), `beforeunload` asks the browser for its leave-page confirmation (`:344`).
- A failed write shows "Save failed" and tries again after the delay (`:279-293`).

### Our rule

- Every committed change is written at once: first to the journal in localStorage, which a write finishes before the page can unload, then to IndexedDB (`src/editor/persistence/autosave.ts`). An immediate reload after a change finds it.
- While a change is not in IndexedDB yet (the status bar reads Saving…), or a write failed (Not saved), closing or reloading the tab triggers the browser's leave-page confirmation. Once the status reads Saved, nothing asks.
- A write IndexedDB refuses leaves the status bar reading **Not saved**, with the reason (`status.save.notSaved`), and the change kept in memory and in the journal. The next change writes again, and so does a retry after `autosave.retryDelay`; a success reads Saved.
- Hiding the tab (visibilitychange) or leaving it (pagehide) writes what is pending at once.
- The top bar shows the same state left of Preview, as the canonical bar does (jornada03 plan, stage 5): a dot in the
  state's colour (Saved green, Saving muted, Not saved amber) and its words; the reason a write failed stays in the
  status bar's label.

### Refusals

None: the guard asks the browser, never the person through a dialog of ours.

### Problems in Pager

1. **The first edits wait for a delay before anything is written,** so a reload right after an edit loses it unless `pagehide` happens to finish its asynchronous write. Required: the journal is written synchronously with the change; the reload finds it.
2. **"Save failed" gives no reason.** Required: Not saved says why (the browser's refusal: quota, blocked storage). The editor's own reason (no IndexedDB at all) is a message of the catalogue, said in the editor's language like the sentence around it (the audit's AUD-24: "Não salvo: IndexedDB is not available"); only the browser's own words stay as the browser gives them.
3. **A failure that never repeats leaves the work unsaved in silence.** Required: a failed write is retried on its own after a delay, and on the next change.

### Undo and redo

Not affected: saving records nothing.

## unwrap

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Test document: Section > Container > [Heading, Paragraph].

### Trigger

- Only one door: the **Remove wrapper** button in the selection bar's "More actions" group (`data-act="unwrap"`, `src/features/selection/selection.js:129`, handler `unwrapNode`, `src/app/boot.js:192-217`).
- There is no shortcut, no context-menu item and no menu entry for it.

### Hit zones and thresholds

- The button is **hidden** (not disabled) unless exactly one element is selected, it is a container, it has a parent and it has at least one child (`selection.js:258-259`). Observed: hidden for the Page root and for a Heading.
- Refused, document unchanged, when (`boot.js:193-208`):
  - the wrapper has no children — `Cannot remove <name>. it has no children to lift.`;
  - the parent or a child is locked or hidden — the lock/hidden message;
  - a lifted child would break the nesting rules in the parent — `Cannot remove <name>. Refused. <child> cannot go in <parent>.`

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Container selected, More actions (`⋯`) open | A second strip of 12 icon-only buttons below the quick panel; the unwrap icon is the sixth. The strip's lower row shows overlapping text ("Margin", "Padding", "More…" drawn on top of each other). | ![more actions](img/unwrap--01-more-actions.png) |
| After Remove wrapper | The Container is gone; the Heading and Paragraph sit in the Section at its old index; **both are selected** (multi-selection, chip `2 elements`); status `Moved 2 children out of Container into Section.` | ![after](img/unwrap--02-after-unwrap.png) |

### Result in the document

`Section > Container > [Heading, Paragraph]` → `Section > [Heading, Paragraph]`, children in their original order, same ids, at the Container's former index (`boot.js:209-213`). The wrapper's own styles are discarded.

### Undo and redo

One history entry: Ctrl+Z restored `Section > Container > [Heading, Paragraph]` with the Container selected (observed).

### Nested elements

Only the direct children are lifted, one level.

### Zoom other than 100 %

Not affected.

### Keyboard equivalent

None in Pager.

### Problems in Pager

1. **Remove wrapper is only reachable through the selection bar's icon strip.** Required: a context-menu item "Remove wrapper" and an Arrange menu item, running the same command (manifest feature `unwrap`, `context-menu`, `app-menu`).
2. **The button is hidden rather than disabled when the command cannot apply,** so the strip changes layout depending on the selection. Required: one place keeps the item where the person looks for it with its reason: the Arrange menu draws Remove wrapper disabled, with the reason in its tooltip, for the Page root and for elements without children; the context menu, which draws only what applies (`context-menu`, item 2), leaves it out there.
3. **The More actions strip overlaps its own text** (the "Margin", "Padding" and "More…" labels are drawn on top of each other). Required: no overlapping text in any panel; the new app has no separate strip (see `context-menu.md`).
4. **Remove wrapper on a component instance broke the document** (the audit's AUD-04, 2026-10-02): its parts were lifted out of the instance, parts of no instance, which the model refuses. Required: an instance keeps its wrapper; the door is unavailable for it (the context menu leaves it out) and says why: "<name> is an instance: its wrapper holds its parts. Detach it from the component first." The instances' rules have one owner (`instanceMoveRefusal`, `src/core/design/components.ts`).

## workbench-panel

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- The workbench (`#bench`) sits under the canvas with a tab strip (`src/features/workspace/camera.js:490-509`). Clicking a tab shows that tool; clicking the active tab collapses the workbench (`camera.js:468-473`).
- `#benchToggle` (show/hide) and `#benchMax` (maximise/restore) buttons at the right of the strip (`src/features/workspace/dock.js:279-290`).
- The strip's splitter resizes it (see `panel-resize.md`); tab strip keys ArrowLeft/Right/Up/Down, Home, End move and activate (`camera.js:510-529`).
- View → Developer tools toggles `layout.developer`, which shows the unpinned tools' tabs (`camera.js:502-504`, `dock.js:540-541`).

### Hit zones and thresholds

States (`layout.bench.state`): `collapsed` (tab strip only, 40 px), `open` (observed 160 px, top at 714 px), `max` (observed 508 px, top at 366 px — it covers most of the canvas area).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Maximised | The workbench grows over the lower two thirds of the canvas area; the maximise button shows pressed. | ![max](img/workbench-panel--01-maximised.png) |

Observed transitions: open (160 px) → max (508 px) → open (160 px) → collapsed (40 px) → open (160 px). Turning Developer tools on changed nothing visible in the strip (still `Engine read-out` and `Keyboard shortcuts`).

### Result in the document

None. State and height are saved in preferences.

### Undo and redo

Not applicable.

### Nested elements

Not applicable.

### Zoom other than 100 %

In Fit mode the canvas refits when the workbench changes size.

### Keyboard equivalent

Tab strip arrows/Home/End; no shortcut for show/hide or maximise.

### Problems in Pager

1. **Tabs cannot be closed.** Required: each tab has a close button; closing the last tab collapses the workbench (manifest feature `workbench-panel`).
2. **Developer tools add no Document tab.** Required: Developer tools adds a `Document` tab showing the live document JSON read-only, updated after every command; the choice is stored in preferences.
3. **Maximised covers only part of the canvas area.** Required: maximise covers the whole canvas area, then restores.
4. **One image made the Document tab a single line of a million characters** (the audit's U-027: a file's bytes, base64, 5.5 million pixels wide). Required: the tab shows the JSON indented, and a string longer than 200 characters as its first 48 characters and its length (`iVBORw0KGgo…(1182065 characters)`); the document itself is unchanged.

## workspace-settings-dialog

Read from Pager's source (`reference/Pager`, run from `.cache/pager-run`); references are `path:line` inside Pager.

### Trigger

- Pager draws a Guides & Grids panel of rows in six sections (`src/features/precision/index.js:363-368`): Visibility, Manual guides, Column grid, Row grid, Dot grid and Smart behaviour.
  - Visibility has switches for rulers, manual guides and smart guides (`:238-246`, rows `:372-384`). They are flags in a preference, `pe-guides-v2` (`:76-89`).
  - Manual guides lists each guide with its axis, place and a remove action, and has a row to add one (`:261-356`).
  - The grids: a switch per grid and one field per number. Columns: count, width, gutter, margin. Rows: height, gutter. Dots: step (`:248-259`, `:396-417`). They are stored in the page (`gdpGrid`, `:95-105`) and clamped to bounds (`gdpNum`, `:91-94`): columns 1–96, width 0–20000, gutter 0–400, margin 0–2000, row height 1–4000, row gutter 0–400, dot step 2–400.

### Our rule

- **View › Guides & Grids** (`workspace.openDialog`, dialog `guides-grids`) opens a modal dialog. Opening it changes nothing in the document and records nothing.
  - It closes with Escape (`ui.dismiss`, the dialog key context) or its close button (`ui.dismiss`, the `dialog` region). The focus then goes back to where it was.
  - Escape belongs to the open dialog even after a click on its shield moves focus away from a field. It closes the dialog without clearing the canvas selection behind it.
- The dialog shows its sections, each titled with an info tooltip (its hint):
  - **Visibility:** the rulers (`view.toggleRulers`) and the manual guides (`guides.toggleVisible`). These are preferences, restored after a reload, not recorded in the history. Smart guides and equal spacing (`view.toggleSmartGuides`, `view.toggleEqualSpacing`) belong to smart-guides and are not available until it is built.
  - **Manual guides:** each guide of the page with its place and its remove button (`guides.delete`). Then Add a guide, one button per axis (`guides.create`), which opens a field where the place is typed; Enter adds the guide.
  - **Column grid, Row grid, Dot grid:** each grid's switch (`grid.toggleColumns`, `grid.toggleRows`, `grid.toggleDots`). Then one field per setting, which keeps its number with `grid.setSettings` (grid, setting, value) on Enter.
    - Column grid: count, width, gutter, margin.
    - Row grid: height, gutter.
    - Dot grid: spacing.
    Grids and guides are page data (the page root's `grid` and `guides`): undoable, saved with the document, never exported.
- Every change applies to the canvas at once: the rulers hide, the guides hide, the grids take their new sizes.
- The grids' sizes are the page's `grid` settings, else the defaults of interactions.json (grid.columns, grid.width, grid.gutter, grid.margin, grid.rowHeight, grid.rowGutter, grid.dotSpacing).

### Refusals

- A value outside its bounds is refused naming the setting and its bounds (`status.grid.outOfRange`), and nothing changes. The bounds: count 1–96, width 0–20000, gutter 0–400, margin 0–2000, row height 1–4000, row gutter 0–400, dot spacing 2–400.

### Problems in Pager

1. **A value out of bounds is silently clamped** (`gdpNum`, `:91-94`), so the grid shows something other than what was typed. Required: it is refused, naming the setting and its bounds.
2. **The panel is a floating panel that stays open.** Required: a modal dialog that Escape and its close button close, with the focus back where it was.
3. **Smart guides and snap are one flag** (`gdpSetSmart`, `:117-123`). Required: separate settings (smart-guides, snap-toggle-settings).

### Undo and redo

- A grid's switch, a grid setting, and adding or removing a guide are one undo step each.
- The visibility switches are preferences and record nothing.

## wrap-row-column

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager. Pager has two doors that create a Row/Column wrapper: the **R/C keys** (this feature) and a **side drop during a drag** (documented here too, because it is the same wrapper concept and the same styles must come from one owner).

### Trigger

#### Keys
- `R` wraps in a row, `C` in a column, with the canvas focused and exactly one element selected (`src/features/input/index.js:781-813`).
- Other doors: selection bar "wrap in a row/column" and Arrange menu (`src/app/boot.js:281-282`, `src/features/workspace/dock.js:417-418`); they call the same key row (`runKey`).

#### Side drop during a drag
- While dragging an element (or a palette type) over a sibling that fills its parent's cross axis, the pointer inside a **side band** proposes "create a row/column with the target" instead of a reorder (`src/platform/overlay.js:22-42`, `:78-85`).
- After **400 ms** of dwell on the same side, an explanatory pill appears (`src/features/drag/drag.js:1082-1103`, `DWELL:400`). The pill is only an explanation: releasing inside the band wraps whether or not the pill has appeared (`drag.js:1122`, `:1189-1207`).

### Hit zones and thresholds

#### Keys
Refused, with the document JSON unchanged, when (`input/index.js:784-800`):
- more than one element is selected — `This action needs one selected element.`;
- the selection is the Page root — `The root cannot be wrapped.`;
- the selection or an ancestor is locked — `🔒 <name> is locked …`;
- the nesting rules forbid a `<div>` there or the element inside a `<div>` — `Cannot wrap <name>. <reason>.`

#### Side band (drag)
For target *T* in a parent with flow axis *A* (only block/column or row flex parents; not grids, not wrapping flex, not absolute boards; the parent must accept a `<div>`):

| Parent flow | Condition on *T* | Band | Proposal |
|---|---|---|---|
| vertical (block, column) | width ≥ 82 % of the parent's content width, or *T* is self-sized; width ≥ 72 px unless self-sized; pointer not within 8 px of *T*'s top or bottom | `min(26, 0.22 × width)` px from *T*'s left or right edge | Row with [dragged, *T*] (left band) or [*T*, dragged] (right band) |
| horizontal (row flex) | height ≥ 82 % of the parent's content height; height ≥ 72 px; pointer not within 8 px of *T*'s left or right | `min(26, 0.22 × height)` px from top or bottom | Column with the two |

(`MEASURE_LIMITS.SIDE:26`, `SIDE_MIN:72`, `FILL:.82`, `EDGE_MIN:8`, `src/platform/measure.js:40-49`.) Measured: over a full-width Card (1312 × 40 px) in a Section, the pointer 10 px from the Card's left edge gave `intent row:before`.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After `R` on a Paragraph | The new Row appears around the Paragraph and is selected (outline and chip `<div> Row`); status `Wrapped Paragraph in a row. Row selected.` | ![R](img/wrap-row-column--01-after-r.png) |
| After `C` (following Ctrl+Z) | The new Column is selected; status `Wrapped Paragraph in a column. Column selected.` | ![C](img/wrap-row-column--02-after-c.png) |
| Drag in the left side band of a full-width element | A **vertical** 3 px line on the target's left edge, the target itself tinted as the "receiver", label chip `Section · create row wrapper`; status `Create Row with Card`; read-out "A horizontal wrapper is born in Section holding both." | ![side band](img/wrap-row-column--05-drag-side-band.png) |
| Same, after 400 ms | An amber pill `⇄ Create a row with 2 columns` (`⇅ Create a column with 2 items` in a row parent) appears at pointer +20, +26 px (`drag.js:1093-1095`); while the pointer is within 22 px of the pill the proposal is frozen (`drag.js:966-972`). | ![pill](img/wrap-row-column--06-drag-side-pill-400ms.png) |
| Released | The wrapper exists, holds both elements side by side and is selected; status `✓ Section · create row wrapper`. | ![dropped](img/wrap-row-column--07-drag-side-dropped.png) |

### Result in the document

- `R`: a new node `{type: "div", name: "Row" (auto-numbered), styles: {display: "flex", flexDirection: "row"}}` replaces the selection at its index, with the selection as its only child. When the wrapped element is **not a container**, the Row also gets `alignItems: "center"` (`input/index.js:801-810`). Observed: Paragraph → Row with `display:flex; flex-direction:row; align-items:center`; computed style in the iframe `flex row`.
- `C`: same with `name: "Column"`, `flexDirection: "column"`, no `alignItems`.
- Side drop: the wrapper replaces the target at its index and receives [dragged, target] or [target, dragged]; `alignItems: "center"` is added for a row when either element is not a container (`drag.js:1189-1207`). Observed: Paragraph dropped in the Card's left band → `Section > Row{display:flex, flex-direction:row, align-items:center} > [Paragraph, Card]`, Row selected.
- The wrapper styles are written by three separate code paths (`input/index.js:801-810`, `drag.js:1192-1198`, `drag.js:1259-1262`).

### Undo and redo

One history entry per wrap: Ctrl+Z after `R` restored `Section > [Heading, Paragraph]` with the Paragraph selected (observed).

### Nested elements

The wrapper is created in the selection's own parent at the selection's index; nothing else moves.

### Zoom other than 100 %

Keys are not affected. The side bands are measured on zoomed screen boxes (26 px and 72 px are screen px).

### Keyboard equivalent

`R` and `C` are the keyboard doors.

### Problems in Pager

1. **The wrapper styles live in three places** (keys, single drop, group drop). Required: one owner builds the Row and Column wrappers (and the Row/Column templates reuse it; see `templates-layout.md`).
2. **The side drop wraps on release even before the pill appears,** although Pager's own read-out says the wrapper is opt-in (`msg.rule.wrapperOptIn`: "pill (400ms) or Alt"), and Alt does nothing in the code. A drag that brushes a side band while moving to its real target can wrap by accident. Required: if the side-drop wrapper is offered at all, it is created only after an explicit confirmation (the 400 ms dwell or a modifier key named in the hint); without it the drop in that band is an ordinary before/after drop. The indicator must show which of the two will happen.
3. **The row wrapper gets `align-items: center` only in some cases** (when a leaf is wrapped), so R on a container and R on a paragraph give different wrappers without telling the person. Required: one documented default for the Row wrapper, identical for every door; the status names the styles that were added.
4. **Refusals show in the status bar with the `ENGINE` tag** (e.g. `The root cannot be wrapped.`). Required: refusals use the refusal style (danger tag) consistently.
5. **A wrapper built by a side drop or by the R and C keys does not match the template's own** (the user's real-use audit, item 3.11): the Row template is `div "Row" {display:flex; flex-direction:row; column-gap:16px}` whose columns each carry `flex-grow:1`, while the wrapper a key or a side drop builds had no gap and left its children their own widths (a 134 px column beside a 66 px one). Required: the same wrapper by every path — the row's `column-gap` and the column's `row-gap` of 16 px, and the row's children grown alike (`flex-grow:1`, the wrapper definitions of elements.json holding both, `wrappers[].childStyles`) — and the template's own children keep carrying it (see `templates-layout.md`).

## zoom-keyboard-buttons

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

| Input | Effect | Source |
|---|---|---|
| `Ctrl+=` or `Ctrl++` | zoom in by 0.1 | `src/features/workspace/dock.js:569` |
| `Ctrl+-` | zoom out by 0.1 | `dock.js:570` |
| `Ctrl+0` | zoom to 100 % | `dock.js:574` |
| Status bar `+` / `−` buttons | ±0.1 | `dock.js:86-87` |
| Status bar `Fit` | fit the page width | `dock.js:88`, `fitPage` `src/features/workspace/camera.js:188-201` |
| Status bar percentage | nothing: it is a read-out, not a menu | — |

The chords are declared as commands and dispatched from `window` keydown (`camera.js:693-703`, `:879`); they work from the canvas and from panel chrome, not while typing in a field.

### Hit zones and thresholds

- Range: **40 % to 200 %** (`ZOOM_MIN = .4`, `ZOOM_MAX = 2`, `camera.js:167`). Observed: 20 × `Ctrl+-` stopped at 40 %; 30 × `Ctrl+=` stopped at 200 %.
- Keyboard and buttons pivot on the middle of the visible part of the page (`pageAnchor`, `camera.js:160-166`): the page point under that middle stays there (observed: page point (468, 353) → (471, 347) after three zoom-ins, i.e. within a few px).
- Fit: zoom = (canvas width − 2 × 24 px) ÷ page width, rounded to 0.01 and clamped (`camera.js:187-201`); then the page is centred. Observed: 65 % in a 999 px canvas for the 1440 px page.
- Any explicit zoom ends Fit mode (`view.authored = true`, `camera.js:172`); while in Fit mode the canvas refits when its size or the breakpoint width changes (`autoFit`, `camera.js:203-216`, `scheduleAutoFit`).
- The iframe is scaled with CSS `zoom` on `#world` (`camera.js:99-113`).

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| Status bar zoom controls | `−`, the percentage (`65%`), `+`, `Fit`. | ![controls](img/zoom-keyboard-buttons--01-status-zoom-controls.png) |

The percentage updates on every change (`camera.js:105-107`); Fit writes `Fitted to 65% — the whole page width is on the canvas.` in the status bar. Other zoom changes write no message.

### Result in the document

Zoom never changes the document JSON. It is **not persisted**: after `Ctrl+=` to 110 % and a reload, the canvas opened fitted at 65 % (observed).

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

This is the zoom feature.

### Keyboard equivalent

The chords above.

### Problems in Pager

1. **The range is 40-200 %.** Required: zoom stays between 10 % and 800 % (manifest feature `zoom-keyboard-buttons`).
2. **The percentage is not a menu.** Required: clicking it opens a menu with 25 %, 50 %, 100 %, 200 %, 400 % and Fit.
3. **Zoom and Fit mode are not restored after a reload.** Required: the zoom (or Fit mode) is restored after a reload, as a workspace preference.
5. **The zoom menu named two items "400 %" and never said Fit was in force** (the code audit's U-012). Required: every item of the zoom menu reads its own level (10 % and 800 % included), and Fit is one choice of the set with them: the item of the zoom in force is checked — Fit while the canvas is in Fit mode, a level while the zoom is that level.
4. **Fit enlarged a page narrower than the canvas** (the formula has no upper bound but the zoom range): at 1920 px with the sidebar hidden, the Desktop page was drawn at 108 %, its text and borders bigger than the site shows them. Required: Fit never zooms above 100 % (the owner's decision D-4, the pattern of Webflow's canvas and Chrome's responsive view): a page narrower than the canvas is drawn at its own size, centred; the zoom menu and the keys still go above 100 %.

## zoom-wheel-pan

How Pager behaves, observed by running it from `.cache/pager-run` (Chrome, window 1600×900) and read from its source. Source references are `path:line` inside Pager.

### Trigger

- `wheel` on the canvas stage, and wheel events forwarded from inside the iframe (`src/features/workspace/dock.js:93-94`, handler `handleCanvasWheel` `src/features/workspace/camera.js:233-261`). Ignored in preview.
- **Ctrl/Cmd + wheel** zooms around the pointer; **wheel** scrolls vertically; **Shift + wheel** scrolls horizontally (`wheelPixels`, `camera.js:225-231`).
- **Space held** arms panning: the stage gets the `pan` class and a `grab` cursor (`camera.js:868-872`); a primary-button drag then pans; releasing Space disarms (`dock.js:660-662`). The middle mouse button pans without Space (`dock.js:96-109`). Space is ignored while a text field, button, tab or contenteditable has focus (`camera.js:860-867`).
- `Escape` during a pan cancels it and restores the camera (`camera.js:880-888`, `dock.js:103-106`).

### Hit zones and thresholds

- Wheel zoom factor: `exp(−deltaY × 0.002)` per event (line mode ×16 px, page mode × stage height; `camera.js:225-258`). One 100 px wheel notch → ×1.2214 (observed 100 % → 122 %). The same 40-200 % clamp as the keys; refused travel at a wall is remembered so the next notch back is not wasted (`camera.js:244-257`).
- Anchor: the page point under the pointer stays under the pointer (observed: page point (104, 90) → (104, 89) after the notch; the Heading stayed under the pointer).
- Wheel scroll: the stage scrolls by the wheel delta (observed: 200 px down → `scrollTop` +200; Shift → `scrollLeft` +200). Deltas coming from inside the iframe are multiplied by the zoom (`camera.js:237-240`).
- Pan: the camera moves by exactly the pointer movement (observed: pointer −100, −80 px → scroll +100, +80). No threshold. No element is selected or moved.

### Visual feedback

| Stage | What is drawn | Image |
|---|---|---|
| After one Ctrl+wheel notch over the Heading | The page scales around the pointer; the percentage reads `122%`. | ![ctrl wheel](img/zoom-wheel-pan--01-ctrl-wheel.png) |
| Space held, dragging | `grab` cursor on the stage (`grabbing` while dragging, class `panning`); the view follows the pointer. | ![space drag](img/zoom-wheel-pan--02-space-drag.png) |

### Result in the document

Never changes the document JSON or the selection (observed after the pan: selection empty as before, outline identical).

### Undo and redo

Not undo steps.

### Nested elements

Not applicable.

### Zoom other than 100 %

This is the zoom feature.

### Keyboard equivalent

`Ctrl+=`, `Ctrl+-`, `Ctrl+0`, Fit (see `zoom-keyboard-buttons.md`); there is no keyboard pan other than the scrollbars.

### Our rule: the zoom keeps the point, and one range for every door (the user's real-use audit, A3.21)

- **Ctrl+wheel keeps the page point under the pointer on both axes.** The horizontal place follows the camera; the page
  down the frame is the frame's own scroll, and the page inside lays itself out one frame after the zoom, which drops
  a scroll written before it: the frame holds the point again on the next frames until it stays (the audit: it drifted
  by dozens of page px down, 199 px in the measuring).
- **One range for every zoom door** (`zoom.min` 10, `zoom.max` 800): the percentage menu offers the whole range
  (10, 25, 50, 100, 200, 400, 800 and Fit), as the wheel and the keyboard steps already reach it.
- **Fit has a shortcut, Shift+1** (`view.zoomFit#key-shift-1-in-global`), beside the status bar's Fit button and the
  menu item.
- The selection-toggle and snap-suspension meanings of Ctrl stay as they are: Ctrl+click toggles, Ctrl held during a
  free drag or a resize suspends the snap, and the drag hint says so while a drag goes on (the deferral of the toggle
  to the release is recorded as an open finding in PROGRESS.md).

### Problems in Pager

1. **The wheel zoom is limited to 40-200 %** (same clamp as the keys). Required: 10-800 % (manifest feature `zoom-keyboard-buttons`).
2. **The Space pan arm stays active only while the stage has no focused control,** so pressing Space while a panel button has focus scrolls or activates that button instead of panning, without feedback. Required: Space pans whenever the pointer is over the canvas and no text field or contenteditable has focus, nor a control the keyboard focused (reached with Tab or the arrows, not during a pointer press) whose own Space runs (a palette tile inserts its element: the audit's A1.1, elements-lists); a control a click left focused never keeps the Space from the pan; the grab cursor shows while Space is held and disappears when it is released (manifest feature `zoom-wheel-pan`).

<!-- Jornada 03 J8: shared nonmodal layer contract -->

### Nonmodal layers (J8)

Asset, link, colour and component pickers, menus and anchored popovers close on outside pointer press without preventing the target action. Their trigger and nested portal layers count as inside. Picker choices and Escape restore the trigger if focus would otherwise be lost; application menu commands retain their command-specific focus destination; outside closure never steals the target focus. Choosing an asset closes its picker. Colour outside closure cancels its preview before the target action starts; Apply retains one undo step. The command bar remains modal.

Activity icons open and focus their panel; pressing an active icon keeps it open and in its current dock or floating placement. The panel close control and Ctrl+B remain closing actions.

## performance-budget

The repository performance runner uses the original 641-node study fixture in serial installed Chrome, on a production build. Three fresh profiles measure selection, canvas typing, style confirmation, undo buttons and undo shortcuts. The document and rendered node count must match the fixture; each undo route restores it exactly. Trusted events, per-phase sample counts, nonnegative timings and complete runs are required. Raw samples and inspected app/report screenshots are retained.

The primary metric is the event timestamp to the second animation frame on that event window’s clock, a rendering proxy rather than physical presentation. The historical handler-to-frame figures are shown separately, never claimed as a direct improvement comparison. Opening includes driver handoff and readiness checks. Targets of35ms typical and100ms tail are checked per group, a conservative additional guard. Recording mode reports unmet targets; --enforce fails on them. --render reuses a recorded run without new measurements or changing its timestamp/commit/environment.

## forms-masks-validation

Form configuration remains independent of assistant credentials and conversation state.

Settings exposes masks and validation on input, textarea and select elements, and submission on forms. Every confirmed edit uses element.setAttribute, stores validated JSON in formField or formSubmit, and creates one undo transaction. Invalid grammars, ranges, destinations and regular expressions refuse before patches; project loading validates the same schema. Trial text and message-language selection do not modify the document.

Text masks require a text-compatible input or textarea. For numeric, calendar or other native input controls, Settings offers the existing change-to-text action while keeping validation available. Switching a masked input to an incompatible type refuses until the mask is removed, so no formatting or validation configuration is silently lost.

The mask catalogue offers CPF, numeric and alphanumeric CNPJ, combined CPF/CNPJ, postal code, national and international telephone, RG, PIS, voter number, license plate, card number, expiry, security code, email, URL, date, time, currency and measurement. Fixed, dynamic and custom masks support optional groups, repetition, escapes and named blocks. Number, percentage, calendar, case conversion and regular-expression modes expose their applicable options. Check digits prove syntax and arithmetic, never registration or account existence.

Validation includes required, type, pattern, length, number bounds and step, cross-field equality, password rules, allowed values, relative or fixed date bounds, file types and file sizes. Input, blur and submit timing are selectable. Messages are editable per language; generated sites include translated defaults. Errors link accessible descriptions, announce validity and focus the first failed field. Native user-valid and user-invalid states remain styleable.

Submission supports the form's native action or a configured endpoint, email service or webhook with GET or POST and form or JSON encoding. It preserves repeated field names and the submitter, optionally sends raw masked values, blocks concurrent submissions and supports honeypots, result elements, retry and redirects. Optional postal lookup maps provider response keys to named fields, cancels stale requests and never enables itself. Credentials stay with the user's service.

Only configured pages link the generated js/forms.js; the path is reserved against uploaded-file collisions. Preview runs exactly that runtime. The editing canvas never installs validation or submission handlers. Export obtains browser script text through the composition port; core code has no DOM dependency.

## assistant-chat

The Assistant sidebar uses the actual manifest command catalogue for chat and authenticated local MCP tools. Model preferences persist; changing model starts a new conversation. The default is claude-opus-5-5. Service keys are encrypted in a separate IndexedDB vault and never enter document JSON, autosave, exported files or command arguments. Connection tokens stay transient and are read from the local Companion connection file.

Companion listens on IPv4 loopback, verifies exact browser origins and session tokens, and keeps standard output exclusively for MCP JSON-RPC. The person explicitly selects the editor session external tools may use. Disconnects, cancellations and invalid tool arguments fail visibly. The browser provider stream goes through the authenticated local proxy; no unsafe direct-browser API header is used.

A chat turn reserves the existing store's command group before waiting for credentials or the provider. Tool edits use actual validated handlers, including per-dispatch attribute commands, and commit as one undo entry. Cancellation, failure or a refused edit restores document, selection and history. Unrelated document/history/load mutations cannot enter the active group. Provisional states are not autosaved. Existing pointer and keyboard transaction contracts remain unchanged.

The person may attach a PNG/JPEG/WebP/GIF reference up to 5 MB. Read tools return document/selection/revision or the canvas image, never editor preferences or credentials. The assistant cannot run its own credential/settings commands. Imported page text and image contents are untrusted task data. Confirmation requirements are never automatically accepted. Streaming replies and tool results render as text. The person can stop a turn or start a new conversation.

A picture to lay out (the plan's stage 14.3, Bet F): the reference goes to the provider as a base64 image block before the person's words, as the provider's vision guide advises (platform.claude.com/docs/en/build-with-claude/vision); the answer lays it out through the Layout Composer's own tools (layout_enter, layout_stroke in draw mode, layout_leave), and the whole turn is one undo step. Required: a turn goes on while another view takes the sidebar — its own layout_enter opens the Layout panel there — so the assistant lives as long as the editor, not as long as its panel (the turn was cancelled when the panel went away, AV1); `tests/e2e/assistant.spec.ts` replays it with a stub provider, and `npm run assistant:check` asks the real provider with the person's own key from the environment, never typed by anyone else.

## export-clean

The renderer's existing declaration writer emits compact equivalent physical box declarations for export. It uses the existing manifest composite codecs, preserves explicit zero overrides, refuses substitution and mixed global/important values, and respects logical conflicts. Elliptical radii keep separate axes. Border and font shorten only when every reset-only longhand is explicitly at its reset value with the same priority. Author styles are never reordered or globally deduplicated. Identical generated node rules merge only for exclusive generated identities and identical pseudo/media contexts; source node provenance is retained.

Div creation has no redundant zero-padding defaults. This changes future defaults without guessing whether saved explicit zero values represent author intent.

Generated class names identify semantic roles using the project's code language (English by default). Familiar default labels in English/Portuguese translate (Seção → section, Título → title); custom author labels remain, as does an English word already given (Menu stays menu). Identical role/style identities share a generated class across pages; a name already taken by an element with other styles takes the next free number (hero-2); identical elements reuse the first name, so the names are stable from one export to the next. Interactive targets retain individual identity. Export remains deterministic and style classes keep precedence before generated own rules.

Project document language defaults to the editor language at project creation; code naming language defaults to English independently. Both persist as optional, validated language tags. Their metadata does not change the definition of an empty project. Explicit per-page languages override the project language. Both canvas and export write the effective language and infer button type only if the author omitted it: submit with a containing or associated form, button otherwise. Explicit reset/submit/button remains unchanged. An input says its type too: one that sets none is written `type="text"`, the HTML default (the audit's AUD-22, html-validate no-implicit-input-type).

Batch layer rename validates all targets before publishing one transaction, delegates each target to the existing rename owner, preserves locks/root refusal and supports literal names plus {name}/{n} patterns. One refused target means zero patches. Checks offer page-language and missing-button-type advice and an atomic correction command; button changes delegate to the existing attribute owner.

Captured residual style sheets remain separate project files, linked before generated CSS. Preview inlines their bytes and resolves their relative assets through the capture and file owners. Capture import owns the file-link field and rewriting logic.

## layout-composer

The original concept this tool grew from (the user's pasted conversation of 2026-10-01, translated) is archived in
[`docs/archive/layout-composer-concept.md`](../docs/archive/layout-composer-concept.md). It is background only: wherever it
conflicts with this section or the manifest — its several tools, lenses, arrangements and constraint painting — this
section wins (the user's decisions of 2026-10-02: one tool, one key per gesture; `docs/PRODUCT.md` DEC-16, DEC-17).

The Layout Composer composes a container's layout by drawing it, with the Layout tool: the canvas toolbar's second tool (after Select, view.selectTool, which puts any other tool away), also L, and Layout in the context menu (the name the activity bar gives it; the audit's AUD-28). It composes the selected container (an element that holds other elements), else the page's root, and shows its options in the sidebar while it is the canvas tool, folding the Layers away to give them the column (putting the tool away, with Done, Escape or the Select tool, gives the sidebar back to the Explorer and opens the Layers again); the activity bar's Layout button turns the tool on as the toolbar's does. When the tool comes on again over a container it composed before, it reads back what the page holds now, since the Select tool, the Layers and the inspector change the page in between: a region whose element is gone goes with what it holds, an element moved into another region's element takes that region as its parent, and at the drawing's width an element the page lays out elsewhere or at another size takes that box, the sizes the person declared on it (the Select tool's handles) taken back for the layout to write them its own way; a reading the layout cannot hold keeps the regions as they were but for the ones that are gone. Coming on is then one undo step. The elements the container already holds become the regions the layout places, measured where the canvas draws them; each keeps its id, its own styles and its children. Nothing about the page's look changes until the first gesture.

The Layout tool is one tool, and each gesture has its own key, so a drag never means two things (the dogfooding pass, 2026-10-02: one drag that drew, moved, cut and merged by where it began did none of them reliably). A drag with no key draws: in empty space a region, inside a region a child of it, and a box drawn from empty space around whole regions puts them in the new region; a drag that begins on the line two regions share moves that line (both regions follow), one that begins on a region's own edge resizes it, and a drag on a gap, a repeat handle or a corner moves it. Ctrl held, a region dragged by its body goes wherever it is dropped, with the other selected regions when it is one of them, freely, as in a design tool: the page keeps it exactly where it was put (the structure is compiled from where the regions stand, never reflowed at the drawing's width), nested where it lands wholly inside another and taken out where it leaves its parent; Ctrl held from empty space, the drag is a selection box. Shift held, the drag is a selection box (a marquee): the regions it holds whole are selected. A letter held through a drag is a spring-loaded tool, as a tool's key held in a design tool switches to it while held: S held, the drag splits along its line (a line drawn inside a region, short of its edges, is carried across the region; a rough line splits along its main direction at its middle; a stroke that turns and crosses again splits several times); M held, the regions it sweeps become one over the box they span, apart as they may stand, refused when that box would take in another region. Alt held, the dragged box is subtracted. A click selects a region (Ctrl+click too; Shift adds, Alt picks the next one under the point). The panel's Merge joins the selected regions the same way. The canvas never draws the pointer's trail: each gesture draws what it will do (the box drawn or moved, the cut, the merged box). A box drawn, moved or resized and a split snap to the lines within the hit radius: first an edge that comes within the radius of the facing edge of a region beside it touches it (no sliver is left between them; a gap drawn wider, cards kept apart, stays), then the container's edges, the other regions' edges and centres, and the spacing the siblings already keep; the canvas draws the lines it snapped to as guides before the release. The hit radius is 8 screen pixels, divided by the zoom the canvas shows (the chosen one, or Fit's). The canvas previews the stroke with the same reader the command commits with, so what is written is what was seen. Delete removes the selected regions with what they hold. A region placed past the bottom of the drawing makes it taller.

With the Select tool, a region the Layout tool drew is placed in the layout, not as a loose element: dragged by its body (selected or not) it moves, and dragged by a resize handle its edges move (layout.place), snapped as the Layout tool snaps, and the grid is laid out again from where it stands; an edge grown into a neighbour pushes the neighbour's facing edge along, keeping the gap there was between them, and is refused when the neighbour would get thinner than twice the hit radius. A width or a height written on a region before is taken back by the layout then. The page is read back before the region is placed: a region whose element the Select tool deleted stays gone. Entering the Layout tool writes the page again only when something was read back (a region gone, moved or resized elsewhere, a size taken back), never because the compiler that wrote it was another. A row of three regions or more as tall as one another is read as cards (article, Item N) whatever their widths, so one card a handle narrowed is still a card. The room a narrow drawing leaves empty past its end (wider than 160 px and more than twice the room at its start) is no padding: the container keeps its whole width, as the drawing's frame, and its padding on that side grows with the page (max(start, calc(100% - drawing))), centred (max(0px, calc((100% - width) / 2)) on both sides) when the room on both sides is alike and wide; the room below the last region is the room above the first. With both view switches off, the canvas still draws the box of every empty container, so a region with nothing in it yet can be seen and picked. The panel lists the gestures one per line (the keys, then what the drag does), and shows a section only when it has something in it: the screen-size section at a narrower screen, the rules once there is one, the reference images once the project holds an image, the widths check only when a region stops fitting. Two regions or more selected, it offers Merge, Spacing (one gap, typed in px, between them) and Equal widths and Equal gaps; one region selected, Repeat (a count of items along its row, down its column when it takes most of its parent's width, narrowed to fit, 24 px apart). A gap handle shows its spacing in px; a repeat handle shows a plus.

Each gesture is one command and one undo step, and the status bar says what it did, in the person's language: the region it drew, the regions it cut, merged, cut an area out of, moved or deleted, a region now inside another one (and that Undo puts it back), the regions it grouped, a rule added, the items a repeat added; dragging a boundary, a corner or a gap says the sizes it gave the regions it moved. Undo says the same words back. The layout intent is compiled and written into the container at once: every region is an ordinary element (a div, in the tag its meaning gives) with flex or grid declarations at the base breakpoint and the mapped declarations at the project breakpoints, never absolute positioning. The structure is what a person would write: parallel edges within 8 px of each other are one line (a drawing made by hand is a few pixels off where the person meant one line), the room between one region and the next is a gap however small, and gaps alike (within 4 px, or a quarter of the smallest) are one `gap`; a track that regions only span across is room, never a track of its own. Lengths are whole pixels and shares have at most two decimals. The elements stand in reading order (row by row, then left to right), whatever order they were drawn in. A region's drawn height holds it open while it is empty (min-height); once it holds content the person put inside it, its content sets its height. Composing the page itself, the layout reads what its top-level regions plainly are after every gesture (Semantic inference): a band across the top (at least 80% of the drawing's width, at most 30% of its height) is the header, one across the bottom the footer, and between them the widest region of a row (at least half of it) is the main content and a column beside it no wider than 35% of the row an aside; each takes that tag and its name in the person's language (Header, Sidebar, Content, Footer), so the areas and the classes say what they hold. Only regions the person has neither named nor given a meaning are read, every meaning at most once, and what was read before is read again: a region cut in two, merged or moved never keeps a meaning its place no longer shows (it goes back to a div named by its number), and a tie leaves the main content where it was. In any layout, a row or a grid of three alike regions or more is a list of cards: each is an article named Item and its number in reading order, and a plain region holding nothing but them is a section. The page's own meanings are read only on the page's top level, and a template's regions keep the meanings the template gave them. The grid's areas are named after the regions (header, sidebar, content…, once each). Composite values are written as their longhands through the style owner's reader; a value the browser would not take is refused, never stored. What the compiler wrote last time is taken back first and the person's own declarations are never touched. Elements the person added inside a written region are kept; a change that would drop such an element, or lose an element of the page the layout places, is refused.

The container keeps its intent as authoring data (namespace layout-composer) and every written element a marker with the declarations the compiler owns there. Authoring data is inert for the renderer, the export, the Layers and the inspector; a module validator checks it on import and before every commit. Reopening the container reopens its layout; elements added since join it as placed regions. Done (or Escape) closes the composer and the page keeps its structure. Escape also closes it while the toolbar button still has focus, before the measured stage takes focus; other toolbar keys keep their toolbar context. A refused gesture changes nothing and the status bar says why, in the person's language.

The panel sets what the selected regions mean and how they behave (layout.configure): the name (which is the element's name in Layers, both ways), the meaning (the tag the region compiles to; an element of the page keeps its own), how the width and the height behave (fixed, fluid, fills the space, fits its content, proportional), the inner space, and how the region aligns and distributes what it holds. The arrangement of a group (the selected region's children, else the group the selection is in, else the top level) can be chosen when the drawing reads more than one way (layout.interpret): automatic, grid, rows and columns, fixed sizes, proportional or masonry. With two regions or more selected, Equal widths and Equal gaps (layout.configure, field equalize) lay them out again within the span they take, in their order: equal widths share it after the gaps they keep, one gap keeps their sizes and the span's ends; the rule is then kept (equal sizes, one gap) and listed with the others. Each is one undo step; a value the property does not take is refused, names the property in the person's words, and changes nothing. A new arrangement is compiled afresh: no wrapper of the arrangement before it stays.

Narrower screens adapt on their own (the layout's automatic reflow, spec "Responsive inference"): at the tablet breakpoint (the widest project breakpoint no wider than 1024 px) every group laid side by side stacks, in reading order; a row or a grid of three alike items or more flows in two columns there instead, and stacks at the phone breakpoint (the narrowest). A stacked child gives back only what it declared about its place (its grid area, its share of a row, its margin). What the person chooses at a width (stack, columns, keep the drawn arrangement) replaces the automatic behaviour there and at every narrower width it reaches; the container's intent keeps only the person's choices, and the reflow is derived from it every time.

Regions are drawn at the base screen size. At a narrower one (the frame's tabs) the canvas draws each region where the page lays it out there, a click selects it, and the panel says what changes at that size and every narrower one (layout.respond): the group stacks, keeps the drawn arrangement, flows in a number of columns (1 to 12), or the selected regions hide or show. The change is written at the matching breakpoint's layer and nothing at the wider sizes moves. A stroke or a delete at a narrower size is refused and says that regions are drawn at the base size; so are sizes, spacing and alignment (layout.configure), which the panel does not offer there: it says where they are set. A name and a meaning are the region's at every width. The panel says, at a narrower size, what the automatic reflow does there.

The panel lists the rules the layout keeps between regions (made with Equal widths and Equal gaps: equal sizes, one gap), each with its own door to remove it (layout.unrelate); the regions keep where they are. It offers suggestions only on strong evidence (layout.suggest): a repeated group becomes a grid, nearly equal gaps become one gap, a wrapper that no longer changes anything goes; one suggestion per group, and only when accepting it changes the page the layout compiles to. A built-in template (dashboard, landing page, sidebar layout, article, gallery) is placed inside the one selected empty region, or over the container while it holds no region, scaled to it and named in the person's language (layout.template); anywhere else it is refused and says how to place it (select an empty region, or use it on a page with no region yet). A project image can lie under the composition as a reference at an opacity (layout.reference), and its blocks can be traced into regions over it (layout.trace): the panel reads the image's luminance (at most 160 px wide) and the engine finds the blocks. The widths check measures the layout as the page lays it out (with its automatic reflow) and says whether the structure holds from the drawn width down to 320 px, or the widest width where it breaks: a fixed region no longer fits, or a region drawn at least 160 px wide is left narrower than 160 px.

The Layout Composer is a removable module: everything it brings lives in src/modules/layout-composer and its manifest files, and joins the application at one registration point (src/app/modules.ts and modules-view.ts). Without it the application still generates, passes its checks and builds (npm run modules:removal layout-composer), and a document it wrote still opens with its authoring data kept, unread. While a stroke is held, a pointer move's work stays within 16 ms (npm run perf:layout).

## motion-interactions

Pager has no motion of its own (see `events-actions`); this is the stage 10 model of the plan, written for Builder.

### Trigger

The Interactions tab holds two lists, each under its title (jornada03 plan, stage 5: the canonical card): **Events**
(the element's events, spec events-actions, with Add in the tab's head: the element's icon, name and tag) and
**Motion**, then the behaviours; each list says when it is empty ("No event on this element yet.", "No motion on this
element yet."), and one note ends the tab with what runs where: Run interactions plays the motion on the canvas, Preview
runs the events and the motion (the two notes it had contradicted each other). A motion card is drawn as an event's card
(design/final `.ix`): its trigger and what it plays as the head, the trash as an icon, the fields in the 72 px label
column.

Under the events: **Motion** (`motion.add#inspector-motion-add`) adds one to the single selected element. A new interaction starts with the first trigger the element offers (click, which every element offers) and plays a **new timeline of the project named after the element and the trigger** ("Hero click"), holding one animation of the element itself, from 0 s for 0.6 s, eased out, keying nothing yet (as a new CSS animation's keyframes hold nothing).

### Hit zones and thresholds

Each card is the canonical "On click → plays Hero click": Applies to, Trigger, the trigger's own options, Timeline, Plays it, Only once, Delay, Breakpoints, Reduced motion. Every field is a door of `motion.update` fixing its `field`; its text is the command's `value`.

- **Triggers** (the whole catalogue, grouped by category; `src/core/motion/catalog.ts` describes each, `manifest/commands/motion.json` offers the same ids):
  - Element: click, double click, press, release, pointer enter, pointer leave, hover (enter and leave), pointer move over the element (continuous, along x or y), focus, blur, focus within (enter and leave), a key (with its key filter, `KeyboardEvent.key`), input, change, form submit, invalid form, long press (its time).
  - Scrolling: entering the screen (its visible part, 0 to 1; leaving it is its second half), leaving the screen, while crossing the screen (continuous), page scroll (continuous), scroll direction (the direction that plays; the other one is its second half).
  - Page: load, before leaving (a link to another page of the site waits for the timeline, at most 1.5 s), tab visibility, resize, entering a breakpoint, after a time, every interval, idle.
  - Media (a video or an audio element): play, pause, end, a media time.
  - Components, by the state the markup carries (no component owner exists for a dropdown, a carousel or a mobile menu): a dropdown opens or closes (`aria-expanded` of a control with `aria-haspopup`, or a popover's toggle), a tab changes (`aria-selected` of a `role="tab"`), a slide changes (`aria-current` of an `aria-roledescription="slide"`, the slide action's `builder:slide-change`, or a scroll-snap container settling on another child), a dialog opens or closes (its `open` attribute), details open, the mobile menu opens (`aria-expanded="true"` on a control whose `aria-controls` names a `nav` or an element holding one), a custom event (its name).
- A trigger that cannot apply is not offered and is refused (`status.motion.notApplicable`): input and change on a form or a field, submit and invalid on a form, media triggers on a video or an audio, dialog triggers on a dialog, details open on a details.
- **Plays it**: play, play from the start, play backwards, play then backwards (toggle), pause, stop and reset. A continuous trigger follows its progress (scrub) and nothing else; only it does.
- **On leaving** (a paired trigger only): nothing, play backwards (the default), pause, reset at once.
- **Applies to**: empty is this element; a class of the element makes it apply to every element of the page holding that class, each playing the timeline with itself as the source of its relative targets.
- **Delay** in seconds before the timeline starts; **Breakpoints** where it applies (empty: every one); **Reduced motion**: respect it (the default: the timeline jumps to its end, or its start, every instant action crossed, nothing moving; a scrub shows the start or the end) or play as made (an essential effect).
- **Scroll range** (while crossing the screen, page scroll): the part of the scroll, in percent, the timeline plays across.

### Visual feedback

The card's head reads the trigger in words and the timeline it plays; the status bar names the trigger and the element after every change.

### Result in the document

`DocNode.motions`: each interaction's id, trigger (its kind and the options it reads), the timeline's name, its control and its options; absent while the element has none. The timeline is in `DocumentJson.motionTimelines`, reusable by name: another interaction, on any element of any page, plays it by choosing its name. Renaming a timeline renames every interaction and every action that names it. Removing an interaction leaves its timeline in the project.

### Undo and redo

Each add, change and remove is one undo step; a change that changes nothing records none.

### Nested elements

Relative targets (children, siblings, parent, next, previous, descendants and the nearest ancestor with a class) are read from the element whose trigger fired.

### Zoom other than 100 %

Not applicable: the card is in the inspector.

### Keyboard equivalent

Every card control is a field or a button of the inspector, reached with Tab.

### Problems in Pager

1. **Only five triggers and six actions, one action per trigger.** Required: the whole catalogue above, a trigger playing a timeline of actions.
2. **An interaction could not be reused.** Required: timelines are the project's, played by name.

## motion-timeline

### Trigger

The Timeline panel shows the project's timelines on the left (each with how many interactions and actions play it, a row to show it, a delete button, New timeline, the name field of the one shown) and the timeline shown on the right.

### Hit zones and thresholds

- **Axis**: seconds. The ruler spans `motion.trackLength` (6 s) at least, the timeline's own length and a second more when it is longer, at `motion.pixelsPerSecond` (200 css px per second) at first; Zoom in and Zoom out multiply it by `motion.zoomStep`, within `motion.zoomRange`, about the playhead. The labels are the smallest step of seconds that keeps them `motion.rulerSpacing` apart, with four or five minor ticks between two.
- **Playhead**: a press on the ruler puts it under the pointer (its middle, with no travel, is 3 s), a drag scrubs it; its readout says "0.48 s / 1.20 s" (the playhead and the timeline's length, two decimals).
- **Lanes** (the canonical layout): one lane per target, holding its actions as bars, then one lane per property its animations key, holding their keyframes as diamonds; a markers lane above.
- **Actions**: added after everything (sequence), with the last one (parallel) or at the playhead, each of the whole catalogue: animate (any property, custom property or transform part: translate x/y/z, scale x/y, rotate x/y/z, skew x/y), add/remove/toggle a class, set an attribute (never one that runs code or loads anything), set a style, set the text, show/hide/toggle with a transition (fade, slide up, slide down, scale; by the hidden attribute or by visibility), control another timeline (play, pause, restart, reverse, go to a time, toggle), control a CSS animation of the element, scroll to (the target, the top, the bottom; an offset; smoothly; aligned), open/close a dialog (modal or not), open/close details, select a tab, change the slide (next, previous, go to), media (play, pause, toggle, restart, mute, unmute, toggle sound), focus or blur, submit or clear a form, go to an address (a URL, a page of the site, back, forward; in a new tab), copy to the clipboard (a text or the target's text), send a custom event (its name and detail), change a CSS variable (tweened when it lasts, the variable registered by the value's type), switch the theme (toggle, light, dark, the system's; remembered between visits: `color-scheme` and `theme-light`/`theme-dark` on the root), wait, split text (letters, words, lines; staggered), and a Lottie animation (play, pause, stop, go to a frame, a segment; loop; speed).
- **Targets**: this element, an element picked on the canvas or a Layers row (never typed), every element with a class, its children, its siblings, its parent, the next, the previous, its descendants with a class, its nearest ancestor with a class, every instance of a component.
- **Options** of an action: start and duration in seconds, easing (a CSS easing: keyword, `cubic-bezier()`, `steps()`, `linear()`; or `spring(mass, stiffness, damping)`), repeat (a count or forever), back and forth, stagger (seconds between targets, from the start, the centre, the end or in a seeded random order).
- **Bars**: a press selects a bar (Shift adds it to the selection or takes it out); a drag moves the selected bars together by one delta (none before 0); dragging a bar's start or end edge changes when it starts or ends, the other edge staying, its keyframes scaled with it (never shorter than 10 ms; an instant action has no edges).
- **Snapping**: a dragged edge, keyframe, marker or playhead snaps to the start, the playhead, the other bars' edges, the other keyframes and the markers within `motion.snapDistance` screen px, else to `motion.snapGrid` (50 ms); Alt held, or Snap turned off, moves it freely.
- **Markers**: added at the playhead ("Marker 1"), dragged, renamed, removed.

### Visual feedback

The selected bars and keyframes are highlighted; an instant action's bar is a tick; an infinite one shows one cycle and says it loops. Picking a target says "Picking on the canvas…" until the press.

### Result in the document

`DocumentJson.motionTimelines[]`: `{ id, name, actions, markers }`; an action `{ id, target, start, duration, effect, easing?, repeat?, yoyo?, stagger? }`, times in whole ms; an effect `{ kind, … }` with its options; a marker `{ id, name, time }`. A timeline's name is unique, letters or digits first, at most 64 characters. When an element an action picked leaves the document, the action leaves its timeline (`core/document/tree.ts` releaseReferencesPatch).

### Undo and redo

Each command is one undo step; a drag is one step for the whole gesture, and Escape puts everything back. Showing a timeline, the playhead, the zoom, the selection and snapping are the editor's state: no undo step.

### Nested elements

A target lane is per target as the action names it (one lane for "its children", whichever element plays the timeline).

### Zoom other than 100 %

The Timeline's zoom is its own; the canvas's zoom does not change it.

### Keyboard equivalent

Every field and button is reached with Tab; a bar and a keyframe are buttons (Enter selects, Shift+Enter adds to the selection).

### Problems in Pager

1. **The timeline showed one animation of one element in percent.** Required: a real seconds-based, multi-track timeline of actions per target and per property.

## motion-keyframes

### Trigger

The selected action's fields offer "Animate a property" (a property, a custom property or a transform part, keyed at the playhead with the value it holds there: its nearest keyframe before, else its initial value); a property lane's diamond-plus adds a keyframe at the playhead to the action under the playhead.

### Hit zones and thresholds

- A keyframe's fields (one keyframe selected): its value, the easing of the segment that starts at it (per-segment easing), its time (seconds of the timeline), and the property its track animates.
- A drag moves the selected keyframes together, none leaving its action nor passing a keyframe of its track that stays.
- Copy takes the selected keyframes with their spacing; Paste puts them at the playhead into the selected action (or the selected keyframes' action), a keyframe at the same time of the same property replaced, the action growing to hold the last one.
- Record: while it is on, a value set in the inspector for the selected element becomes a keyframe of the timeline shown at the playhead — on the selected action when it animates, else on an animation of the element under the playhead, else on a new animation from 0 to the playhead. A playhead before that action's start is refused (`status.motion.recordBeforeAction`).

### Visual feedback

A keyframe with its own easing is drawn filled; the Record button is pressed and the panel says "Recording: inspector changes become keyframes at the playhead".

### Result in the document

`effect.tracks[] = { id, property, keyframes: [{ id, time, value, easing? }] }`, time from the action's start, in time order, one per time. Deleting a track's last keyframe removes the track.

### Undo and redo

Each change is one step; a recorded value is one step, as the style write it replaces.

### Nested elements

Not applicable.

### Zoom other than 100 %

Not applicable.

### Keyboard equivalent

The keyframe fields and buttons are reached with Tab.

### Problems in Pager

1. **Keyframes were percents of one CSS animation.** Required: keyframes timed in seconds per property track, per-segment easing, copy and paste, record mode.

## motion-preview

### Trigger

Play, Pause and Stop of the Timeline preview the timeline shown on the canvas: Play walks the playhead from where it is to the end, Pause holds it, Stop puts it at 0 and the elements back to their own styles. Moving the playhead draws the timeline there. **Run interactions** (View ▸ Run interactions, a checked item while it runs) makes the canvas run the interactions as the page does, until it is turned off.

### Hit zones and thresholds

The preview draws the timeline on every element whose interaction plays it, else on the selected element. In run mode, presses on the canvas reach the page (the pointer owner lets them through) and the editing gestures wait until it is turned off; navigation and form submission never leave the editor.

### Visual feedback

The canvas shows the elements at the playhead; the status bar says what runs.

### Result in the document

None: previewing and running change no document.

### Undo and redo

No undo step.

### Nested elements

Not applicable.

### Zoom other than 100 %

The runtime runs inside the canvas's frame, at the breakpoint shown; the canvas zoom changes nothing of it.

### Keyboard equivalent

The buttons are reached with Tab.

### Problems in Pager

1. **Interactions ran only in the preview.** Required: run them in the editor too.

## motion-behaviours

### Trigger

The Interactions tab lists the behaviours: sticky while scrolling, scroll snap, smooth scrolling, parallax, looping marquee, follow the cursor.

### Hit zones and thresholds

- **Sticky** and **scroll snap** are plain CSS, written through the style owner (`core/style/set.ts`): sticky writes `position: sticky` and `top` (the amount, px); scroll snap writes the container's `scroll-snap-type` (`x mandatory` or `y mandatory`) and its overflow along that axis, and `scroll-snap-align: start` on each child. They show in the Style tab and are removed there.
- **Smooth scrolling** (the page's body: the whole page), **parallax** (speed -1 to 1, along x or y), **marquee** (px per second, along x or y, either way) and **follow the cursor** (smoothing 0 to 0.95) run from the motion script.
- Less motion asked: smooth scrolling and parallax stay off, the marquee stands still, the follower follows without lagging.
- The marquee pauses while the pointer is over it or the focus is inside it (WCAG 2.2.2); its copy is hidden from assistive technology and from the keyboard.

### Visual feedback

The behaviours the element has are listed with their amount, their axis and a remove button.

### Result in the document

`DocNode.behaviours[] = { kind, amount, axis?, reverse? }`, one per kind, absent while there is none.

### Undo and redo

One step each.

### Nested elements

Scroll snap writes the children's alignment in the same step.

### Zoom other than 100 %

Not applicable.

### Keyboard equivalent

Buttons and fields reached with Tab.

### Problems in Pager

1. **No behaviours.** Required: the six above.

## motion-runtime

What runs on the page (the export, the preview, the canvas's run mode): `src/editor/motion/runtime/`, plain JavaScript written into the page as the functions' own source.

- Every interaction is bound at start, on every element its selector finds; every timeline it plays is made then, paused at 0, so each animation's first keyframe holds from the start (an element that fades in on scroll is transparent before).
- **Playing a timeline**: native Web Animations, one animation per property track per target, delayed to its action's start plus its stagger and padded by an end delay to the timeline's end, so all of them share one clock; instant actions are crossed as the clock passes them and undone when it goes back. Scrubbing runs only the actions that can be undone (classes, attributes, styles, text, display, variables, dialogs, details, the theme), never one with an effect outside the page.
- **Scroll progress**: `ScrollTimeline` (page scroll) and `ViewTimeline` (while crossing the screen), the range as `rangeStart`/`rangeEnd` ("cover 20%"), where the browser has them and the interaction has no breakpoints; else a scroll listener, once per frame.
- **Transform parts** animate registered custom properties (`--bm-translate-x`…) composed after the element's own transform.
- **Split text** cuts each text node where it is (a bold word stays bold), hides the pieces from assistive technology beside a hidden copy of the text, and puts the very same text nodes back when it stops.
- **Lottie**: lottie-web 5.13.0, its light build (SVG renderer, no expression evaluation), loaded only by a page whose timelines use it; the animation data is written into the motion data, so it plays from file://.
- A name that names nothing (a class, a component, a breakpoint, a file, a CSS animation another owner removed) acts on nothing. A media element the browser refuses to play, a refused clipboard, a missing Lottie player are said (the page's console; the editor's incident feed).

## export-motion-js

### Trigger

File › Export (and the preview) of a project whose pages hold an interaction or a behaviour.

### Result in the document

The archive holds `js/motion.js`: the runtime and the site's motion data (every interaction with the selector of its element — the class the export gave it, or the person's id — and the timelines they play, with the ones those control); `js/lottie.min.js` only when a timeline plays a Lottie animation. Each page holding motion links them (`<script defer src="js/lottie.min.js">` first, then `<script defer src="js/motion.js">`); a page without motion links neither. No editor id and no data attribute address an element.

## data-collections

The project holds collections (the Data panel, an activity of the sidebar): each a unique name, a schema of fields and a
list of items. A field has a key that never changes (made from its first label, without accents, numbered when taken),
a label a person reads and renames, and a type: text, rich text, image, number, date, link or yes/no. An item has an
id that never changes while it lives, and a value for each field it fills; an empty value is absent. Every value is
stored in its type's canonical form: trimmed text; a finite number (a decimal comma reads as a point: "42,5" is 42.5);
yes/no (true, yes, 1, sim, verdadeiro and their opposites); a real calendar date written YYYY-MM-DD; a link the link
rule allows (the same rule as the link picker: no javascript:, data:, blob: or file:); an image named by a project
path, a project image's file name, or a web address. The validator refuses a document whose values are not canonical,
whose collections share a name (accents and case aside) or whose fields share a label.

The panel lists the collections as tabs (data.select), makes a new one with one text field (data.createCollection,
"Collection", "Collection 2"…), renames one — every list and item page that shows it follows the new name — and
deletes one after asking how many lists and pages show it; those keep what they show as ordinary content. Under the
name, the fields: each label and type is a field of its own (data.setField), each can be removed, and a form adds one
(data.addField). A field changes type only when every value it holds reads as the new type: otherwise the change is
refused at the first row that does not, naming the row, the column, the value and the type; nothing is converted
silently or dropped. A field that a binding, a filter or a sort uses cannot be removed (status.data.fieldInUse, with
how many places use it).

The grid shows the items as the query chooses and orders them: one filter (a field, an operator — contains, is, is
not, less, at most, more, at least, empty, filled — and the text compared, read as the field's type), the order by up
to two fields (A to Z or Z to A; empty values last either way; equal items keep the collection's order), an offset and
a limit. The query is the panel's (editor state), and it is what Fill repeats. Each cell is a field that keeps what is
typed, on Enter or when it loses the focus (data.setCell): a value its type cannot hold is refused naming the row and
the column, and the cell shows the stored value again. Rows are added (data.addItem), moved up and down
(data.moveItem) and deleted (data.deleteItems). Every change of a collection is one undo step, and every list and item
page that shows it follows in that same step (spec data-binding).

## data-import

Import a data file (data.preview) reads a CSV, a TSV, a JSON list of objects (or the one list an object holds) or an
XLSX workbook, in the browser, before anything changes: its sheets (one for CSV, TSV and JSON), each with its columns
(the header row's names) and rows. CSV and TSV are read by the project's one CSV parser (core/design/data.ts, quotes
holding delimiters, doubled quotes and line breaks); a byte-order mark is skipped. A workbook is read through the
project's ZIP reader and the browser's XML parser: shared and inline strings, numbers, booleans, sparse rows (a skipped
cell is empty), dates by their number format (built-in and custom, 1900 and 1904 date systems, never the fictitious
29 February 1900); a formula's saved value is read and a formula is never run. Refused before any change, each naming
the file and where: a file that is not CSV, TSV, JSON or XLSX, no rows, a column without a name or two with one name,
a row with more cells than columns, a quote opened and never closed, text that is not UTF-8, JSON that is not a list of
objects, a spreadsheet that cannot be read, a formula saved without its value, a cell holding an error, a sheet read
from outside the file, more than 32 MB (128 MB unpacked, 100,000 rows, 10,000 archive entries) or a path that climbs
out of the archive. A sheet of a workbook that cannot be read keeps its problem and the others stay importable.

The preview shows the file's name, a segment per sheet (data.previewSheet), the problem of the sheet shown, and its
columns, each with the type it will take — guessed from its filled cells (yes/no, number, date, image file names,
web addresses, else text) and changed in its menu (data.previewType) — and its first five rows. Import as a new
collection (data.importNew) makes a collection named as typed (the file's name without its extension when nothing is),
a field per column (its label the column's name) and an item per row; a value its column's type cannot hold refuses
the whole import, naming the row, the column and the value. Into the collection the panel shows, the rows go after its
items (data.importInto, append), in place of them (replace), or updating the items whose first matched field holds the
row's value there (update by the file's first column; a row with a new value is added; an empty or repeated key
refuses the whole import naming the row). A column fills the field labelled like it (accents and case aside), else
the field whose key it is; the preview says which columns fill which fields and which are left out. Each import is one
undo step; the preview closes and the panel shows the collection. The Explorer's Upload keeps CSV, TSV, JSON and XLSX
files in files/ too (jornada03 J13), where Fill from data reads JSON, CSV and TSV.

## data-binding

An element shows a field of an item through a binding, a mark it carries: the field and the part it fills — the text of
an element that holds text and no children, an image's source or alternative text, a link's address, or the address of
the item's own page (spec data-pages). Connect fields lists the parts of the element to repeat — the element selected,
or the repeated item (an instance) it lies in — each with a menu of the fields that fit it (an image's source takes an
image or a link field; a link's address a link field or the item's page; a text and an alternative text any field).
Choosing a field binds the part (data.bindElement); dragging a column of the panel onto the part does the same through
the pointer owner (input/pointer.ts, the data-column drag): one undo step, Escape binds nothing. A binding inside a
repeated item belongs to its component, as a style does: the definition and every instance carry it. A part that
cannot show the target is refused (status.data.cannotShow), a locked element too.

A preview under the parts shows what the first three items of the query would show, a project image as its thumbnail,
and in place of a value the problem it would meet (an image no project file answers to, an address a link cannot
take). Fill (data.fill, a labelled button: its face says Fill without a hover) repeats the element for every item the
query shows, inside its parent: an element that is not an instance yet becomes a component named after it (as a
repeat makes one) and the first repeated item; its parent becomes the bound list (its dataList mark: collection,
component, query). The n-th repeated item shows the n-th item: an item past the last repeated one gets a new instance
after it (named as a repeat names it), a repeated item past the last item goes (with every reference to it released),
and the parent's other children stay where they are. Refused before any change, naming what is at fault: the page's
root, an element with no binding, a binding to a field the collection does not have, an element inside another
instance, a parent that repeats another collection, a locked element, and a value an element cannot show — an image
cell that names no project file by its path or its file name (any case, with or without the extension) and no web
address (status.data.imageNotFound, the row, the column and the cell), an address a link cannot take.

A bound list follows its collection from then on, in the same transaction as every change: an edited cell, an added,
moved or deleted item, another type or a changed query show at once, and one undo takes the change and what followed
back. An element's bound part edited directly on the canvas or in Settings writes its new value to the item (the
canvas is one more way to edit the collection), which every other place showing the item then shows; a value the
field cannot hold refuses the edit, naming the row and the column. A link bound to the item's page is refused there:
its address follows the page. Unbind (data.unbind) stops the list following its collection; its items stay ordinary
instances. The repeated items follow the collection alone: a command that adds, removes or moves one itself (a card
duplicated, deleted or dragged while the collection stays as it was) is refused (status.data.listOwned), saying to add,
delete or move rows instead. A selection that named a repeated item the collection took away loses it. A binding
whose element can no longer show its part (a link made a button) is dropped with the change that made it so. Exported pages are plain HTML with the values in place: no data runtime, no binding in the markup.

## data-pages

Pages from this page: names typed one per line (pages.fromNames) make one page per name, each a copy of the open page
— every node with its own id and styles, HTML ids and references repaired — named and filed as a duplicate is ("Unidade
Centro", unidade-centro.html; a name taken is numbered, never an existing file overwritten), placed after it in their
order; the first opens. A page per item (pages.fromCollection) makes one copy of the open page for every item of the
collection the panel shows that has no page yet, named by the item's first text field, its root marked with the item
(dataItem): every binding of the page shows that item, and a link bound to the item's page leads to it. An item with
its page keeps it: its file never changes when the item does, so links to it never break; a page whose item is deleted
keeps its content and loses its mark. An empty name refuses the whole operation naming the row; a page made for an item
is never a template. Each operation is one undo step, and pages made later receive the shared regions that ask for it.
Duplicating a page opens the copy and gives its name field the focus with the name selected, as the + does (jornada03
J20). A page made by duplicating an item page is an ordinary page (two pages never claim one item).

## shared-regions

A shared region is a header, a footer or a menu (an element directly inside a page's root) shown on several pages and
edited once. Share (regions.share, the selected element and the pages ticked, all others by default, and "Pages made
later") makes the element a component when it is not one (named after it), marks the definition shared, and places an
instance on each chosen page that has none: first among the root's children when the element stands in the first half
of its page, else last. Every change to one instance — a text, an attribute, an element added, moved or removed —
reaches the definition and every other instance in the same transaction (each keeping its own ids and names, and its
own hidden and locked flags, which are the person's choice on each page); styles already reach them all through the
component. An element that holds an instance cannot be shared (status.components.holdsInstance: an instance never
lies inside another; components.create refuses it the same way). Two instances changed differently in one command refuse it
(status.regions.conflict); a locked instance that would have to follow refuses it naming its page. A page made later
(added, made from names or items) receives the region when it was shared with new pages; a duplicated page carries its
copy. Detach on a page (regions.detach) leaves that page an ordinary copy that no longer follows; Stop sharing
(regions.stopSharing) leaves every page an instance of an ordinary component. Each is one undo step. The export writes
each page's copy as ordinary markup (one CSS class per element, as for any component).

## project-breakpoints

### Our rule

- A project starts with the default table of properties.json (Desktop 1440 as the base, Laptop 1180, Tablet 834,
  Phone 390). Its first change writes the project's own table into the document (`breakpoints`), widest first: the
  base, then every other breakpoint by descending width, each width once. A document without a table uses the
  default, so a project saved before this opens unchanged.
- A breakpoint is an id (stable: the styles are stored under it), a name (a default's follows the person's language
  until it is renamed), the widest screen it holds (a `max-width` media query), and the screen height the canvas shows
  it at (the nearest breakpoint's when it is made). The base holds every width above the others.
- **Create a breakpoint here** (`breakpoints.add`, View ▸ Add a breakpoint here and the Breakpoints dialog's Add):
  a breakpoint at the width the canvas shows, named "Screen 900" (a fresh name when it is taken). It is shown at once,
  gets its own tab (the tabs follow the table's order, widest first, in the frame's bar and in the preview bar) and
  its own media query in the export.
- **Breakpoints dialog** (View ▸ Breakpoints…): one row per breakpoint with
  its name and its width; Enter or leaving a field keeps it (`breakpoints.rename`, `breakpoints.setWidth`); the
  trash asks where the breakpoint's styles go and removes it (`breakpoints.remove`): into the next narrower breakpoint
  (which keeps its own look: it inherited them), into the next wider one, or nowhere. The base has no trash.
- A width stays between the neighbours' (the cascade's order never changes, so every style keeps its meaning).
- Removing a breakpoint takes every style set at it (elements, classes, components) and its grid settings away, or
  moves them into the chosen neighbour where that one sets nothing of its own (its own values win); a motion listing
  it forgets it, or names the neighbour instead. The breakpoint shown gives way to the base when it is the one removed.
- Each change is one undo step; undo restores the table and every removed style.
- The tabs, the status bar, the inspector's origin badges, the Layout Composer and every message name a breakpoint by
  its name; the canvas, the preview, the export and the import read the project's table.

### Refusals

- A width the table already has (`status.breakpoints.widthTaken`), outside 240 px to the base's width minus one
  (`status.breakpoints.widthRange`), or past a neighbour's (`status.breakpoints.widthOrder`, naming the range).
- An empty name (`status.breakpoints.nameEmpty`) or one another breakpoint shows (`status.breakpoints.nameTaken`).
- Removing the base (`status.breakpoints.baseStays`), or, discarding its styles, a breakpoint a motion runs only at or
  starts on (`status.breakpoints.usedByMotion`); moving the narrowest one's styles into a narrower one
  (`status.breakpoints.noNarrower`).
- A breakpoint the project does not have (`status.breakpoints.unknown`).

## side-by-side-view

### Our rule

- Side by side (`view.toggleSideBySide`, the columns button after the frame's tabs and View ▸ Side by side) is a
  preference, restored after a reload. On, the canvas keeps the frame of the breakpoint being edited and shows, to its
  right, the project's other breakpoints (up to three, the nearest in width first), each a live page at its own width
  scaled to its column, named with its name and width.
- Every change shows at once in every frame, each through its own media queries (a padding set at Tablet shows in
  Tablet and in every narrower breakpoint that does not set its own); the selection is outlined in each frame.
- A click on a side frame makes its breakpoint the one the canvas edits (`view.setBreakpoint`); the frame it leaves
  takes its place among the side frames.

### Refusals

None.

## value-presets

### Our rule

- A property or composite of properties.json may offer ready-made values (`presets`: a name in the catalogues and
  the CSS text it writes): today Shadow (Soft, Medium, Strong, Inner), Radius (Square, Small, Medium, Large, Pill),
  Opacity (Faint, Half, Mostly, Full), Border (Thin, Medium, Thick, Dashed) and Filter (Soft blur, Blur, Strong blur,
  Greyscale).
- They are drawn under the property's first field as thumbnails of themselves — a square wearing the shadow, the
  radius or the opacity — each named, its value in its tooltip.
- A click writes the value on every selected element, one undo step, as typing it would: `style.set`, or a shadow's
  own command with the value as its CSS text (`style.setShadows`, as the shadow editor's CSS row does).

### Refusals

What the field itself refuses (a locked element, nothing selected): the thumbnails are drawn unavailable.

## easing-curve

### Our rule

- A field that holds an easing (a timeline keyframe's, a motion action's or keyframe's) draws, beside its text, a
  button showing the easing as a small curve. It opens a layer with the ready-made easings, each drawn as its curve
  and named, and a cubic Bézier of one's own: its four control points (x1, y1, x2, y2) prefilled from the field's
  easing (a keyword's own points), the curve redrawn as they change; y may leave 0–1 (an overshoot), x may not.
- Choosing a ready-made curve, or Use this curve, runs the field's own door with that easing, as typing it would; the
  layer closes. Opening it and typing in it change nothing.
- The one reader of an easing's text is core/motion/easing.ts: the curve drawn is the curve the page runs (a spring is
  drawn over 600 ms).

### Refusals

A Bézier whose x lies outside 0–1, or a point that is no number: Use this curve stays unavailable.

## project-language

### Our rule

- The page root's Settings tab ends with a **Project** section: **Project language** (`project.setLanguage`) and
  **Code language** (`project.setCodeLanguage`), each a field kept on Enter, one undo step each, offering common tags.
- The project language is the `lang` of every page that names none of its own (canvas and export); a page's own
  language (Page language) wins. The code language names the exported classes (English by default).
- A new project's language is the editor's; its code language is English.

### Refusals

A text that is no language tag (`status.project.languageInvalid`), before any change.

## batch-rename

### Our rule

- **Rename the selected…** (the context menu) opens a dialog: **Names**, a pattern where `{name}` is each element's
  name and `{n}` its number, and **First number** (1 by default); it shows the names it will give, in the order
  selected. **Rename them** (`element.renameMany`) names every selected element through the one renamer, one undo
  step; the selection stays.
- The dialog closes after the renaming; Escape or × closes it without one.

### Refusals

An empty pattern or a first number below 1 (`status.rename.patternInvalid`); the page root or a locked element among
the selected refuses the whole batch with the renamer's own refusal, and nothing is renamed. The dialog itself opens only on a
selection the batch can rename: with nothing selected, the page root or a locked element among the selected, the
context menu does not offer **Rename the selected…** (it offers only what applies).

## command-bar-find

### Our rule

- The command bar also offers the project's own things (jornada03 J12): **Go to page …** for each page
  (`pages.switch`), **Select …** for each element of the open page (`selection.select`), and **Apply class .…** for
  each class while elements are selected (`classes.apply`), each named by what it holds, found by the same matching
  as every entry.
- The scope `@` (its pill: Pages, layers, classes) keeps only these.

### Refusals

None: an entry that would not run (a class with nothing selected) is not offered.

## site-colours

### Our rule

- Styles lists **Colours in use** (the plan's stage 7, "achar usos e trocar no site"; journey C1, a rebrand): every
  colour a style value of the site names — an element's own styles on every page, a class's, a component's tree — with
  how many values name it, the most used first. `#B9512A`, `#b9512a` and `rgb(185, 81, 42)` are one colour (written
  `#b9512a`); a hex colour inside a longer value (a gradient's `linear-gradient(90deg, #b9512a, #ffffff)`) counts; a value naming a variable is
  the variable's.
- A colour's field (`design.replaceColour`): the colour typed there replaces it in every value that names it, in one
  undo step; the rest of each value stays as written.
- Its variable button (`design.colourToVariable`): a colour variable is made with the colour (the next free name,
  `color-1`…) and every value that is the colour names it, `var(--color-1)`, in one undo step; the rebrand is then one
  change of the variable. A colour written inside a longer value (a gradient) keeps it there: the variable stands for
  whole values only.

### Refusals

A text that is no colour (`status.siteColours.invalid`), a colour no value uses (`status.siteColours.notUsed`), a
variable name that is no name or is taken (the variables' own refusals).

## class-moves

### Our rule

- While a class is the style target, under "affects N elements" (the plan's stage 7; journey D1, styles typed again
  element by element):
  - **Move this element's styles into .card** (`classes.moveInto`, while the selected element has styles of its own):
    its own styles join the class's, laid over them (the element looks as it did, and every element listing the class
    takes them), the element keeps none, and it lists the class; one undo step.
  - **Apply .card to every article on this page** (`classes.applyToSimilar`, scope `page`, while some element of its
    type there lacks it): every element of the selected element's type on its page lists the class; one undo step.
  - **Apply .card to every article in the project** (scope `project`, drawn only while the project has another page):
    every element of its type on every page lists the class; one undo step.

### Problems

1. **"Apply .card to every article" reached every page** (the audit's AUD-19, 2026-10-02, journey D1: making the three
   price cards share `.card` also put it on the three benefit cards of another page, and nothing applied it to the
   similar ones alone). Required: the command takes a scope, this page or the project, the page the default (the
   narrowest that holds the selected element); the selected elements themselves take the class with + Class
   (`classes.apply` on a multi-selection), its one owner, so no third scope repeats it.

### Refusals

A class the project does not have (`status.classes.unknown`), an element with no styles of its own
(`status.classes.nothingToMove`), no element of the type left without the class (`status.classes.noSimilar`), a locked
element (`status.locked.edit`). The buttons are drawn only while their command can run, so a refusal is met through the
command bar or a script, never a button that does nothing (src/core/design/classes.test.ts).

## style-suggestions

### Our rule

- Styles lists **Suggestions** (the plan's stage 7; journey M3, the same padding typed on every section): for each type
  of element with at least two elements on the project's pages, the declarations of the base breakpoint and state that
  every one of them holds with the same value, as "2 × Section share padding-top, padding-right…", the most elements
  first.
- **Make class .section** (`design.applySuggestion`, the first free name made of the type's): a new class holds those
  declarations, every element of the type lists it and keeps none of them of its own; one undo step. The suggestion is
  gone once nothing is shared any more.

### Refusals

A type that shares nothing any more (`status.suggest.none`), a name that is no class name or is taken, a locked
element (`status.locked.edit`).

## component-master-edit

### Our rule

- The master is edited through any of its instances (the plan's stage 7; journey D2): styles written on an element of
  an instance already reach the component and every instance (spec reusable-components); an instance's structure —
  elements added, removed or moved — is its own until **Update the component from this instance**
  (`components.updateFromInstance`, the context menu and the command bar, with one element of an instance selected).
- Then the instance becomes the component's definition, and every other instance takes its structure and styles,
  keeping its own texts, attributes and names wherever an element of the edited instance came from one it has; an
  element new to the edited instance reaches each other one as a copy (a new id, a name no element has). One undo step.
- Texts, images and links stay each instance's own: they are its properties.

### Refusals

Nothing of an instance selected (`status.components.notInstance`): the command is not offered.

## component-variants

### Our rule

- A component's variant is a class named after the component with the variant as a BEM modifier (component Plan,
  variant gold: `.plan--gold`), holding the styles in which the variant differs (the plan's stage 7; journey D2).
- With an element of an instance selected, Settings shows a **Component Plan** section with **Variant**
  (`components.setVariant`), offering the variants the project's classes give the component: the instance's root lists
  the chosen variant's class and no other variant of its component; a name the project lacks makes the variant (an
  empty class, styled with it as the target); an empty field takes every variant off. One undo step.

### Refusals

A name that is no variant name (`status.components.badVariant`: a letter, then letters, digits and dashes), a locked
instance (`status.locked.edit`).

## capture-url

### Our rule

- A browser page cannot read another site (CORS), so a capture goes through the **Builder Companion**, a local Node
  process started beside the editor (`npm run companion`; `tools/companion/server.ts`, on 127.0.0.1 only, port
  `COMPANION_PORT`, 5410 by default). It opens the address in the installed Chrome, waits for the network to rest,
  scrolls to the end so lazy content loads, stops animations and transitions, and reads the page as its scripts left
  it: the markup (scripts left out: their effect is already in it), every stylesheet in order (a linked one fetched
  whole, from any origin, its `@import`s laid in place (parsed as CSS rules, so a semicolon inside a quoted address
  does not cut the rule); a `<style>` as written), and the images, backgrounds and fonts
  they name, downloaded to `img/` and `fonts/` with every reference rewritten.
- **File › Open a web address…** (`workspace.openDialog`, dialog `capture-url`) asks for the address (a bare host is read
  as https), reminds that a captured site belongs to its authors, and says how the Companion is started. **Capture**
  (`project.captureUrl`) closes the dialog and sends the request; the status bar says it is capturing.
- The captured files go through **Import HTML** as if they had been picked (`project.importHtml`): its destinations
  dialog, then the page with its classes, its media queries as the project's breakpoints, its images and fonts.
- The Companion marks the captured page (`<meta name="builder-capture">`), and the import keeps, beside the classes and
  values it maps, what the model does not hold of its sheets: a rule whose selector it does not read (a descendant with
  a state, `:has()`, an attribute), an at-rule other than a media query a breakpoint takes (`@font-face`, `@keyframes`,
  `@layer`, `@supports`, a colour-scheme query), and a declaration the editor does not store (a custom property, a vendor
  prefix), in the page's residual stylesheet (`<page>.capture.css`). The canvas draws it and the export links it before
  the project's own stylesheet, so the page looks as it did and what the person edits in the inspector wins over it. A
  page that is no capture keeps none.
- The residual sheet declares the Builder's base layer before the site's own layers. The exported and canvas base
  styles use that lower-priority layer, so a captured site's layered rules such as an inherited link colour outrank
  Builder defaults, following the normal cascade order.
- When a captured sheet uses a width condition the project's breakpoints cannot represent (such as `min-width`, a
  non-pixel threshold or a width range), the properties used by that condition remain in the captured stylesheet at
  every width. The importer does not write competing base values for those properties into the project's later sheet;
  the original responsive cascade remains effective. A class with CSS escapes, such as `md\:block`, matches the
  unescaped name in the captured element's `data-capture-class` attribute.
- A link or a label that names no element of the captured page (one a script removed) is released, and the report
  says so (`status.import.released`), so the import is always a valid document.
- Shadow DOM is flattened: a host's open shadow root stands in its place, a slot holds the nodes assigned to it, and
  what the page does not draw there (a closed dropdown) comes hidden. A custom element (a tag with a dash) becomes a
  `div` wearing the class `ce-<tag>`; the page's rules for the tag and a shadow root's own rules are rewritten to that
  class, a shadow root's rules kept within their host (`:host` is the host, another selector a descendant of it).
- The import keeps the content of an element it does not know (it was dropped), takes the HTML `hidden` attribute as
  the element hidden (spec hide-element), ranks a rule by ids, then classes, then types (a class outweighs any number of
  types), and matches a descendant rule on every class the markup gave an element.
- **Pages of the site** (1 by default, at most 30): with more than one, the Companion follows the links of the page to
  other pages of the same site, breadth first, until it holds that many; each page lands at a path like its address
  (`/` index.html, `/plans/` plans/index.html), a stylesheet or an asset shared by several is downloaded once, and a
  link between two captured pages names the other page of the project. A count out of range is refused
  (`status.capture.badPages`).
- The capture's details that keep a page as it was drawn: an `<svg>`'s width and height become its size (presentation
  attributes, below every rule of the sheets), its viewBox supplies the intrinsic aspect ratio, and a viewBox other
  than its size keeps the drawing's coordinates; text inside its markup is escaped before it is parsed so visible
  angle brackets do not discard the drawing. An image's HTML width and height become low-priority size hints and its
  intrinsic ratio; a stylesheet can override either dimension. Rules aimed at the shapes and text inside an SVG stay
  in the residual stylesheet because those parts are markup of one editable SVG node, not separate model nodes. A
  piece of a text the page does not draw (a hidden short label) is no part of the text; the theme a page sets on its
  `<html>` (its classes and `data-` attributes) reaches its body; a page's Content Security Policy does not stop the
  capture. An anchor with an image, SVG or video becomes a Link Block, retaining its editable visual child. Ordinary
  HTML whitespace in text runs collapses to spaces, while an actual `<br>` remains a line break and preformatted text
  keeps its whitespace.
- A plain, attribute-free `<span>` containing only images releases its wrapper and keeps each image as an editable
  child. Image width and height attributes remain lower-priority hints: when a captured responsive stylesheet controls
  either dimension, the hint does not become a later generated rule that overrides it.
- An image-only `<span>` with classes or other attributes remains a children-bearing editable wrapper. Because the
  model's `span` is text-only, the wrapper uses the Div element's tag while retaining its author classes and attributes;
  its images and responsive class rules remain visible in the canvas and export.
- A runtime style on the page's `<html>` is kept as a last sheet when the capture reads it, since the project model has
  no root style attribute. A declaration of an author class still competes in the imported cascade (including its
  `!important` priority); if it wins, a lower-priority rule is not copied onto the element as its own style.
- **A page behind a login** (STG-12.4): the **Builder Capture** browser extension (`companion/extension`, built with
  `npm run extension:build`, loaded unpacked) reads the page of the person's own tab, logged in, with the same reading
  the Companion runs, and every file the copy needs with the person's credentials, and hands them to the Companion with
  the Companion's token (printed when it starts; the extension's options hold it). For ten minutes, **File › Open a web
  address…** with the tab's address is answered from that capture. A page without the token is refused.
- Not captured: pages beyond the count asked (their links stay absolute), what a script draws live (canvas, WebGL), the
  content of a frame from another origin.
- **The corpus** (`npm run capture:corpus`, the report `docs/CAPTURE-CORPUS.md`): twenty public sites recorded once
  into HAR files and replayed, captured, imported, exported and compared with the original at every breakpoint. A
  request recorded without a response is aborted during both original and capture replay; a pending stylesheet must
  not hold the page's `DOMContentLoaded` event open indefinitely. The
  plan's target, 98 % of pixels alike at every breakpoint, is not met (open: AUD-15, STG-12.6).

### Refusals

A text that is no http or https address (`status.capture.invalidUrl`), refused before any request. A Companion that does
not answer (`status.capture.noCompanion`) or a page it could not open (`status.capture.failed`, with its reason) is
said in the status bar.

## custom-fonts

### Our rule

- A font file in the project's tree (WOFF2, WOFF, TTF, OTF, EOT; an upload stores it in `fonts/`) is a family the
  project offers, known by its file's name without the folder or the extension (`fonts/Grao Display.woff2` is
  "Grao Display"; `src/core/files/fonts.ts`, the one owner).
- The canvas draws it and the export carries it: one `@font-face` per font file, `font-display: swap`, its `src` the
  file's path relative to the stylesheet, and the file at its path in the archive.

### Problems

1. **An uploaded font was offered only behind More values** (the audit's AUD-12, 2026-10-02, jornada03 J15: after
   uploading `GraoDisplay.ttf` the font menu's first list held 12 system stacks; the font came in the longer list of
   29). Required: the font menu's first list starts with the project's fonts, in the tree's order, before the system
   stacks, each drawn in its own face, in Essentials only and in All properties alike; More values adds the other
   suggestions after them (Webflow groups uploaded fonts as their own source, "Custom fonts").

## editor-shell

### Our rule

Required (manifest feature `editor-shell`):
- The window holds the top bar (full width: the app menus, the page switcher, the command bar, Undo and Redo, the save
  state, Preview and Export), the activity bar and the sidebar on the left, the canvas in the middle, the inspector on
  the right, the dock strip and its workbench under the canvas, and the status bar (full width) at the bottom; the
  product name comes from `src/config/product.ts`, in the top bar and the browser tab's title alike.
- The regions never overlap, together cover the window, and the window has no page scrollbar, at 1440 × 900 and at
  1920 × 1080; hiding a region (the inspector, the sidebar) gives its room to the canvas, and the canvas refits.
- The workbench under the canvas is closed by default and opens with a panel shown in it (the Timeline, the Checks,
  the code pane); panels added later open as tabs of the existing docks, so these regions stay the default layout.
- Below 1366 px the sidebar floats over the canvas (spec workspace-layout; the audit's AUD-06).
- A fresh profile opens with the Insert panel in the sidebar (the audit's AUD-21, jornada03 J26: the Explorer came first, a
  project's files before what the person can place), and that panel is called Insert everywhere: the activity bar, the
  View menu and its doors (`panel.elements`, "Inserir" in Portuguese).

## canvas-page-iframe

### Our rule

Required (manifest feature `canvas-page-iframe`):
- The canvas holds exactly one iframe, whose body renders the open page's root node of the document JSON; the
  document is the source of truth, never the frame's DOM (only the renderer writes it, `builder/frame-owner`).
- Inside the iframe the page is laid out at the active breakpoint's width (1440 CSS px at Desktop); the iframe is
  scaled with CSS zoom so that width fits the canvas's viewport, centred in it, beside the rulers' band along its top
  and left edges (spec rulers).
- The zoom in the status bar is the iframe's zoom factor, recomputed whenever the canvas changes size (a hidden
  inspector or sidebar, a resized window).

## elements-text

### Our rule

Required (manifest feature `elements-text`):
- The Insert panel's Text group places a Heading (h1–h6, h2 by default), a Paragraph, a Link, a Blockquote (holding a
  paragraph), a Preformatted block and a Divider, each with its default text and styles; there is no Badge.
- A Link keeps its address and "Open in a new tab", written as `target="_blank"` with `rel="noopener noreferrer"`; an
  unsafe address (one that runs code or carries a document inline: `javascript:`, `vbscript:`, `data:`, `blob:`, `file:`; core/elements/address.ts) is refused with words; `https:`, `mailto:` and `tel:` are taken, and a bare domain is stored as `https://…`.
- Preformatted keeps its line breaks and spaces; a Divider is a void element with no text.
- The export writes the same tags and attributes.

## elements-tables

### Our rule

Required (manifest feature `elements-tables`):
- The Insert panel offers Table alone: caption, head, body, foot, row, header cell and cell are its parts, never tiles.
- A new Table holds a head row of two header cells and a body of two rows of two cells.
- The Table's part toggles add and remove its caption, head and foot, each at its place (the caption first, the head
  before the body, the foot after it), one of each at most; the canvas and the export draw `caption`, `thead`, `tbody`,
  `tfoot`, `tr`, `th` and `td` in that valid order.

## elements-form-structure

### Our rule

Required (manifest feature `elements-form-structure`):
- The Forms group places a Form (with a labelled input), a Fieldset (with its Legend, which is no tile: one Legend, as
  its first child), a Label (with an input), a Button (with its text) and an Output, each with its attributes.
- A form's action and method are fields of Settings: an unsafe action and a method that is no keyword (get, post) are
  refused with words; a button's type is stored as chosen (submit, button, reset).
- A Link switched to a button and back keeps its text and styles; its address stays on the link and is not written on
  the button.
- Buttons and forms never navigate the editor when pressed on the canvas; the export writes the same tags and
  attributes (a button that says no type: submit inside a form, button elsewhere, spec export-clean).

## element-attributes-aria

### Our rule

Required (manifest feature `element-attributes-aria`):
- Settings' Attributes list adds, edits and removes the person's own attributes (aria-*, data-*, role and any valid
  name): they are stored in the document JSON and written by the canvas and the export, unlike the editor's own
  attributes, which the export never writes.
- An event handler attribute (`on…`) and a name that is no attribute name are refused with words.
- The Accessibility section's Role, Label for assistive readers (aria-label) and Hidden from assistive readers
  (aria-hidden) write their attributes; each change is one undo step.

## elements-form-inputs

### Our rule

Required (manifest feature `elements-form-inputs`):
- The Forms group places an input of each of the 14 types (text, email, password, number, tel, url, search, date, time,
  color, range, checkbox, radio, file), the canvas drawing each with its type.
- Settings stores an input's placeholder, value, name, pattern, min, max, step and autocomplete, and its required,
  disabled, readonly and checked switches, in the document JSON; the canvas and the export write them, and an input
  always says its type (spec export-clean).

## elements-form-controls

### Our rule

Required (manifest feature `elements-form-controls`):
- The Forms group places a Textarea (empty), a Select (with three options), a Progress and a Meter; option groups and
  options are a Select's parts, never tiles.
- A Select's options editor adds an option or an option group (with its option), moves an option up and down, removes
  it, marks the selected one and names a group; a Select takes only options and option groups, a group only options.
- A textarea's rows take a whole number, anything else is refused with words; every attribute is written by the canvas
  and the export.

## elements-interactive

### Our rule

Required (manifest feature `elements-interactive`):
- The Interactive group places a Details (with its Summary, which is no tile: exactly one, its first child) and a
  Dialog (modal, centred on the screen).
- Details' Open and Dialog's Open are stored; on the canvas a closed Details still shows its content while it or what
  it holds is selected, and a closed Dialog shows while selected; the export writes them closed unless set open.
- The export writes `details`/`summary` and `dialog`.

## templates-content

### Our rule

Required (manifest feature `templates-content`):
- The Templates group's content templates each place a whole valid subtree: a list (ul with three li), an ordered list
  (ol with three li), a definition list (dl with dt and dd), a table (thead with two th, tbody with two rows of two td),
  a form (two labelled inputs and a submit button), a select (three options) and a figure (an image and its caption).
- Every subtree passes the content model and exports with the same markup.
- The form template lays its fields out one under the other: the form a column at most 480 px wide, each label a
  column with its text above its field, the button at the start of its line.

## templates-sections

### Our rule

Required (manifest feature `templates-sections`):
- Card places an article with an image, a heading, a text and an action; Hero a section with a heading, a supporting
  line and two buttons in an actions row; Navbar a header with a brand, a nav of links and a button; Sidebar an aside
  with a heading and a list of links; Gallery a section with three figures.
- Each carries its default styles in the document JSON (Card: padding, radius, border; Hero: a large heading and
  generous padding; Navbar: a flex row with space between; Sidebar: a fixed width; Gallery: a three-column grid), which
  the export writes to the stylesheet, never as inline styles.

## templates-components

### Our rule

Required (manifest feature `templates-components`):
- Form group places labelled fields; Button group a row of buttons; Tabs a nav row of three tab buttons and a panel;
  Accordion two details with their summaries; Modal a dialog with a heading, its content and a close button.
- Each passes the content model and exports with the same markup; Tabs and Modal take their behaviour in the preview
  and the export (spec export-events-js).


## palette-search-groups

### Our rule

Required (manifest feature `palette-search-groups`):
- The Insert panel's groups are Structure and layout, Text, Images and media, Forms, Lists, Tables, Interactive and
  Templates, each with its count; the parts of composite elements (list items, table parts, options and option groups,
  sources, tracks, captions, the legend, the summary, SVG shapes) are not listed.
- Searching filters the tiles by label and tag ("inp" shows the 14 input types); the footer reads "N of M elements
  match" (`palette.search.matchCount`, M the panel's entries), and a search with no match says "No element matches
  "…"" (`palette.search.noMatch`).
- A collapsed group stays collapsed after a reload (`palette.toggleGroup`, kept in the workspace).

## palette-density

### Our rule

Required (manifest feature `palette-density`):
- The Insert panel lays its tiles out at the chosen density (`palette.setDensity`): a list (one per row, with its tag),
  two or three columns, or icons only (the label as the tooltip); the measured tile sizes change accordingly.
- The density is kept in the preferences and restored after a reload.

## layers-search

### Our rule

Required (manifest feature `layers-search`):
- The Layers' search (`layers.search`) shows only the rows whose name, tag, id or class matches what is typed, with
  their ancestors for context and the match marked; a search nothing matches says so.
- A press on a result selects its element (`selection.select`); clearing the search brings back the folds the tree had.

## layers-row-columns

### Our rule

Required (manifest feature `layers-row-columns`):
- The Layers' row details (`layers.setRowDetails`) show beside each name the details chosen: its HTML tag, its id, its
  classes, its attributes, each on or off.
- The choice is kept in the preferences and restored after a reload.

## layers-row-colours

### Our rule

Required (manifest feature `layers-row-colours`):
- A row's colour (`element.setLayerColor`) tints the row and the element's selection outline on the canvas; it is kept
  with its page in the document JSON (the page root's `layerColors`), restored after a reload, and never exported.
- The colour drawn is the one the palette's token stands for: a swatch keeps the token's name (`--color-canvas-margin`,
  the same in every theme), and the row's line, its dot and the canvas outline draw the token, never its bare name,
  which is no colour (LC2: they fell back to the text's ink, and the check that compared the line with the outline
  passed on two inks alike; the test now asks for the token's own colour).

## embed-html

### Our rule

Required (manifest feature `embed-html`):
- An Embed (`element.setEmbedMarkup`) keeps its markup as typed, drawn sandboxed on the editing canvas, where its
  scripts never run; the preview runs it; the export writes it verbatim at its place; the Layers mark it as an embed.
- A locked element refuses the change (`status.locked.edit`), and an element that is no embed is said not to take it
  (`status.element.notApplicable`).

## workspace-persist-reset

### Our rule

Required (manifest feature `workspace-persist-reset`):
- The workspace (which panels are open and where, the docks' and splitters' sizes, the inspector's open sections) is
  kept apart from the document and restored after a reload exactly as it was left.
- Reset workspace (`workspace.reset`) puts back the default docks, sizes and panels and says so in the status bar; the
  document JSON and the history are untouched.

## html-import-cleaning

### Our rule

1. **Import cleaning.** Required (`html-import-cleaning`): scripts are not dropped — each is kept with its page (its code, or its `src` as a project file or as an address the page lists), never run on the editing canvas, written back by the export, and listed in the report; event handler attributes (`on…`) are removed and listed; unknown elements are unwrapped into their children; structures the editor cannot hold are repaired (a stray `li` gets a `ul`) or dropped; the resulting document always passes the content model; an import report lists everything that was dropped, unwrapped, repaired or kept, with the source line.

## html-import-styles

### Our rule

1. **The styles of the imported page.** Required (`html-import-styles`): the import takes several files at once; a linked stylesheet is found by its path among the picked files; `style` attributes, `<style>` blocks and linked stylesheets' declarations are resolved by specificity and order (importance, inline, specificity, then order) and become each element's styles in the document JSON, so the computed styles of every element in the canvas match the original file opened in Chrome; a linked stylesheet that was not picked is listed in the report; a declaration of a property the editor does not edit is listed in the report and left out.

## html-import-media-queries

### Our rule

1. **Media queries.** Required (`html-import-media-queries`): a `max-width` rule whose width is a breakpoint's becomes an override of that breakpoint; another width maps to the nearest breakpoint at or below it and is reported; rules that cannot be mapped (`min-width`, `orientation`, `print`) are listed in the report; at each breakpoint the computed styles in the canvas equal the original's.

## html-import-states

### Our rule

1. **Pseudo-class rules.** Required (`html-import-states`): each supported pseudo-class rule (`:hover`, `:focus`, `:active`, `:disabled`, `:invalid`, `:placeholder-shown`, `:first-child`, `:last-child`, `:focus-visible`, `:visited`) becomes a state style of the matching element, at its breakpoint; in preview, hovering an imported element shows its hover styles; a selector that cannot be mapped to single elements (a descendant rule, `@supports`, `::before`, an unsupported pseudo-class) is listed in the report.

## html-import-roundtrip

### Our rule

1. **Exported pages import back.** Required (`html-import-roundtrip`): importing the ZIP the export wrote imports its pages together with their linked stylesheets and scripts as a whole; the imported document equals the original in tag structure, texts, attributes and styles per breakpoint and state (element types that share a tag are compared by tag); element names are recovered from their BEM classes, so a second export writes the same pages and the same rules again. Names recovered from generated classes may repeat in different BEM blocks: `header__cardapio` and `footer__cardapio` both name a Cardapio layer, while insertion of a new element still takes a unique name. A generated script linked in the head stays after the stylesheet with `defer` on a second export. The ZIP of `canonical.json` exports byte for byte alike after import. Ids and editor-only data (locks, guides, grid settings, saved colours) are not compared.
2. **A single author class on an unstyled element.** The stylesheet heading `/* Classes */` identifies a class of the person's even when only one unstyled element lists it. The import keeps its project definition and the element's class list, leaves the element's own styles empty, and writes the same HTML, CSS and ZIP on the second export (RT1). Plain HTML without that heading remains ambiguous (`class="card"` and one `.card` rule can describe either kind of style); it uses the importer's prior heuristic.

## code-panel-view

### Our rule

Required (manifest feature `code-panel-view`):
- The canvas toolbar's views (`view.setEditorView`): Canvas draws no code pane, Split draws the canvas and the pane
  side by side, Code draws the pane alone.
- The pane's tabs (`codePanel.setPane`) show the open page's HTML, the stylesheet and the scripts, with line numbers and
  syntax colouring, each exactly the text the export writes, updated after every command.
- A code file's tab over the canvas (`files.open#file-tab`) is the current one, and its close button with it, only while
  its file shows: the active file in the Code view or in Split. Over the canvas alone the page's tab is current, the
  code files' tabs stay open and unmarked (FT1: every open file's tab was drawn current beside the page's).

## code-panel-copy-download

### Our rule

Required (manifest feature `code-panel-copy-download`):
- Copy (`codePanel.copyPane`) puts exactly the open tab's text on the clipboard and names the file in the status bar;
  Download (`codePanel.downloadPane`) hands out the open file itself (the page's HTML, `css/styles.css`, a script) with
  exactly the content shown.

## code-panel-edit-css

### Our rule

Required (manifest feature `code-panel-edit-css`):
- Applying the CSS pane's rule (`style.applyCssRule`) replaces the selected element's styles at the active breakpoint
  and state with the declarations of its rule, as one undo step; the inspector and the canvas follow.
- A line that is no declaration, a property the editor does not write, or a value it cannot take is refused with the
  line and the reason (`status.css.notDeclaration`, `status.css.unknownProperty`, `status.css.badValue`), and a locked
  element refuses (`status.locked.edit`); the document is then unchanged.

## code-panel-edit-html

### Our rule

Required (manifest feature `code-panel-edit-html`):
- Applying the HTML pane's markup (`element.applyHtml`) reads it with the HTML importer's rules and replaces the
  selected element's subtree as one undo step; the canvas, the Layers and the inspector follow, and nodes that did not
  change keep their ids, names and styles.
- Markup that cannot be read is refused with the line and the reason (`status.html.invalidAt`), and markup that breaks
  the content model with the content model's own refusal; a locked element refuses; the document is then unchanged.


## timeline-animations

### Our rule

Required (manifest feature `timeline-animations`):
- The Timeline (a tab of the workbench) lists the selected element's animations over a time ruler.
- A new animation (`animation.create`) is stored on the element with a name unique in the project (its @keyframes
  name), a 1 s duration and keyframes at 0 % and 100 %; a taken name or one that is no CSS identifier is refused with
  words (`status.animation.nameTaken`, `status.animation.nameInvalid`).
- Rename and delete (`animation.rename`, `animation.delete`) are one undo step each; a deleted animation leaves no
  animation property on the element; a locked element refuses every change (`status.locked.edit`).

## timeline-animation-settings

### Our rule

Required (manifest feature `timeline-animation-settings`):
- An animation's duration, delay, repeat count, direction and fill (`animation.setSettings`) are stored with it in the
  document JSON; a value a setting cannot take is refused with words (`status.animation.invalidSetting`) and the
  document is unchanged.
- An animation has no trigger of its own: it plays on load, or when an interaction plays it (spec export-events-js).

## export-keyframes

### Our rule

Required (manifest feature `export-keyframes`):
- The stylesheet holds each animation's `@keyframes` with every keyframe and its values, and the animation properties
  on the element's base rule, so it plays when the page loads; a `@media (prefers-reduced-motion: reduce)` block turns
  the animations off, written only when the page has animations (a page without any exports exactly as before).
- In the exported page the element's computed `animation-name` is the animation's name, and two exports are
  byte-identical.

## export-events-js

### Our rule

Required (manifest feature `export-events-js`):
- The archive holds the plain JavaScript file `js/interactions.js` (no framework, no inline handler), linked with
  `<script defer>` from every page that uses interactions; a page without interactions exports exactly as before.
- The script addresses its targets by their BEM class or the person's own id, never by editor ids or data attributes.
- An animation an event plays gets a class rule beside its `@keyframes`, which the script adds when the event fires; it
  no longer plays on load.
- The preview runs every interaction as the exported page does; in the exported page opened in Chrome every trigger
  performs its action (checked by class, computed style or scroll position).
- An interaction's Options are the script's: an action that waits runs in a `setTimeout` of its delay; one that fires
  once runs the first time only (a submit is still kept on the page every time, a hover's leave runs once after its
  enter); one that enters the screen every time runs each time the element comes back into view (half of it visible).
- An action acts on the element its interaction names, else on the element itself: it never reads a target the script
  did not declare (the script runs in strict mode, where that throws: an animation an element played on itself never
  played in the exported page, and a page-load one stopped every interaction after it).

## export-multi-page

### Our rule

Required (manifest feature `export-multi-page`):
- The archive holds every page at its path in the file tree (`index.html`, `company/about-us.html`) and one shared
  `css/styles.css`.
- A link chosen with the link picker is written relative to the two files' paths (`company/about-us.html` from
  `index.html`, `../index.html` back), and follows a moved page.
- Each page file has its own title, lang and dir, and links the shared stylesheet by a path relative to its folder.

## export-file-tree

### Our rule

Required (manifest feature `export-file-tree`):
- The archive holds exactly the Explorer's tree: every folder and file at its path, the pages generated from the
  document, the CSS in its own file with BEM classes, the generated scripts at the paths the file tree keeps free
  (spec explorer-file-system 2).
- Links between pages and to files (stylesheets, scripts, images) are written relative to their paths, so they follow a
  moved or renamed file; two exports without a change are byte-identical.

## export-assets

### Our rule

Required (manifest feature `export-assets`):
- The archive holds every file of the tree at its path, byte for byte as uploaded, an unused image included; an image's
  `src` is a relative path to its file, so the exported page shows it.

## explorer-open-folder

### Our rule

Required (manifest feature `explorer-open-folder`):
- File › Open folder (`project.openFolder`) reads a folder with Chrome's directory picker, and every file lands at the
  same path in the project, except one whose path belongs to a generated file (css/styles.css and the export's scripts,
  spec explorer-file-system 2): it is kept under a free name (`css/styles-1.css`) and the report lists it.
- The HTML pages go through the HTML importer: the stylesheets they link are read from the folder into the document's
  styles (the document JSON is the source of truth); each page becomes a page named after its file, at its path
  (`about/index.html` is the page index in the folder about), the root `index.html` the home page — a folder without
  one gets an empty home page, which the report lists; the original .css files stay as files no page links any more,
  and the report says so; scripts, images and fonts are kept as files. A folder without any HTML page is refused.
- Opening a folder replaces the project after asking, as File › Open does; the export right after reproduces the same
  folder structure.

## code-panel-edit-js

### Our rule

Required (manifest feature `code-panel-edit-js`):
- A script opens in the code pane with line numbers and syntax colouring; saving (`files.saveContent`) writes the file in
  the project as one undo step; a generated script (the export's, spec explorer-file-system 2) opens read-only and is
  never written (`status.files.generatedPath`).
- A script with a syntax error is refused with the line and the reason (`status.js.invalidAt`) and kept as typed.
- A page links the scripts its setting lists (`page.setSetting`): the preview runs them and reloads after each save,
  the editing canvas never runs them, and the export writes the files unchanged and links them from their pages.
- Deleting a script a page links, or a folder that holds one, is refused, naming those pages (`status.files.linkedBy`).
