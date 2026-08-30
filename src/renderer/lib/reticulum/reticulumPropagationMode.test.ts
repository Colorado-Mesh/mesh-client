import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

import {
  hasPropagationCascadeCandidate,
  isLocalPropagationLoading,
  isSlowRfPropagationTarget,
  listConfiguredRemotePropagationIds,
  listFiniteHopDiscoveredPropagationTargets,
  listSlowRfDiscoveredPropagationTargets,
  listUnknownHopDiscoveredPropagationTargets,
  MAX_RF_PROPAGATION_HOPS,
  pickAutoPropagationNodeId,
  pickAutoPropagationTarget,
  readReticulumPropagationMode,
  resolvePropagationSyncTargetId,
  resolveReticulumPropagationTargetLabel,
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

  it('treats absurd path-table hop counts as unknown for Auto ordering', () => {
    const ghost = '54c454aa'.padEnd(32, '0');
    const near = 'aabbccdd'.repeat(4);
    const rows = [
      discovered({ destination_hash: ghost, hops: 114, peering_cost: 18 }),
      discovered({ destination_hash: near, hops: 2, peering_cost: 5 }),
    ];
    expect(
      listFiniteHopDiscoveredPropagationTargets([], rows).map((t) => t.destinationHash),
    ).toEqual([near]);
    expect(
      listUnknownHopDiscoveredPropagationTargets([], rows).map((t) => t.destinationHash),
    ).toEqual([ghost]);
  });

  it('flags only distant RF targets as slow', () => {
    expect(isSlowRfPropagationTarget(null, 9)).toBe(false);
    expect(isSlowRfPropagationTarget('network', 9)).toBe(false);
    expect(isSlowRfPropagationTarget('rf', MAX_RF_PROPAGATION_HOPS)).toBe(false);
    expect(isSlowRfPropagationTarget('rf', MAX_RF_PROPAGATION_HOPS + 1)).toBe(true);
    expect(isSlowRfPropagationTarget('rf', null)).toBe(true);
  });

  it('keeps multi-hop RF propagation nodes out of the finite and unknown tiers', () => {
    const lora = 'aabbccdd'.repeat(4);
    const ip = '11223344'.repeat(4);
    const rows = [
      discovered({ destination_hash: lora, hops: 3, medium: 'rf' }),
      discovered({ destination_hash: ip, hops: 6, medium: 'network' }),
    ];
    // A 6-hop IP node beats a 3-hop LoRa node: hop count alone is misleading here.
    expect(
      listFiniteHopDiscoveredPropagationTargets([], rows).map((t) => t.destinationHash),
    ).toEqual([ip]);
    expect(listUnknownHopDiscoveredPropagationTargets([], rows)).toEqual([]);
    expect(listSlowRfDiscoveredPropagationTargets([], rows).map((t) => t.destinationHash)).toEqual([
      lora,
    ]);
  });

  it('prefers the local inbox over a multi-hop RF propagation node', () => {
    const lora = 'aabbccdd'.repeat(4);
    const rows = [discovered({ destination_hash: lora, hops: 4, medium: 'rf' })];
    const nodes = [row({ id: 'local-prop', name: 'Local', enabled: true, status: 'known' })];
    expect(pickAutoPropagationTarget(nodes, rows)).toEqual({ kind: 'local' });
    // With no local inbox the RF node is still reachable as a last resort.
    expect(pickAutoPropagationTarget([], rows)).toEqual({
      kind: 'discovered',
      destinationHash: lora,
    });
  });

  it('still picks a near RF propagation node ahead of the local inbox', () => {
    const lora = 'aabbccdd'.repeat(4);
    const rows = [
      discovered({ destination_hash: lora, hops: MAX_RF_PROPAGATION_HOPS, medium: 'rf' }),
    ];
    const nodes = [row({ id: 'local-prop', name: 'Local', enabled: true, status: 'known' })];
    expect(pickAutoPropagationTarget(nodes, rows)).toEqual({
      kind: 'discovered',
      destinationHash: lora,
    });
  });

  it('omits Auto-blacklisted hashes from discovered and configured Auto ranking', () => {
    const blocked = 'aabbccdd'.repeat(4);
    const okDiscovered = '11223344'.repeat(4);
    const okConfigured = '55667788'.repeat(4);
    const blacklist = new Set([blocked]);
    const rows = [
      discovered({ destination_hash: blocked, hops: 1 }),
      discovered({ destination_hash: okDiscovered, hops: 3 }),
    ];
    expect(
      listFiniteHopDiscoveredPropagationTargets([], rows, blacklist).map((t) => t.destinationHash),
    ).toEqual([okDiscovered]);
    const nodes = [
      row({
        id: 'pn-blocked',
        name: 'Bad',
        enabled: true,
        destination_hash: blocked,
        hops: 1,
      }),
      row({
        id: 'pn-ok',
        name: 'Good',
        enabled: true,
        destination_hash: okConfigured,
        hops: 2,
      }),
    ];
    expect(listConfiguredRemotePropagationIds(nodes, blacklist)).toEqual(['pn-ok']);
    expect(pickAutoPropagationTarget(nodes, rows, blacklist)).toEqual({
      kind: 'discovered',
      destinationHash: okDiscovered,
    });
  });

  it('sorts configured remotes with hops above 32 as unknown-hop', () => {
    const near = 'aa'.repeat(16);
    const absurd = 'bb'.repeat(16);
    const nodes = [
      row({
        id: 'pn-absurd',
        name: 'Ghost',
        enabled: true,
        destination_hash: absurd,
        hops: 99,
      }),
      row({
        id: 'pn-near',
        name: 'Near',
        enabled: true,
        destination_hash: near,
        hops: 2,
      }),
    ];
    expect(listConfiguredRemotePropagationIds(nodes)).toEqual(['pn-near', 'pn-absurd']);
  });

  it('reports no cascade candidate for a fresh stack with a loading local inbox', () => {
    const loadingLocal = [
      row({ id: 'local-prop', name: 'Local', enabled: false, status: 'loading' }),
    ];
    expect(hasPropagationCascadeCandidate('auto', loadingLocal, [])).toBe(false);
    expect(hasPropagationCascadeCandidate('manual', loadingLocal, [])).toBe(false);

    // Announce lands → Auto has a discovered target; Manual still has nothing.
    const found = [discovered({ destination_hash: 'ab'.repeat(16), hops: 1 })];
    expect(hasPropagationCascadeCandidate('auto', loadingLocal, found)).toBe(true);
    expect(hasPropagationCascadeCandidate('manual', loadingLocal, found)).toBe(false);

    // Local inbox finishes loading → both modes can settle locally.
    const servingLocal = [row({ id: 'local-prop', name: 'Local', status: 'active' })];
    expect(hasPropagationCascadeCandidate('auto', servingLocal, [])).toBe(true);
    expect(hasPropagationCascadeCandidate('manual', servingLocal, [])).toBe(true);
    expect(hasPropagationCascadeCandidate('off', servingLocal, found)).toBe(false);
  });

  it('excludes an enabled loading local inbox from cascade candidates and local fallback', () => {
    const loadingEnabled = [
      row({ id: 'local-prop', name: 'Local', enabled: true, status: 'loading' }),
    ];
    expect(hasPropagationCascadeCandidate('auto', loadingEnabled, [])).toBe(false);
    expect(hasPropagationCascadeCandidate('manual', loadingEnabled, [])).toBe(false);
    expect(resolvePropagationSyncTargetId('auto', loadingEnabled, null)).toBeNull();
    expect(resolvePropagationSyncTargetId('manual', loadingEnabled, null)).toBeNull();
    expect(pickAutoPropagationTarget(loadingEnabled, [])).toBeNull();
  });

  it('detects the local inbox still loading its messagestore', () => {
    expect(
      isLocalPropagationLoading([row({ id: 'local-prop', name: 'Local', enabled: false })]),
    ).toBe(false);
    expect(
      isLocalPropagationLoading([
        row({ id: 'local-prop', name: 'Local', enabled: false, status: 'loading' }),
      ]),
    ).toBe(true);
    expect(
      isLocalPropagationLoading([row({ id: 'pn-a', name: 'Remote', status: 'loading' })]),
    ).toBe(false);
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

  it('Manual without Preferred picks the closest added remote', () => {
    const nodes = [
      row({ id: 'local-prop', name: 'Local', hops: 0 }),
      row({ id: 'pn-far', name: 'Far', hops: 4 }),
      row({ id: 'pn-near', name: 'Near', hops: 1 }),
    ];
    expect(resolvePropagationSyncTargetId('manual', nodes, null)).toBe('pn-near');
  });

  it('Manual ignores discovered nodes and falls back to local when no remotes are added', () => {
    const nodes = [row({ id: 'local-prop', name: 'Local', hops: 0 })];
    const rows = [discovered({ destination_hash: 'dead'.repeat(8), hops: 1 })];
    expect(resolvePropagationSyncTargetId('manual', nodes, null, rows)).toBe('local-prop');
  });

  it('Manual has no sync target when nothing is added and local is disabled', () => {
    const nodes = [row({ id: 'local-prop', name: 'Local', hops: 0, enabled: false })];
    expect(resolvePropagationSyncTargetId('manual', nodes, null)).toBeNull();
  });

  it('Auto sync target prefers discovered destination hash over local-only', () => {
    const hash = 'dead'.repeat(8);
    const nodes = [row({ id: 'local-prop', name: 'Local', hops: 0 })];
    const rows = [discovered({ destination_hash: hash, hops: 1 })];
    expect(pickAutoPropagationTarget(nodes, rows)?.kind).toBe('discovered');
    expect(resolvePropagationSyncTargetId('auto', nodes, null, rows)).toBe(hash);
  });

  it('pickAutoPropagationTarget prefers discovered over configured (Add-closest ranking)', () => {
    const hash = 'aabb'.repeat(8);
    const nodes = [row({ id: 'pn-aabb', name: 'Configured', hops: 1, destination_hash: hash })];
    const rows = [discovered({ destination_hash: 'dead'.repeat(8), hops: 2 })];
    expect(pickAutoPropagationTarget(nodes, rows)).toEqual({
      kind: 'discovered',
      destinationHash: 'dead'.repeat(8),
    });
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

    it('prefers configured remotes over hops-unknown discovered announces', () => {
      const nodes = [row({ id: 'pn-aaaa', name: 'Added', hops: 4 })];
      const rows = [discovered({ destination_hash: '2222'.repeat(8) })];
      expect(pickAutoPropagationTarget(nodes, rows)).toEqual({
        kind: 'configured',
        id: 'pn-aaaa',
      });
      expect(resolvePropagationSyncTargetId('auto', nodes, null, rows)).toBe('pn-aaaa');
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

  describe('resolveReticulumPropagationTargetLabel', () => {
    const hash = 'aabb'.repeat(8);
    const nodes = [
      row({ id: 'local-prop', name: 'Local propagation node' }),
      row({ id: 'pn-aabb', name: 'Hub PN', destination_hash: hash }),
    ];

    it('uses the translated local name for the local inbox', () => {
      expect(resolveReticulumPropagationTargetLabel(nodes, [], 'local-prop', 'Host node')).toBe(
        'Host node',
      );
    });

    it('names a configured node by row id or destination hash', () => {
      expect(resolveReticulumPropagationTargetLabel(nodes, [], 'pn-aabb', 'Host node')).toBe(
        'Hub PN',
      );
      expect(
        resolveReticulumPropagationTargetLabel(nodes, [], hash.toUpperCase(), 'Host node'),
      ).toBe('Hub PN');
    });

    it('names a discovered node from its announce, else a hash prefix', () => {
      const named = discovered({ destination_hash: 'ccdd'.repeat(8), display_name: ' Ratspeak ' });
      const anonymous = discovered({ destination_hash: 'eeff'.repeat(8) });
      expect(
        resolveReticulumPropagationTargetLabel([], [named, anonymous], named.destination_hash, 'L'),
      ).toBe('Ratspeak');
      expect(
        resolveReticulumPropagationTargetLabel(
          [],
          [named, anonymous],
          anonymous.destination_hash,
          'L',
        ),
      ).toBe('eeffeeffeeff');
    });

    it('falls back to a hash prefix for an unknown target', () => {
      expect(resolveReticulumPropagationTargetLabel(nodes, [], '99'.repeat(16), 'Host node')).toBe(
        '999999999999',
      );
    });
  });
});
