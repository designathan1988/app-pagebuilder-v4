import { describe, expect, it } from 'vitest';
import { checkManifest } from '../../src/manifest/check.ts';
import { loadManifest } from './load.ts';
import { PLANTS, planted } from './plants.ts';

// The planted fixtures run in SHARDS files (check-plants-<n>.test.ts), one slice each, so the test runner checks them
// on several workers at once: every plant runs the whole manifest check, and in one file they ran one after another.
export const SHARDS = 8;

// The planted fixtures of one shard: every plant whose index falls in it, each proven exactly as before — it fails, on
// its own rule, and on no rule beyond the ones its mutation honestly implies.
export function plantShard(shard: number): void {
  const loaded = loadManifest();
  const mine = PLANTS.filter((_plant, index) => index % SHARDS === shard);
  describe(`manifest:check planted fixtures, shard ${shard + 1} of ${SHARDS}`, () => {
    // (each plant runs the whole checker, as check.test.ts's tests of the checker do: their time, 30 s)
    it.each(mine.map((p) => [p.id, p] as const))('fails on the planted fixture "%s", and only on its rule', { timeout: 30_000 }, (_id, plant) => {
      const { problems } = checkManifest(planted(loaded.input, plant));
      expect(problems.length).toBeGreaterThan(0);
      const allowed = new Set([plant.rule, ...(plant.implies ?? [])]);
      expect(problems.map((p) => p.rule).filter((rule) => !allowed.has(rule))).toEqual([]);
      expect(problems.map((p) => p.rule)).toContain(plant.rule);
    });
  });
}
