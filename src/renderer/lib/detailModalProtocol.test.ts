import { describe, expect, it } from 'vitest';

import { resolveDetailModalProtocol } from './detailModalProtocol';
import type { MeshProtocol } from './types';

describe('resolveDetailModalProtocol', () => {
  const COLLISION_ID = 0x12345678;

  function hasIn(
    present: Partial<Record<MeshProtocol, ReadonlySet<number>>>,
  ): (protocol: MeshProtocol, nodeId: number) => boolean {
    return (protocol, nodeId) => present[protocol]?.has(nodeId) === true;
  }

  it('prefers the active protocol when both MeshCom and MeshCore have the id', () => {
    const hasNode = hasIn({
      meshcom: new Set([COLLISION_ID]),
      meshcore: new Set([COLLISION_ID]),
    });
    expect(resolveDetailModalProtocol(COLLISION_ID, 'meshcom', hasNode)).toBe('meshcom');
  });

  it('falls through to MeshCore only when the active map lacks the id', () => {
    const hasNode = hasIn({
      meshcore: new Set([COLLISION_ID]),
    });
    expect(resolveDetailModalProtocol(COLLISION_ID, 'meshcom', hasNode)).toBe('meshcore');
  });

  it('returns the active protocol when the selection is cleared', () => {
    expect(resolveDetailModalProtocol(null, 'meshcom', () => true)).toBe('meshcom');
  });
});
