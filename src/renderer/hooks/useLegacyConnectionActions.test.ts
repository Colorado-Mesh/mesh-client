import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useProtocolConnectionActions } from './useProtocolConnection';

function createMeshtasticStub() {
  return {
    state: { status: 'disconnected' as const, myNodeNum: 0, connectionType: null },
    mqttStatus: 'disconnected' as const,
    connect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function createMeshcoreStub() {
  return {
    state: { status: 'configured' as const, myNodeNum: 42, connectionType: 'ble' as const },
    mqttStatus: 'disconnected' as const,
    connect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useProtocolConnectionActions', () => {
  it('routes connect to the protocol instance without mounting legacy hooks', () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();

    const { result } = renderHook(() =>
      useProtocolConnectionActions('meshtastic', meshtastic as never, meshcore as never),
    );

    void result.current.connect('serial', undefined, undefined);

    expect(meshtastic.connect).toHaveBeenCalledWith('serial', undefined, undefined);
    expect(meshcore.connect).not.toHaveBeenCalled();
  });

  it('maps http to tcp for meshcore manual connect', () => {
    const meshtastic = createMeshtasticStub();
    const meshcore = createMeshcoreStub();

    const { result } = renderHook(() =>
      useProtocolConnectionActions('meshcore', meshtastic as never, meshcore as never),
    );

    void result.current.connect('http', '192.168.1.1', undefined);

    expect(meshcore.connect).toHaveBeenCalledWith('tcp', '192.168.1.1', undefined);
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
