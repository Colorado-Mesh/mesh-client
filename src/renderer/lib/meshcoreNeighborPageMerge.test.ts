import { describe, expect, it, vi } from 'vitest';

import type { MeshCoreNeighborEntry, MeshCoreNeighborResult } from './meshcore/meshcoreHookTypes';
import { mergeMeshcoreNeighborPage } from './meshcoreNeighborPageMerge';

function entry(prefixHex: string): MeshCoreNeighborEntry {
  return {
    publicKeyPrefix: new Uint8Array(6),
    prefixHex,
    resolvedNodeId: 0,
    heardSecondsAgo: 1,
    snr: 2,
  };
}

function page(
  neighbours: MeshCoreNeighborEntry[],
  total = neighbours.length,
): MeshCoreNeighborResult {
  return {
    totalNeighboursCount: total,
    neighbours,
    fetchedAt: 1000,
  };
}

describe('mergeMeshcoreNeighborPage', () => {
  it('replaces cache when offset is 0', () => {
    const existing = page([entry('aa'), entry('bb')], 10);
    const next = page([entry('cc')], 10);
    const outcome = mergeMeshcoreNeighborPage(existing, next, 0);
    expect(outcome).toEqual({ action: 'replace', result: next });
  });

  it('appends when offset matches existing length', () => {
    const existing = page([entry('aa'), entry('bb')], 4);
    const next = page([entry('cc'), entry('dd')], 4);
    const outcome = mergeMeshcoreNeighborPage(existing, next, 2);
    expect(outcome.action).toBe('append');
    if (outcome.action !== 'append') return;
    expect(outcome.result.neighbours.map((n) => n.prefixHex)).toEqual(['aa', 'bb', 'cc', 'dd']);
    expect(outcome.result.totalNeighboursCount).toBe(4);
    expect(outcome.result.fetchedAt).toBe(1000);
  });

  it('dedupes append by prefixHex', () => {
    const existing = page([entry('aa')], 2);
    const next = page([entry('aa'), entry('bb')], 2);
    const outcome = mergeMeshcoreNeighborPage(existing, next, 1);
    expect(outcome.action).toBe('append');
    if (outcome.action !== 'append') return;
    expect(outcome.result.neighbours.map((n) => n.prefixHex)).toEqual(['aa', 'bb']);
  });

  it('keeps existing when offset does not match cache length', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const existing = page([entry('aa'), entry('bb')], 5);
    const next = page([entry('cc')], 5);
    const outcome = mergeMeshcoreNeighborPage(existing, next, 1);
    expect(outcome).toEqual({ action: 'keep', result: existing });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips mid-list page when cache is empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const next = page([entry('cc')], 5);
    const outcome = mergeMeshcoreNeighborPage(undefined, next, 2);
    expect(outcome).toEqual({ action: 'skip' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
