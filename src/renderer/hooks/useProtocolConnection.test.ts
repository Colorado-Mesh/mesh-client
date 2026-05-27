import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { type MeshcoreSessionApi, registerMeshcoreSession } from '../lib/sessions/meshcoreSession';
import {
  type MeshtasticSessionApi,
  registerMeshtasticSession,
} from '../lib/sessions/meshtasticSession';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import {
  useProtocolConnect,
  useProtocolConnectionActions,
  useProtocolDisconnect,
} from './useProtocolConnection';

const IDENTITY_ACTIONS = 'id-conn-actions-mt';

const mockDriverConnect = vi.fn().mockResolvedValue('id-meshtastic-driver');
const mockDriverDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('./useConnect', () => ({
  useConnect: () => mockDriverConnect,
}));

vi.mock('./useDisconnect', () => ({
  useDisconnect: () => mockDriverDisconnect,
}));

function createMeshtasticSessionStub(): MeshtasticSessionApi {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn(),
  };
}

function createMeshcoreSessionStub(): MeshcoreSessionApi {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn(),
  };
}

describe('useProtocolConnect (driver-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSession(null);
    registerMeshcoreSession(null);
  });

  it('prepares, driver-connects, then attaches Meshtastic session', async () => {
    const meshtastic = createMeshtasticSessionStub();
    registerMeshtasticSession(meshtastic);
    const { result } = renderHook(() => useProtocolConnect());

    await result.current('meshtastic', 'serial', undefined, undefined);

    expect(meshtastic.prepareRfConnect).toHaveBeenCalledWith('serial', undefined, undefined);
    expect(meshtastic.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'serial');
  });

  it('maps http to tcp and attaches MeshCore session', async () => {
    const meshcore = createMeshcoreSessionStub();
    registerMeshcoreSession(meshcore);
    const { result } = renderHook(() => useProtocolConnect());

    await result.current('meshcore', 'http', '10.0.0.1', undefined);

    expect(meshcore.prepareRfConnect).toHaveBeenCalledWith('tcp');
    expect(meshcore.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'tcp');
  });
});

describe('useProtocolDisconnect (driver-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSession(null);
    registerMeshcoreSession(null);
    addIdentity({
      id: 'id-meshtastic-test',
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  it('finalizes session then disconnects driver for the protocol identity', async () => {
    const meshtastic = createMeshtasticSessionStub();
    registerMeshtasticSession(meshtastic);
    const { result } = renderHook(() => useProtocolDisconnect());

    await result.current('meshtastic');

    expect(meshtastic.finalizeDriverDisconnect).toHaveBeenCalled();
    expect(mockDriverDisconnect).toHaveBeenCalledWith('id-meshtastic-test');
  });
});

describe('useProtocolConnectionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSession(null);
    registerMeshcoreSession(null);
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    addIdentity({
      id: IDENTITY_ACTIONS,
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
    expect(meshtastic.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'serial');
  });

  it('maps http to tcp for meshcore driver-first connect', async () => {
    const meshcore = createMeshcoreSessionStub();
    registerMeshcoreSession(meshcore);

    const { result } = renderHook(() => useProtocolConnectionActions('meshcore'));

    await result.current.connect('http', '192.168.1.1', undefined);

    expect(meshcore.prepareRfConnect).toHaveBeenCalledWith('tcp');
    expect(meshcore.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'tcp');
  });

  it('exposes state from the connection store for the protocol identity', () => {
    setConnection(IDENTITY_ACTIONS, {
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
