import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useProtocolConnectionActions } from './useProtocolConnection';

function createMeshtasticStub() {
  return {
    state: { status: 'disconnected' as const, myNodeNum: 0, connectionType: null },
    mqttStatus: 'disconnected' as const,
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function createMeshcoreStub() {
  return {
    state: { status: 'configured' as const, myNodeNum: 42, connectionType: 'ble' as const },
    mqttStatus: 'disconnected' as const,
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('./useConnect', () => ({
  useConnect: () => vi.fn().mockResolvedValue('id-test-driver'),
}));

vi.mock('./useDisconnect', () => ({
  useDisconnect: () => vi.fn().mockResolvedValue(undefined),
}));

describe('useProtocolConnectionActions', () => {
  it('driver-first connect prepares and attaches Meshtastic legacy session', async () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();

    const { result } = renderHook(() =>
      useProtocolConnectionActions('meshtastic', meshtastic as never, meshcore as never),
    );

    await result.current.connect('serial', undefined, undefined);

    expect(meshtastic.prepareRfConnect).toHaveBeenCalledWith('serial', undefined, undefined);
    expect(meshtastic.attachRfSession).toHaveBeenCalledWith('id-test-driver', 'serial');
    expect(meshtastic.connect).not.toHaveBeenCalled();
  });

  it('maps http to tcp for meshcore driver-first connect', async () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();

    const { result } = renderHook(() =>
      useProtocolConnectionActions('meshcore', meshtastic as never, meshcore as never),
    );

    await result.current.connect('http', '192.168.1.1', undefined);

    expect(meshcore.prepareRfConnect).toHaveBeenCalledWith('tcp');
    expect(meshcore.attachRfSession).toHaveBeenCalledWith('id-test-driver', 'tcp');
    expect(meshcore.connect).not.toHaveBeenCalled();
  });

  it('exposes state from the selected protocol instance', () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();

    const { result: meshcoreResult } = renderHook(() =>
      useProtocolConnectionActions('meshcore', meshtastic as never, meshcore as never),
    );

    expect(meshcoreResult.current.state.myNodeNum).toBe(42);
  });
});
