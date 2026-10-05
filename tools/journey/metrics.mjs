import { summarize } from '../perf/metrics.ts';
// Formula-compatible with jornada03/scripts/analyze.mjs. No synthetic subjective scores.
const REFUSAL = /refused|recusad|cannot|não pode|not a value|não é um valor|nothing matches|nenhum elemento corresponde|não é um arquivo|needs a single|select an element first|selecione um elemento/i;
const validate = (g) => { if (!g || typeof g !== 'object' || Object.values(g).some(n => !Number.isInteger(n) || n < 0)) throw new Error('Gesture counters must be nonnegative integers'); return g; };
export const pointerCount = (g = {}) => ['click', 'dblclick', 'rightclick', 'drag', 'wheel'].reduce((n, k) => n + (validate(g)[k] ?? 0), 0);
const committed = (r) => r.historyAtEnd ? Math.max(0, r.historyAtEnd.undoSteps - (r.historyAtStart?.undoSteps ?? 0)) : null;
const klm = (pointer, keys) => Math.round((1.3 * pointer + 0.28 * keys) * 10) / 10;
export const percentiles = summarize;
export function expertRate(records) {
  const usable = records.filter((r) => r.result !== 'invalid' && (committed(r) ?? 0) > 0);
  const changes = usable.reduce((sum, r) => sum + committed(r), 0);
  return { pointer: changes ? usable.reduce((s, r) => s + pointerCount(r.gestures), 0) / changes : null,
    keys: changes ? usable.reduce((s, r) => s + (r.gestures.keys ?? 0), 0) / changes : null,
    commits: changes, runs: usable.map((r) => r.id) };
}
export function score(record, rate = null) {
  const pointer = pointerCount(validate(record.gestures));
  const keys = record.gestures?.keys ?? 0;
  const changes = committed(record);
  const floorPointer = rate?.pointer != null && changes > 0 ? Math.max(1, Math.round(changes * rate.pointer)) : null;
  const floorKeys = rate?.keys != null && changes > 0 ? Math.round(changes * rate.keys) : null;
  const expertKlm = floorPointer === null || floorKeys === null ? null : klm(floorPointer, floorKeys);
  return { id: record.id, persona: record.persona, result: record.result, wallSeconds: record.seconds,
    pointer, keys, committed: changes, undos: record.undos ?? 0,
    refusals: (record.messages ?? []).filter((m) => REFUSAL.test(typeof m === 'string' ? m : m.text)).length,
    deadEnds: (record.deadEnds ?? []).length, incidents: Math.max(record.incidents ?? 0, record.incidentsSeen?.length ?? 0),
    latencyP50: record.latencyMs?.p50 ?? null, latencyP95: record.latencyMs?.p95 ?? null,
    seq: record.seq ?? null, issues: record.issues?.length ?? 0, wishes: record.wish?.length ?? 0,
    klmSeconds: klm(pointer, keys), expertKlmSeconds: expertKlm,
    efficiency: expertKlm > 0 ? Math.round(klm(pointer, keys) / expertKlm * 10) / 10 : null,
    pointerRatio: floorPointer > 0 ? Math.round(pointer / floorPointer * 10) / 10 : null };
}
export function compare(record, baseline, tolerance = 0.1) {
  const now = score(record), before = score(baseline);
  const fields = ['pointer', 'keys', 'committed', 'undos', 'incidents', 'latencyP50', 'latencyP95', 'klmSeconds'];
  const rows = fields.map((name) => {
    const actual = now[name], expected = before[name];
    const comparable = Number.isFinite(actual) && Number.isFinite(expected);
    const delta = comparable ? actual - expected : null;
    return { name, actual, expected, delta, relativeDelta: comparable && expected !== 0 ? delta / expected : null,
      withinTolerance: comparable ? Math.abs(delta) <= Math.abs(expected) * tolerance : null };
  });
  return { tolerance, baselineId: baseline.id, measuredId: record.id,
    explanation: 'Live results are compared without padding or normalisation. Changed behaviour and hardware can differ. Wall time and subjective ratings are intentionally excluded.',
    rows, allComparableWithinTolerance: rows.every((r) => r.withinTolerance === true) };
}
