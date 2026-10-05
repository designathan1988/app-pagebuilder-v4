// The curve of an easing field (the plan's stage 3, "editor de curva para aceleração"; spec easing-curve): beside a
// field that holds an easing (a keyframe's, a motion action's), a button opens a layer that draws the easing as its
// curve, offers the ready-made easings each drawn as its own curve, and edits a cubic Bézier by its two control
// points (four numbers, the curve redrawn as they change). Choosing a curve runs the field's own door with it, as
// typing it would; opening the layer and typing in it change nothing (archive/DESIGN.md "What is not a command"). The
// one reader of an easing's text is core/motion/easing.ts, so the curve drawn is the curve the page runs.
import { useMemo, useRef, useState } from 'react';
import { createEasing, type ParsedEasing } from '../../core/motion/easing.ts';
import { Icon } from '../doors/door.tsx';
import { useT } from '../text.ts';
import { Popover, usePopover } from './popover.tsx';

const EASING = createEasing();
// the duration a spring is drawn over (a spring's curve depends on the time it runs)
const DRAWN_MS = 600;
// how many points draw a curve
const SAMPLES = 48;
// the room above and below the unit square, for a curve that overshoots (a back-out, a spring)
const MARGIN = 0.4;

// The SVG path of an easing's curve in a box of `size`, progress along x and output up y, or null for no easing.
function curvePath(easing: ParsedEasing | null, size: number): string | null {
  if (easing === null) return null;
  const span = 1 + 2 * MARGIN;
  const point = (i: number) => {
    const x = i / SAMPLES;
    const y = EASING.sample(easing, x, DRAWN_MS);
    return `${(x * size).toFixed(1)},${(((1 + MARGIN - y) / span) * size).toFixed(1)}`;
  };
  return `M${Array.from({ length: SAMPLES + 1 }, (_, i) => point(i)).join(' L')}`;
}

function EasingCurve({ text, size, label }: { readonly text: string; readonly size: number; readonly label?: string }) {
  const path = useMemo(() => curvePath(EASING.parse(text), size), [text, size]);
  const span = 1 + 2 * MARGIN;
  const top = (MARGIN / span) * size;
  const bottom = ((1 + MARGIN) / span) * size;
  return (
    <svg className="easing-curve" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label === undefined ? undefined : 'img'} aria-label={label} aria-hidden={label === undefined ? true : undefined}>
      <rect className="easing-curve__square" x={0} y={top} width={size} height={bottom - top} />
      {path === null ? null : <path className="easing-curve__line" d={path} />}
    </svg>
  );
}

// the control points a Bézier editor starts from: the easing's own (a keyword's included), else ease's
function pointsOf(text: string): readonly [number, number, number, number] {
  const parsed = EASING.parse(text);
  return parsed?.points ?? EASING.parse('ease')?.points ?? [0.25, 0.1, 0.25, 1];
}
const written = (n: number) => String(Math.round(n * 100) / 100);

export function EasingCurveButton({ value, label, disabled, run }: { readonly value: string; readonly label: string; readonly disabled: boolean; readonly run: (easing: string) => void }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(trigger);
  return (
    <>
      <button ref={trigger} type="button" className="easing-curve__button" aria-haspopup="dialog" aria-expanded={open} title={t('easing.edit', { field: label })} aria-label={t('easing.edit', { field: label })} disabled={disabled} onClick={() => setOpen((was) => !was)}>
        <EasingCurve text={value === '' ? 'ease' : value} size={16} />
      </button>
      {open ? (
        <Popover anchor={trigger} className="easing-popover" label={t('easing.title')} onDismiss={() => setOpen(false)}>
          <EasingChooser
            value={value}
            run={(easing) => {
              setOpen(false);
              run(easing);
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}

function EasingChooser({ value, run }: { readonly value: string; readonly run: (easing: string) => void }) {
  const t = useT();
  const [points, setPoints] = useState<readonly string[]>(() => pointsOf(value).map(written));
  const bezier = `cubic-bezier(${points.join(', ')})`;
  const valid = EASING.parse(bezier) !== null;
  const names = ['x1', 'y1', 'x2', 'y2'] as const;
  return (
    <div className="easing-popover__body">
      <span className="easing-popover__heading">{t('easing.presets')}</span>
      <div className="easing-popover__presets" role="group" aria-label={t('easing.presets')}>
        {EASING.presets.map((preset) => (
          <button key={preset} type="button" className={`easing-preset${preset === value ? ' is-current' : ''}`} title={preset} aria-label={t('easing.use', { easing: preset })} onClick={() => run(preset)}>
            <EasingCurve text={preset} size={32} />
            <span className="easing-preset__name">{preset.replace(/\(.*$/, '')}</span>
          </button>
        ))}
      </div>
      <span className="easing-popover__heading">{t('easing.bezier')}</span>
      <div className="easing-popover__bezier">
        <EasingCurve text={valid ? bezier : value} size={96} label={bezier} />
        <form
          className="easing-popover__points"
          onSubmit={(event) => {
            event.preventDefault();
            // the layer is drawn on the body but stands in the field's form in React's tree: its submit is its own
            event.stopPropagation();
            if (valid) run(bezier);
          }}
        >
          {names.map((name, i) => (
            <label key={name} className="easing-popover__point">
              <span>{name}</span>
              <input
                className="input"
                inputMode="decimal"
                spellCheck={false}
                value={points[i]}
                aria-label={t('easing.point', { point: name })}
                onChange={(event) => {
                  const next = [...points];
                  next[i] = event.target.value;
                  setPoints(next);
                }}
              />
            </label>
          ))}
          <button type="submit" className="door door--button" disabled={!valid}>
            <Icon name="check" size="sm" />
            <span className="door__label">{t('easing.apply')}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
