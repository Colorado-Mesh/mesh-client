import { describe, expect, it } from 'vitest';

import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';

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

describe('hasEffectiveReticulumPropagationTarget', () => {
  it('returns false when mode is off and nothing is preferred', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], null, 'off')).toBe(false);
  });

  it('returns true when preferred remote is set even if sync mode is off', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], 'remote-1', 'off')).toBe(true);
  });

  it('returns false when only local-prop is enabled', () => {
    const localOnly: PropagationNodeRow = {
      id: 'local-prop',
      name: 'Local inbox',
      enabled: true,
      status: 'online',
    };
    expect(hasEffectiveReticulumPropagationTarget([localOnly], null, 'auto')).toBe(false);
  });

  it('returns true when auto mode finds an enabled remote node', () => {
    expect(hasEffectiveReticulumPropagationTarget([remoteNode], null, 'auto')).toBe(true);
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
  it('is true for preferred remote or enabled local-prop', () => {
    const localEnabled: PropagationNodeRow = {
      id: 'local-prop',
      name: 'Local',
      enabled: true,
      status: 'active',
      preferred: false,
    };
    expect(hasReticulumPnCascadeCapacity([remoteNode], 'remote-1', 'off')).toBe(true);
    expect(hasReticulumPnCascadeCapacity([localEnabled], 'local-prop', 'off')).toBe(true);
    expect(hasEnabledLocalPropagation([localEnabled])).toBe(true);
  });

  it('is false when nothing is available', () => {
    expect(hasReticulumPnCascadeCapacity([], null, 'off')).toBe(false);
  });
});
