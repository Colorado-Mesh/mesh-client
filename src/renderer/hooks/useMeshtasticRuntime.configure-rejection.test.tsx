import type { MeshDevice } from '@meshtastic/core';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as connection from '../lib/connection';
import { getMeshtasticConfigurePhase } from '../lib/meshtastic/meshtasticConfigurePhase';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { MS_PER_DAY } from '../lib/timeConstants';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';
import { setConnection } from '../stores/connectionStore';
import { addIdentity } from '../stores/identityStore';
import { upsertNode, useNodeStore } from '../stores/nodeStore';

vi.mock('../lib/connection', () => ({
  createBleConnection: vi.fn(),
  createConnection: vi.fn(),
  reconnectSerial: vi.fn(),
  safeDisconnect: vi.fn().mockResolvedValue(undefined),
}));

function createStubDevice(configure: MeshDevice['configure']): MeshDevice {
  const noopSub = { subscribe: () => () => {} };
  const events = new Proxy({} as MeshDevice['events'], {
    get: () => noopSub,
  });
  return { configure, events, transport: {} } as unknown as MeshDevice;
}

describe('useMeshtasticRuntime — configure() rejection', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(connection.createBleConnection).mockClear();
    vi.mocked(connection.createConnection).mockClear();
    vi.mocked(connection.reconnectSerial).mockClear();
    vi.mocked(connection.safeDisconnect).mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('rejects connect() and resets state when configure fails (no unhandled rejection)', async () => {
    const err = new Error('Permission denied');
    const device = createStubDevice(vi.fn().mockRejectedValue(err));
    vi.mocked(connection.createConnection).mockResolvedValue(device);

    const { result } = renderHook(() => useMeshtasticRuntime());

    await expect(result.current.connect('http', 'http://127.0.0.1')).rejects.toThrow(
      'Permission denied',
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe('disconnected');
    });
  });

  it('clears configure phase after rejected configure so live node updates bump last_heard', async () => {
    const ID = 'id-config-reject-live';
    const PEER = 42;
    const staleMs = Date.now() - 7 * MS_PER_DAY;
    const liveMs = Date.now() - 60_000;

    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    addIdentity({
      id: ID,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:config-reject',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    setConnection(ID, { myNodeNum: 1, status: 'connected', connectionType: 'http' });
    useNodeStore.setState({
      nodes: { [ID]: { [PEER]: { nodeId: PEER, lastHeardAt: staleMs } } },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });

    const err = new Error('Configure stalled');
    const device = createStubDevice(vi.fn().mockRejectedValue(err));
    vi.mocked(connection.createConnection).mockResolvedValue(device);

    const { result } = renderHook(() => useMeshtasticRuntime());

    await expect(result.current.connect('http', 'http://127.0.0.1')).rejects.toThrow(
      'Configure stalled',
    );

    await waitFor(() => {
      expect(getMeshtasticConfigurePhase()).toBe(false);
    });

    upsertNode(ID, {
      nodeId: PEER,
      fromUserPacket: true,
      lastHeardAt: liveMs,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID][PEER].lastHeardAt).toBe(liveMs);
  });
});
