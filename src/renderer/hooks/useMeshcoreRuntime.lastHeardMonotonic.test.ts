import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SRC = loadRuntimeSource('useMeshcoreRuntime.ts');

function sliceFrom(marker: string, length = 4000): string {
  const start = SRC.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, start + length);
}

/**
 * RF RX / PacketRouter bump `nodeStore.lastHeardAt` directly; runtime Map → store syncs that carry
 * radio-contact or SQLite timestamps (rebooted repeater RTC) must not roll that freshness back.
 */
describe('useMeshcoreRuntime last-heard monotonic store sync', () => {
  it('runtime nodes effect syncs with monotonicLastHeard', () => {
    expect(SRC).toContain(
      'syncNodesMapToIdentityStore(storeId, nodes, { monotonicLastHeard: true })',
    );
  });

  it('applyMeshcoreNodesToUi syncs with monotonicLastHeard', () => {
    expect(sliceFrom('const applyMeshcoreNodesToUi = useCallback(', 1200)).toContain(
      'syncNodesMapToIdentityStore(storeId, mergedForStore, { monotonicLastHeard: true })',
    );
  });

  it('reloadMeshcoreNodesFromDb syncs with monotonicLastHeard', () => {
    expect(sliceFrom('const reloadMeshcoreNodesFromDb = useCallback(')).toContain(
      'syncNodesMapToIdentityStore(storeId, mergedInitial, { monotonicLastHeard: true })',
    );
  });
});
