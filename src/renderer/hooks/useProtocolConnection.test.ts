import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { addIdentity } from '../stores/identityStore';
import { useProtocolConnect, useProtocolDisconnect } from './useProtocolConnection';

const mockDriverConnect = vi.fn().mockResolvedValue('id-meshtastic-driver');
const mockDriverDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('./useConnect', () => ({
  useConnect: () => mockDriverConnect,
}));

vi.mock('./useDisconnect', () => ({
  useDisconnect: () => mockDriverDisconnect,
}));

function createMeshtasticStub() {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMeshcoreStub() {
  return {
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe('useProtocolConnect (driver-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares, driver-connects, then attaches Meshtastic legacy session', async () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();
    const { result } = renderHook(() => useProtocolConnect(meshtastic as never, meshcore as never));

    await result.current('meshtastic', 'serial', undefined, undefined);

    expect(meshtastic.prepareRfConnect).toHaveBeenCalledWith('serial', undefined, undefined);
    expect(meshtastic.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'serial');
    expect(meshcore.prepareRfConnect).not.toHaveBeenCalled();
  });

  it('maps http to tcp and attaches MeshCore legacy session', async () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();
    const { result } = renderHook(() => useProtocolConnect(meshtastic as never, meshcore as never));

    await result.current('meshcore', 'http', '10.0.0.1', undefined);

    expect(meshcore.prepareRfConnect).toHaveBeenCalledWith('tcp');
    expect(meshcore.attachRfSession).toHaveBeenCalledWith('id-meshtastic-driver', 'tcp');
  });
});

describe('useProtocolDisconnect (driver-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addIdentity({
      id: 'id-meshtastic-test',
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  it('finalizes legacy session then disconnects driver for the protocol identity', async () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();
    const { result } = renderHook(() =>
      useProtocolDisconnect(meshtastic as never, meshcore as never),
    );

    await result.current('meshtastic');

    expect(meshtastic.finalizeDriverDisconnect).toHaveBeenCalled();
    expect(mockDriverDisconnect).toHaveBeenCalledWith('id-meshtastic-test');
  });
});
