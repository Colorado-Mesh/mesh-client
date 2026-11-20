// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callsignToNodeId } from '../lib/meshcom/meshcomCallsign';
import {
  clearAllMeshcomLocallyDeletedContactsForTests,
  isMeshcomLocallyDeletedContact,
} from '../lib/meshcom/meshcomLocallyDeletedContacts';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCOM_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';
import { upsertNodeRecord, useNodeStore } from '../stores/nodeStore';
import { useMeshcomRuntime } from './useMeshcomRuntime';

const SOURCE = loadRuntimeSource('useMeshcomRuntime.ts');
const CALLSIGN = 'W1AW-1';
const NODE_ID = callsignToNodeId(CALLSIGN);

describe('useMeshcomRuntime deleteNode', () => {
  beforeEach(() => {
    ensureOfflineProtocolIdentities();
    clearAllMeshcomLocallyDeletedContactsForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    upsertNodeRecord(OFFLINE_MESHCOM_IDENTITY_ID, {
      nodeId: NODE_ID,
      longName: CALLSIGN,
      shortName: CALLSIGN.slice(0, 4),
    });
    vi.mocked(window.electronAPI.db.deleteMeshcomContact).mockClear();
  });

  afterEach(() => {
    clearAllMeshcomLocallyDeletedContactsForTests();
  });

  it('exposes a real deleteNode (not a no-op stub)', () => {
    expect(SOURCE).toMatch(/deleteMeshcomContact\(/);
    expect(SOURCE).toMatch(/markMeshcomLocallyDeletedContact\(/);
    expect(SOURCE).toMatch(/\bdeleteNode,/);
  });

  it('removes the store row, tombstones the callsign, and deletes SQLite', async () => {
    const { result } = renderHook(() => useMeshcomRuntime());

    await act(async () => {
      await result.current.deleteNode?.(NODE_ID);
    });

    expect(useNodeStore.getState().nodes[OFFLINE_MESHCOM_IDENTITY_ID][NODE_ID]).toBeUndefined();
    expect(isMeshcomLocallyDeletedContact(CALLSIGN)).toBe(true);
    expect(window.electronAPI.db.deleteMeshcomContact).toHaveBeenCalledWith(
      OFFLINE_MESHCOM_IDENTITY_ID,
      CALLSIGN,
    );
  });
});
