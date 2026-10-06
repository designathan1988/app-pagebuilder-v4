// The anchor tabs of a positioned selection (spec absolute-anchors): four round tabs just outside the middle of each
// edge of the one selected element while it is absolute or fixed, each the canvas-handle door of its edge
// (position.setAnchors, toggle): a click toggles the anchor on that edge; an anchored edge's tab is drawn filled. They
// are drawn over the stage, beside the page's overlay (a press there is the canvas's), placed at every frame as the
// element moves with a scroll or a zoom, and never covered by other canvas chrome (Problems in Pager 3): the top tab
// moves right, past the selection's label and the quick panel's chip, which never move (DEC-70), when it would meet
// them. The rotation zones give way to the tabs (the arrangement of the canvas controls, arrangement.ts, DEC-75): a tab
// that also moved for a zone moved the zone, which moved the tab, and both never stood still.
import { useEffect, useState, type RefObject } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { locate, type NodeId } from '../../core/document/model.ts';
import { valuePredicateHolds } from '../../core/style/couplings.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { manifest, numberConstant } from '../../manifest/runtime.ts';
import { DoorControl } from '../doors/door.tsx';
import { MODEL_RULES, useEditorState } from '../store.ts';
import { canvasFrame, nodeBox } from './coordinates.ts';

// the tabs: the canvas-handle doors of the anchor-tab gesture, one per edge, in the manifest's order
const TABS = manifest.doors.filter((d) => d.door.kind === 'canvas-handle' && d.door.gesture === 'anchor-tab');
const SIZE = numberConstant('anchors.tabSize');
const POSITIONED = 'positionedSelection';
type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// where each tab goes around an element's box, in the stage: the side its handle names, just outside its middle
function placeTabs(element: Box, gap: number, chrome: readonly Box[]): readonly Box[] {
  const middleX = element.x + element.width / 2 - SIZE / 2;
  const middleY = element.y + element.height / 2 - SIZE / 2;
  // the tabs in the manifest's order: the left edge's, the right's, the top's, the bottom's
  const sides = [
    { x: element.x - gap - SIZE, y: middleY },
    { x: element.x + element.width + gap, y: middleY },
    { x: middleX, y: element.y - gap - SIZE },
    { x: middleX, y: element.y + element.height + gap },
  ];
  return TABS.map((_, i) => {
    const at = sides[i] ?? { x: middleX, y: middleY };
    let box: Box = { ...at, width: SIZE, height: SIZE };
    // past every piece of chrome it would meet, to its right, until it meets none
    for (let moved = true, rounds = 0; moved && rounds <= chrome.length; rounds += 1) {
      moved = false;
      for (const other of chrome) {
        if (!meets(box, other)) continue;
        box = { ...box, x: other.x + other.width + gap };
        moved = true;
      }
    }
    return box;
  });
}

export function AnchorTabs({ stage }: { readonly stage: RefObject<HTMLDivElement | null> }) {
  const built = TABS.length > 0 && TABS.every((entry) => isFeatureBuilt(entry.door.feature as FeatureId));
  const id = useEditorState((s) => {
    const [only, ...others] = s.selection;
    const node = only === undefined || others.length > 0 ? null : (locate(s.document, only)?.node ?? null);
    return node !== null && valuePredicateHolds(node, POSITIONED, MODEL_RULES) ? node.id : null;
  });
  const [placed, setPlaced] = useState<readonly Box[] | null>(null);
  useEffect(() => {
    if (!built || id === null) return;
    let request = 0;
    const measure = () => {
      const area = stage.current;
      const frame = canvasFrame();
      const box = frame ? nodeBox(frame, id as NodeId) : null;
      if (area && box) {
        const origin = area.getBoundingClientRect();
        const inStage = (r: DOMRect): Box => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height });
        const chrome = [...area.querySelectorAll('[data-chrome="label"], .quick-panel-chip')].map((el) => inStage(el.getBoundingClientRect()));
        const gap = parseFloat(getComputedStyle(area).getPropertyValue('--space-4')) || 0;
        const next = placeTabs({ x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }, gap, chrome);
        setPlaced((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [built, id, stage]);
  if (!built || id === null || placed === null) return null;
  return (
    <>
      {TABS.map((entry, i) => {
        const box = placed[i];
        return box === undefined ? null : (
          <span key={entry.ref} className="anchor-tab-place" style={{ left: box.x, top: box.y, width: SIZE, height: SIZE }}>
            {/* a toggle: it says whether its edge is anchored (the audit's U-051: no pressed state, so "Anchor left" on an
                edge anchored by default turned it to the right unannounced) */}
            <DoorControl entry={entry} className="anchor-tab" toggle>
              <span className="anchor-tab__dot" />
            </DoorControl>
          </span>
        );
      })}
    </>
  );
}
