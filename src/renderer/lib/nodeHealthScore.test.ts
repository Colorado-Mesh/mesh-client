import { describe, expect, it } from 'vitest';

import { nodeHealthScore, nodeHealthTier } from './nodeHealthScore';
import { MS_PER_HOUR } from './timeConstants';
import type { MeshNode } from './types';

const BASE_NOW = 1_700_000_000_000;

function makeNode(overrides: Partial<MeshNode>): MeshNode {
  return {
    node_id: 1,
    long_name: 'Test',
    short_name: 'T',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Math.floor((BASE_NOW - 10_000) / 1000),
    ...overrides,
  } as MeshNode;
}

describe('nodeHealthScore', () => {
  it('gives full signal score for SNR = 20', () => {
    const { signal } = nodeHealthScore(makeNode({ snr: 20 }), BASE_NOW);
    expect(signal).toBe(40);
  });

  it('gives zero signal score for SNR = -20', () => {
    const { signal } = nodeHealthScore(makeNode({ snr: -20 }), BASE_NOW);
    expect(signal).toBe(0);
  });

  it('gives 30 recency pts when heard < 1h ago', () => {
    const node = makeNode({ last_heard: Math.floor((BASE_NOW - 30 * 60_000) / 1000) });
    const { recency } = nodeHealthScore(node, BASE_NOW);
    expect(recency).toBe(30);
  });

  it('gives 15 recency pts when heard 2h ago', () => {
    const node = makeNode({ last_heard: Math.floor((BASE_NOW - 2 * MS_PER_HOUR) / 1000) });
    const { recency } = nodeHealthScore(node, BASE_NOW);
    expect(recency).toBe(15);
  });

  it('gives 0 recency pts when heard > 6h ago', () => {
    const node = makeNode({ last_heard: Math.floor((BASE_NOW - 7 * MS_PER_HOUR) / 1000) });
    const { recency } = nodeHealthScore(node, BASE_NOW);
    expect(recency).toBe(0);
  });

  it('gives 0 recency pts when last_heard is 0', () => {
    const { recency } = nodeHealthScore(makeNode({ last_heard: 0 }), BASE_NOW);
    expect(recency).toBe(0);
  });

  it('handles legacy millisecond last_heard values', () => {
    const node = makeNode({ last_heard: BASE_NOW - 30 * 60_000 });
    const { recency } = nodeHealthScore(node, BASE_NOW);
    expect(recency).toBe(30);
  });

  it('gives max load pts when channel_utilization is 0', () => {
    const { load } = nodeHealthScore(makeNode({ channel_utilization: 0 }), BASE_NOW);
    expect(load).toBe(20);
  });

  it('gives 0 load pts when channel_utilization is 100', () => {
    const { load } = nodeHealthScore(makeNode({ channel_utilization: 100 }), BASE_NOW);
    expect(load).toBe(0);
  });

  it('skips battery pts when battery is 0 (MeshCore remote)', () => {
    const { battery } = nodeHealthScore(makeNode({ battery: 0 }), BASE_NOW);
    expect(battery).toBe(0);
  });

  it('gives 10 battery pts when battery is 100', () => {
    const { battery } = nodeHealthScore(makeNode({ battery: 100 }), BASE_NOW);
    expect(battery).toBe(10);
  });

  it('total does not exceed 100', () => {
    const { total } = nodeHealthScore(
      makeNode({
        snr: 20,
        battery: 100,
        channel_utilization: 0,
        last_heard: Math.floor((BASE_NOW - 1000) / 1000),
      }),
      BASE_NOW,
    );
    expect(total).toBeLessThanOrEqual(100);
  });
});

describe('nodeHealthTier', () => {
  it('returns good for total >= 70', () => {
    expect(nodeHealthTier(70)).toBe('good');
    expect(nodeHealthTier(100)).toBe('good');
  });

  it('returns warn for total 40-69', () => {
    expect(nodeHealthTier(40)).toBe('warn');
    expect(nodeHealthTier(69)).toBe('warn');
  });

  it('returns poor for total < 40', () => {
    expect(nodeHealthTier(0)).toBe('poor');
    expect(nodeHealthTier(39)).toBe('poor');
  });
});
