import { describe, expect, it } from 'vitest';

import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';

import {
  pickAutoPropagationNodeId,
  resolvePropagationSyncTargetId,
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

describe('reticulumPropagationMode', () => {
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
});
