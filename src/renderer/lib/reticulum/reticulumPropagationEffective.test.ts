import { describe, expect, it } from 'vitest';

import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

import {
  hasEffectiveReticulumPropagationTarget,
  hasEnabledLocalPropagation,
  hasReticulumPnCascadeCapacity,
} from './reticulumPropagationEffective';

const remoteNode: PropagationNodeRow = {
  id: 'remote-1',
  name: 'Remote lxmd',
  enabled: true,
  status: 'online',
  hops: 2,
};

const localOnlyNode: PropagationNodeRow = {
  id: 'local-prop',
  name: 'Local',
  enabled: true,
  status: 'online',
};

const activeDiscovered: DiscoveredPropagationRow = {
  destination_hash: 'dead'.repeat(8),
  node_state: true,
  peering_cost: 0,
  hops: 1,
};

describe('hasEffectiveReticulumPropagationTarget', () => {
  it('returns false when mode is off and nothing is preferred', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], null, 'off')).toBe(false);
  });

  it('returns false in off mode even when a preferred remote is saved', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], 'remote-1', 'off')).toBe(false);
  });

  it('returns true in manual without Preferred when an added remote can be picked', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], null, 'manual')).toBe(true);
  });

  it('returns false when only local-prop is enabled', () => {
    expect(hasEffectiveReticulumPropagationTarget([localOnlyNode], null, 'auto')).toBe(false);
  });

  it('returns true when auto mode finds an enabled remote node', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], null, 'auto')).toBe(true);
  });

  // Auto deposits on the best heard PN without adding it (sidecar auto_discovered_candidates).
  it('returns true in auto when only discovered remotes exist', () => {
    expect(
      hasEffectiveReticulumPropagationTarget([localOnlyNode], null, 'auto', [activeDiscovered]),
    ).toBe(true);
  });

  it('returns false in auto when the discovered node is not serving', () => {
    const inactive = { ...activeDiscovered, node_state: false };
    expect(hasEffectiveReticulumPropagationTarget([localOnlyNode], null, 'auto', [inactive])).toBe(
      false,
    );
  });

  it('returns false in auto when the discovered node is already added but disabled', () => {
    const disabledConfigured: PropagationNodeRow = {
      ...remoteNode,
      enabled: false,
      destination_hash: activeDiscovered.destination_hash,
    };
    expect(
      hasEffectiveReticulumPropagationTarget([disabledConfigured], null, 'auto', [
        activeDiscovered,
      ]),
    ).toBe(false);
  });

  it('ignores discovered nodes in manual and off (only nodes the user added count)', () => {
    expect(
      hasEffectiveReticulumPropagationTarget([localOnlyNode], null, 'manual', [activeDiscovered]),
    ).toBe(false);
    expect(
      hasEffectiveReticulumPropagationTarget([localOnlyNode], null, 'off', [activeDiscovered]),
    ).toBe(false);
  });

  it('returns true when preferred id is set before the node list loads', () => {
    expect(hasEffectiveReticulumPropagationTarget([], 'remote-1', 'auto')).toBe(true);
  });

  it('returns true when preferred matches destination_hash', () => {
    const withHash: PropagationNodeRow = {
      ...remoteNode,
      destination_hash: 'aa'.repeat(16),
    };
    expect(hasEffectiveReticulumPropagationTarget([withHash], 'aa'.repeat(16), 'manual')).toBe(
      true,
    );
  });

  it('returns false when preferred remote is disabled', () => {
    const disabled: PropagationNodeRow = { ...remoteNode, enabled: false };
    expect(hasEffectiveReticulumPropagationTarget([disabled], 'remote-1', 'manual')).toBe(false);
  });

  it('returns true when a node is flagged preferred and enabled', () => {
    const flagged: PropagationNodeRow = { ...remoteNode, preferred: true };
    expect(hasEffectiveReticulumPropagationTarget([flagged], null, 'manual')).toBe(true);
  });

  it('returns true when manual mode has a preferred remote node', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], 'remote-1', 'manual')).toBe(true);
  });
});

describe('hasReticulumPnCascadeCapacity', () => {
  const localEnabled: PropagationNodeRow = {
    id: 'local-prop',
    name: 'Local',
    enabled: true,
    status: 'active',
    preferred: false,
  };

  it('is true for preferred remote or enabled local-prop', () => {
    expect(hasReticulumPnCascadeCapacity([remoteNode], 'remote-1', 'manual')).toBe(true);
    expect(hasReticulumPnCascadeCapacity([localEnabled], 'local-prop', 'manual')).toBe(true);
    expect(hasEnabledLocalPropagation([localEnabled])).toBe(true);
  });

  it('is false in off mode even with a preferred remote or enabled local-prop', () => {
    expect(hasReticulumPnCascadeCapacity([remoteNode], 'remote-1', 'off')).toBe(false);
    expect(hasReticulumPnCascadeCapacity([localEnabled], 'local-prop', 'off')).toBe(false);
  });

  it('is false when nothing is available', () => {
    expect(hasReticulumPnCascadeCapacity([], null, 'auto')).toBe(false);
  });

  // Sidecar still has somewhere to deposit, so the link-timeout bridge must not fail rows.
  it('is true in auto with only a discovered node', () => {
    expect(hasReticulumPnCascadeCapacity([], null, 'auto', [activeDiscovered])).toBe(true);
  });

  it('is false when local-prop is present but disabled', () => {
    const localDisabled: PropagationNodeRow = {
      id: 'local-prop',
      name: 'Local',
      enabled: false,
      status: 'inactive',
      preferred: false,
    };
    expect(hasReticulumPnCascadeCapacity([localDisabled], null, 'auto')).toBe(false);
  });
});
