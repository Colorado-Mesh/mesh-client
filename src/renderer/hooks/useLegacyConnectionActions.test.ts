import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { type MeshcoreSessionApi, registerMeshcoreSession } from '../lib/sessions/meshcoreSession';
import {
  type MeshtasticSessionApi,
  registerMeshtasticSession,
} from '../lib/sessions/meshtasticSession';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { addIdentity } from '../stores/identityStore';
import { useProtocolConnectionActions } from './useProtocolConnection';

const IDENTITY = 'id-conn-actions-mt';

function createMeshtasticSessionStub(): MeshtasticSessionApi {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
  };
}

function createMeshcoreSessionStub(): MeshcoreSessionApi {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('./useConnect', () => ({
  useConnect: () => vi.fn().mockResolvedValue('id-test-driver'),
}));

vi.mock('./useDisconnect', () => ({
  useDisconnect: () => vi.fn().mockResolvedValue(undefined),
}));

describe('useProtocolConnectionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSession(null);
    registerMeshcoreSession(null);
    useConnectionStore.setState({ connections: {} });
    addIdentity({
      id: IDENTITY,
      protocol: meshtasticProtocol,
      signature: 'sig-conn',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  it('driver-first connect prepares and attaches Meshtastic session', async () => {
    const meshtastic = createMeshtasticSessionStub();
    registerMeshtasticSession(meshtastic);

    const { result } = renderHook(() => useProtocolConnectionActions('meshtastic'));

    await result.current.connect('serial', undefined, undefined);

    expect(meshtastic.prepareRfConnect).toHaveBeenCalledWith('serial', undefined, undefined);
    expect(meshtastic.attachRfSession).toHaveBeenCalledWith('id-test-driver', 'serial');
  });

  it('maps http to tcp for meshcore driver-first connect', async () => {
    const meshcore = createMeshcoreSessionStub();
    registerMeshcoreSession(meshcore);

    const { result } = renderHook(() => useProtocolConnectionActions('meshcore'));

    await result.current.connect('http', '192.168.1.1', undefined);

    expect(meshcore.prepareRfConnect).toHaveBeenCalledWith('tcp');
    expect(meshcore.attachRfSession).toHaveBeenCalledWith('id-test-driver', 'tcp');
  });

  it('exposes state from the connection store for the protocol identity', () => {
    setConnection(IDENTITY, {
      status: 'configured',
      connectionType: 'ble',
      myNodeNum: 42,
      mqttStatus: 'disconnected',
    });

    const { result } = renderHook(() => useProtocolConnectionActions('meshtastic'));

    expect(result.current.state.myNodeNum).toBe(42);
    expect(result.current.state.status).toBe('configured');
  });
});
