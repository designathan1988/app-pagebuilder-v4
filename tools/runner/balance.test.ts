import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headlessProven, headlessRecord, leftOut, readsTheBrowser, runName } from './balance.ts';

const plain = { render: { computed: [], geometry: [] }, editor: null, persistence: null, export: null };
const scenario = (id: string, doors: string[], expect: object = plain) => ({ id, doors, expect: { ...plain, ...expect } });

describe('the balance of the two scenario runners', () => {
  it('leaves out a proven run whose door keeps a browser run of its own', () => {
    const features = [{ id: 'f', scenarios: [scenario('a', ['door#1']), scenario('b', ['door#1'])] }];
    const proven = new Set([runName('f', 'a', 'door#1')]);
    expect([...leftOut(features, proven)]).toEqual([runName('f', 'a', 'door#1')]);
  });

  it("keeps the first run of a door whose every run is proven, so the door's gesture runs in the browser", () => {
    const features = [{ id: 'f', scenarios: [scenario('a', ['door#1']), scenario('b', ['door#1']), scenario('c', ['door#2'])] }];
    const proven = new Set([runName('f', 'a', 'door#1'), runName('f', 'b', 'door#1'), runName('f', 'c', 'door#2')]);
    expect([...leftOut(features, proven)]).toEqual([runName('f', 'b', 'door#1')]);
  });

  it('never leaves out a run whose scenario expects what only a browser reads', () => {
    for (const expect_ of [{ render: { computed: [{}], geometry: [] } }, { render: { computed: [], geometry: [{}] } }, { editor: {} }, { persistence: {} }, { export: {} }, { hover: {} }]) {
      const reading = scenario('a', ['door#1'], expect_);
      expect(readsTheBrowser(reading)).toBe(true);
      const features = [{ id: 'f', scenarios: [reading, scenario('b', ['door#1'])] }];
      expect(leftOut(features, new Set([runName('f', 'a', 'door#1')])).size).toBe(0);
    }
  });

  it('trusts the fast runner only on the inputs it ran on, and says why it trusts none', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-'));
    const file = path.join(folder, 'headless.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ fingerprint: 'another tree', passed: ['f › a › door#1'] }));
      expect(headlessProven('this tree', file)).toBeNull();
      expect([...(headlessProven('another tree', file) ?? [])]).toEqual(['f › a › door#1']);
      expect(headlessProven('another tree', path.join(folder, 'missing.json'))).toBeNull();
      expect(headlessRecord('this tree', file)).toMatchObject({ proven: null, why: expect.stringContaining('other contents') });
      expect(headlessRecord('this tree', path.join(folder, 'missing.json'))).toMatchObject({ proven: null, why: expect.stringContaining('no record') });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
