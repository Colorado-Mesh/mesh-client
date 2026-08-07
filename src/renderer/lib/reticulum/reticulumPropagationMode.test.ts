import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

import {
  pickAutoPropagationNodeId,
  pickAutoPropagationTarget,
  readReticulumPropagationMode,
  resolvePropagationSyncTargetId,
  RETICULUM_PROPAGATION_MODE_KEY,
} from './reticulumPropagationMode';

function row(
  partial: Partial<PropagationNodeRow> & Pick<PropagationNodeRow, 'id' | 'name'>,
): PropagationNodeRow {
  return {
    enabled: true,
    status: 'known',
    ...partial,
  };
}

function discovered(
  partial: Partial<DiscoveredPropagationRow> & Pick<DiscoveredPropagationRow, 'destination_hash'>,
): DiscoveredPropagationRow {
  return {
    node_state: true,
    peering_cost: 0,
    ...partial,
  };
}

describe('reticulumPropagationMode', () => {
  // renderer-logic runs in node (no jsdom); provide a minimal localStorage stub.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to off when nothing is persisted', () => {
    localStorage.removeItem(RETICULUM_PROPAGATION_MODE_KEY);
    expect(readReticulumPropagationMode()).toBe('off');
  });

  it('honors a persisted mode', () => {
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, 'auto');
    expect(readReticulumPropagationMode()).toBe('auto');
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, 'manual');
    expect(readReticulumPropagationMode()).toBe('manual');
  });

  it('picks lowest-hop enabled node excluding local-prop', () => {
    const nodes = [
      row({ id: 'local-prop', name: 'Local', hops: 0 }),
      row({ id: 'pn-aaaa', name: 'Far', hops: 4 }),
      row({ id: 'pn-bbbb', name: 'Near', hops: 1 }),
      row({ id: 'pn-cccc', name: 'Disabled', hops: 0, enabled: false }),
    ];
    expect(pickAutoPropagationNodeId(nodes)).toBe('pn-bbbb');
  });

  it('resolvePropagationSyncTargetId respects mode', () => {
    const nodes = [
      row({ id: 'local-prop', name: 'Local', hops: 0 }),
      row({ id: 'pn-aaaa', name: 'Near', hops: 1 }),
    ];
    expect(resolvePropagationSyncTargetId('off', nodes, 'pn-aaaa')).toBeNull();
    expect(resolvePropagationSyncTargetId('manual', nodes, 'pn-aaaa')).toBe('pn-aaaa');
    expect(resolvePropagationSyncTargetId('auto', nodes, null)).toBe('pn-aaaa');
  });

  describe('pickAutoPropagationTarget', () => {
    it('picks the lowest-hop configured remote', () => {
      const nodes = [
        row({ id: 'local-prop', name: 'Local', hops: 0 }),
        row({ id: 'pn-aaaa', name: 'Far', hops: 4 }),
        row({ id: 'pn-bbbb', name: 'Near', hops: 1 }),
      ];
      expect(pickAutoPropagationTarget(nodes)).toEqual({ kind: 'configured', id: 'pn-bbbb' });
    });

    it('prefers a closer discovered node over a worse configured remote', () => {
      const nodes = [row({ id: 'pn-aaaa', name: 'Far', hops: 4 })];
      const rows = [discovered({ destination_hash: 'dead'.repeat(8), hops: 1 })];
      expect(pickAutoPropagationTarget(nodes, rows)).toEqual({
        kind: 'discovered',
        destinationHash: 'dead'.repeat(8),
      });
    });

    it('ignores discovered rows already configured or inactive', () => {
      const hash = 'aabb'.repeat(8);
      const nodes = [row({ id: 'pn-aabb', name: 'Configured', hops: 2, destination_hash: hash })];
      const rows = [
        discovered({ destination_hash: hash, hops: 1 }),
        discovered({ destination_hash: 'ccdd'.repeat(8), hops: 0, node_state: false }),
      ];
      expect(pickAutoPropagationTarget(nodes, rows)).toEqual({
        kind: 'configured',
        id: 'pn-aabb',
      });
    });

    it('prefers a remote over enabled local', () => {
      const nodes = [
        row({ id: 'local-prop', name: 'Local', hops: 0 }),
        row({ id: 'pn-aaaa', name: 'Near', hops: 2 }),
      ];
      expect(pickAutoPropagationTarget(nodes)).toEqual({ kind: 'configured', id: 'pn-aaaa' });
    });

    it('falls back to local when only enabled local is available', () => {
      const nodes = [row({ id: 'local-prop', name: 'Local', hops: 0 })];
      expect(pickAutoPropagationTarget(nodes)).toEqual({ kind: 'local' });
    });

    it('returns null when nothing is enabled', () => {
      const nodes = [
        row({ id: 'local-prop', name: 'Local', hops: 0, enabled: false }),
        row({ id: 'pn-aaaa', name: 'Near', hops: 1, enabled: false }),
      ];
      expect(pickAutoPropagationTarget(nodes)).toBeNull();
    });
  });
});
