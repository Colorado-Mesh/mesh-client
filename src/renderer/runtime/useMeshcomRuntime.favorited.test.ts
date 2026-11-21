// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerMeshcomCallsign } from '../lib/meshcom/meshcomCallRegistry';
import { callsignToNodeId } from '../lib/meshcom/meshcomCallsign';
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

describe('useMeshcomRuntime setNodeFavorited', () => {
  beforeEach(() => {
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    vi.mocked(window.electronAPI.db.saveMeshcomContact).mockClear();
    registerMeshcomCallsign(CALLSIGN);
  });

  it('persists favorited via saveMeshcomContact (not a no-op stub)', () => {
    expect(SOURCE).toMatch(/saveMeshcomContact\(/);
    expect(SOURCE).toMatch(/patchNodeFavorited\(/);
    expect(SOURCE).toMatch(/resolveMeshcomContactIdentity\(/);
    expect(SOURCE).toMatch(/syncIdentityIds/);
    expect(SOURCE).not.toMatch(/setNodeFavorited:\s*async\s*\(\)\s*=>\s*\{\s*\}/);
  });

  it('patches the UI identity bucket and saves favorited to SQLite', async () => {
    upsertNodeRecord(OFFLINE_MESHCOM_IDENTITY_ID, {
      nodeId: NODE_ID,
      longName: CALLSIGN,
      shortName: CALLSIGN.slice(0, 4),
    });
    const { result } = renderHook(() => useMeshcomRuntime());

    await act(async () => {
      await result.current.setNodeFavorited(NODE_ID, true);
    });

    expect(useNodeStore.getState().nodes[OFFLINE_MESHCOM_IDENTITY_ID][NODE_ID].favorited).toBe(
      true,
    );
    expect(window.electronAPI.db.saveMeshcomContact).toHaveBeenCalledWith(
      expect.objectContaining({
        callsign: CALLSIGN,
        identity_id: OFFLINE_MESHCOM_IDENTITY_ID,
        node_id: NODE_ID,
        favorited: 1,
      }),
    );
  });

  it('seeds the offline UI bucket from callsign when no store row exists yet', async () => {
    // History-stub / divergent-bucket path: callsign is registered, store is empty.
    const { result } = renderHook(() => useMeshcomRuntime());

    await act(async () => {
      await result.current.setNodeFavorited(NODE_ID, true);
    });

    const row = useNodeStore.getState().nodes[OFFLINE_MESHCOM_IDENTITY_ID]?.[NODE_ID];
    expect(row?.favorited).toBe(true);
    expect(row?.longName).toBe(CALLSIGN);
    expect(window.electronAPI.db.saveMeshcomContact).toHaveBeenCalledWith(
      expect.objectContaining({
        callsign: CALLSIGN,
        identity_id: OFFLINE_MESHCOM_IDENTITY_ID,
        favorited: 1,
      }),
    );
  });
});
