// The breakpoints side by side (canvas-side-by-side; spec side-by-side-view): while the
// switch is on (view.toggleSideBySide, a preference), the project's other breakpoints are drawn to the right of the
// stage, up to three, the nearest in width to the one edited first. Each is a live page at its breakpoint's width,
// scaled to its column: its own renderer (editor/canvas/render/render.ts) mounted in its own frame follows every
// change of the
// document, so each shows the page through its own media queries; the selection is outlined in each. Nothing in a
// side frame is edited in place: a click on it makes its breakpoint the one the canvas edits (view.setBreakpoint),
// and the frame it leaves takes its place here.
import { breakpointsOf } from '../../core/document/breakpoints.ts';
import { SideFrame } from '../canvas/side-frame.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState } from '../store.ts';
import { useT } from '../text.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';

const REGION = 'canvas-side-by-side';
// the side frames' door: the breakpoint switch, standing for the frame's breakpoint
const FRAME = doorSlots(REGION)[0];
// how many side frames at most
const MOST = 3;

export function SideBySide() {
  const t = useT();
  const on = useEditorState((s) => s.ui.preferences.sideBySide === true);
  const table = useEditorState((s) => breakpointsOf(s.document));
  const edited = useEditorState((s) => activeBreakpoint(s));
  if (!on || FRAME === undefined) return null;
  const others = table
    .filter((b) => b.id !== edited.id)
    .sort((a, b) => Math.abs(a.width - edited.width) - Math.abs(b.width - edited.width))
    .slice(0, MOST)
    .sort((a, b) => b.width - a.width);
  return (
    // every frame takes an equal share of the width: the edited one, on the stage, and each side frame
    <aside className="side-by-side" data-region={REGION} aria-label={t('sideBySide.label')} style={{ flexGrow: others.length }}>
      {others.map((breakpoint) => (
        <SideFrame key={breakpoint.id} entry={FRAME} breakpoint={breakpoint} />
      ))}
    </aside>
  );
}
