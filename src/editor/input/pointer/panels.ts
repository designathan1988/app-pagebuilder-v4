// The presses on the panels' own controls (plan I.12): the colour area, a held repeat, a light pad, a panel's grip
// and hint, a column part, a timeline's playhead, keyframes and stops, the explorer's and the Layers rows, a number
// field's scrub.
import type { CommandId, DoorId } from '../../../generated/ids.ts';
import { manifest } from '../../../manifest/runtime.ts';
import type { Point } from '../../canvas/coordinates.ts';
import { panelHintAt, showPanelHint } from '../../workspace/panel-drag.ts';
import { formatColor, hsbToRgb, pickedAlpha } from '../../../core/style/color.ts';
import { offsetFromTrackX, playheadTimeFromTrackX, shownAnimation } from '../../timeline/playhead.ts';
import { scrubModifier } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerPanels(p: PointerOwner): Pick<PointerOwner, 'pickColor' | 'stopRepeating' | 'moveLight' | 'moveGrip' | 'partUnder' | 'moveColumn' | 'movePlayhead' | 'moveKeyframe' | 'folderUnder' | 'moveExplorer' | 'moveLayer' | 'movePanelHint' | 'moveStop' | 'scrub'> {
  const { shared, ps, store } = p;
  // the colour at a point of the area: the hue and alpha it shows (data-hue, data-alpha), the saturation across and the
  // brightness down, written with the area's door (style.set) for its property through the session
  const pickColor = (area: HTMLElement, x: number, y: number) => {
    const box = area.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || shared.session === null) return;
    const s = Math.min(1, Math.max(0, (x - box.left) / box.width));
    const v = 1 - Math.min(1, Math.max(0, (y - box.top) / box.height));
    // a pick that keeps the alpha writes it opaque when the colour the picker shows is fully transparent (item 6.5)
    const shown = Number(area.dataset.alpha ?? '1');
    const value = formatColor(hsbToRgb({ h: Number(area.dataset.hue ?? '0'), s, v, a: pickedAlpha(shown, shown) }));
    const entry = manifest.doorByRef.get((area.getAttribute('data-door') ?? '') as DoorId);
    if (!entry) return;
    shared.session.dispatch(entry.command.id as CommandId, { ...entry.door.args, property: area.dataset.property ?? '', value } as never);
  };
  const stopRepeating = () => {
    if (ps.repeating === null) return;
    window.clearTimeout(ps.repeating.timer);
    window.clearInterval(ps.repeating.timer);
    ps.repeating = null;
  };
  // The light follows the pointer from the press on: X and Y are the pointer's offset from the pad's centre, whole
  // pixels, set anew at every move (the gesture cancelled back to the shadow before the press and opened again); the
  // release keeps them, one undo step; Escape puts them back.
  const moveLight = (at: Point) => {
    if (ps.lighting === null) return;
    const { press, startX } = ps.lighting;
    shared.open?.cancel();
    shared.open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown>), x: `${Math.round(at.x - press.centre.x)}px`, y: `${Math.round(at.y - press.centre.y)}px` };
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit, distance: at.x - startX } as never);
  };
  // The panel follows the pointer from the press on: its offset from its element is the one it was drawn at plus the
  // pointer's travel, set anew at every move (the gesture cancelled back and opened again); the release keeps it (not
  // an undo step); Escape puts it back.
  const moveGrip = (at: Point) => {
    if (ps.gripping === null) return;
    const { press, start } = ps.gripping;
    shared.open?.cancel();
    shared.open = store.gesture();
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, offset: { x: press.base.x + at.x - start.x, y: press.base.y + at.y - start.y }, distance: at.x - start.x } as never);
  };
  const partUnder = (at: Point): HTMLElement | null => {
    const under = document.elementFromPoint(at.x, at.y);
    return under instanceof Element ? under.closest<HTMLElement>('[data-data-target]') : null;
  };
  const moveColumn = (at: Point): void => {
    if (ps.columning === null) return;
    const part = p.partUnder(at);
    const stands: unknown = part === null ? null : JSON.parse(part.getAttribute('data-args') ?? 'null');
    const over = stands !== null && typeof stands === 'object' && typeof (stands as { node?: unknown }).node === 'string' && typeof (stands as { to?: unknown }).to === 'string' ? { node: (stands as { node: string }).node, to: (stands as { to: string }).to } : null;
    if (JSON.stringify(over) === JSON.stringify(ps.columning.over)) return;
    ps.columning = { ...ps.columning, over };
    document.querySelectorAll('[data-data-target].is-over').forEach((el) => el.classList.remove('is-over'));
    part?.classList.add('is-over');
  };
  const movePlayhead = (at: Point) => {
    if (ps.playheading === null) return;
    const { press, startX } = ps.playheading;
    const shown = shownAnimation(store.getState());
    if (shown === null) return;
    const time = playheadTimeFromTrackX(shown.animation, at.x - press.track.left);
    shared.open?.cancel();
    shared.open = store.gesture();
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, time, distance: at.x - startX } as never);
  };
  const moveKeyframe = (at: Point) => {
    if (ps.keyframing === null) return;
    const { press, startX } = ps.keyframing;
    const offset = offsetFromTrackX(at.x - press.track.left);
    shared.open?.cancel();
    shared.open = store.gesture();
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, offset, distance: at.x - startX } as never);
  };
  const folderUnder = (at: Point): HTMLElement | null => {
    const under = document.elementFromPoint(at.x, at.y);
    return under instanceof Element ? under.closest<HTMLElement>('[data-folder]') : null;
  };
  const moveExplorer = (at: Point): void => {
    if (ps.exploring === null) return;
    const over = p.folderUnder(at)?.getAttribute('data-folder') ?? null;
    if (over === ps.exploring.over) return;
    ps.exploring = { ...ps.exploring, over };
    document.querySelectorAll('[data-folder].is-over').forEach((el) => el.classList.remove('is-over'));
    if (over !== null) document.querySelector(`[data-folder="${CSS.escape(over)}"]`)?.classList.add('is-over');
  };
  const moveLayer = (at: Point) => {
    if (ps.layering === null) return;
    const { press } = ps.layering;
    const inside = press.rows.findIndex((r) => at.y >= r.top && at.y <= r.bottom);
    const to = inside === -1 ? (at.y < (press.rows[0]?.top ?? 0) ? 0 : press.rows.length - 1) : inside;
    if (to === press.index) return;
    shared.open?.cancel();
    shared.open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown> | undefined), move: { from: press.index, to } };
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit } as never);
  };
  // A dragged panel's hint follows the pointer from the press on: where the panel would land is what the hint draws
  // (workspace/panel-drag.ts), and the release runs that place's door. Nothing is dispatched while dragging.
  const movePanelHint = (at: Point) => {
    if (ps.panelling === null) return;
    showPanelHint(panelHintAt(at.x, at.y, ps.panelling.press.panel));
  };
  // The stop follows the pointer along its bar from the press on: every move sets its position anew (the gesture
  // cancelled back to the gradient before the press and opened again), a whole per cent from 0 to 100; the release
  // keeps it, one undo step; Escape puts it back.
  const moveStop = (at: Point) => {
    if (ps.stopping === null) return;
    const { press, startX } = ps.stopping;
    const position = Math.round(Math.min(100, Math.max(0, ((at.x - press.bar.left) / press.bar.width) * 100)));
    shared.open?.cancel();
    shared.open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown>), stop: press.index, position };
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit, distance: at.x - startX } as never);
  };
  // The scrub follows the pointer: every move scrubs anew from the value held before the press, so the gesture is
  // cancelled (back to that value) and opened again with the pointer's travel and the key held now.
  const scrub = (at: Point, modifier: string | null) => {
    if (ps.scrubbing === null) return;
    const { press, startX } = ps.scrubbing;
    const held = scrubModifier(press.entry, modifier);
    shared.open?.cancel();
    shared.open = store.gesture();
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, value: press.value, distance: at.x - startX, ...(held !== null ? { modifier: held } : {}) } as never);
  };
  return { pickColor, stopRepeating, moveLight, moveGrip, partUnder, moveColumn, movePlayhead, moveKeyframe, folderUnder, moveExplorer, moveLayer, movePanelHint, moveStop, scrub };
}
