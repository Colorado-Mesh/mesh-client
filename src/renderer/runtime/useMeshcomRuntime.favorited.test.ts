// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { packetRouter } from '../lib/drivers/PacketRouter';
import { registerMeshcomCallsign } from '../lib/meshcom/meshcomCallRegistry';
import { callsignToNodeId } from '../lib/meshcom/meshcomCallsign';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCOM_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { ensureMeshcomProtocolLoaded } from '../lib/protocols/meshcomProtocolLoader';
import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';
import { getConnection, useConnectionStore } from '../stores/connectionStore';
import { upsertNodeRecord, useNodeStore } from '../stores/nodeStore';
import { useMeshcomRuntime } from './useMeshcomRuntime';

vi.mock('../lib/drivers/ConnectionDriver', () => ({
  connectionDriver: {
    getHandle: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getLastDataAtForIdentity: vi.fn().mockReturnValue(0),
  },
}));

vi.mock('../lib/protocols/meshcomProtocolLoader', () => ({
  ensureMeshcomProtocolLoaded: vi.fn(),
}));

const SOURCE = loadRuntimeSource('useMeshcomRuntime.ts');
const CALLSIGN = 'W1AW-1';
const NODE_ID = callsignToNodeId(CALLSIGN);

describe('useMeshcomRuntime setNodeFavorited', () => {
  beforeEach(() => {
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useConnectionStore.setState({ connections: {} });
    vi.mocked(window.electronAPI.db.saveMeshcomContact).mockClear();
    vi.mocked(connectionDriver.getHandle).mockReset();
    vi.mocked(ensureMeshcomProtocolLoaded).mockReset();
    registerMeshcomCallsign(CALLSIGN);
  });

  it('persists favorited via saveMeshcomContact (not a no-op stub)', () => {
    expect(SOURCE).toMatch(/saveMeshcomContact\(/);
    expect(SOURCE).toMatch(/patchNodeFavorited\(/);
    expect(SOURCE).toMatch(/resolveMeshcomContactIdentity\(/);
    expect(SOURCE).toMatch(/syncIdentityIds/);
    expect(SOURCE).not.toMatch(/setNodeFavorited:\s*async\s*\(\)\s*=>\s*\{\s*\}/);
  });

  it('setOwner syncs myNodeNum on the runtime and connection store', async () => {
    vi.mocked(connectionDriver.getHandle).mockReturnValue({
      connection: { transport: 'udp' },
      transport: 'udp',
      operatorCallsign: '',
    });
    vi.mocked(ensureMeshcomProtocolLoaded).mockResolvedValue({
      setOwner: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof ensureMeshcomProtocolLoaded>>);

    const { result } = renderHook(() => useMeshcomRuntime());

    await act(async () => {
      await result.current.setOwner({
        longName: CALLSIGN,
        shortName: 'W1AW',
        isLicensed: true,
      });
    });

    expect(result.current.selfNodeId).toBe(NODE_ID);
    expect(getConnection(OFFLINE_MESHCOM_IDENTITY_ID)?.myNodeNum).toBe(NODE_ID);
  });

  it('device_self_info syncs myNodeNum on the runtime and connection store', async () => {
    const { result } = renderHook(() => useMeshcomRuntime());
    const attachRfSession = result.current.attachRfSession as (
      id: string,
      type: 'udp',
    ) => Promise<void>;

    await act(async () => {
      await attachRfSession(OFFLINE_MESHCOM_IDENTITY_ID, 'udp');
    });

    act(() => {
      packetRouter.dispatch(
        {
          type: 'device_self_info',
          payload: {
            name: CALLSIGN,
            publicKey: new Uint8Array(0),
            type: 0,
            txPower: 0,
            radioFreq: 0,
            manualAddContacts: false,
          },
        },
        OFFLINE_MESHCOM_IDENTITY_ID,
      );
    });

    expect(result.current.selfNodeId).toBe(NODE_ID);
    expect(getConnection(OFFLINE_MESHCOM_IDENTITY_ID)?.myNodeNum).toBe(NODE_ID);
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
