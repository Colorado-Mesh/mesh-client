// @vitest-environment jsdom
import type { MeshDevice } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errLikeToLogString } from '../errLikeToLogString';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';
import { pushMeshtasticTransportSideEffectUnsubs } from './meshtasticTransportSideEffects';

vi.mock('./meshtasticTransportLossDetection', () => ({
  attachMeshtasticTransportLossWatch: vi.fn(() => () => {}),
}));

describe('pushMeshtasticTransportSideEffectUnsubs', () => {
  const onTransportLost = vi.fn();
  let unsubs: (() => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    unsubs = [];
    window.electronAPI.onNobleBleDisconnected = vi.fn(() => () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockDevice(): MeshDevice {
    return {
      heartbeat: vi.fn().mockResolvedValue(0),
    } as unknown as MeshDevice;
  }

  it('attaches serialized transport and heartbeat for BLE', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'ble',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(device, 'ble', onTransportLost);
    vi.advanceTimersByTime(60_000);
    expect(device.heartbeat).toHaveBeenCalledTimes(1);
    expect(unsubs).toHaveLength(2);
  });

  it('attaches serialized transport and heartbeat for serial', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'serial',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(
      device,
      'serial',
      onTransportLost,
    );
    vi.advanceTimersByTime(60_000);
    expect(device.heartbeat).toHaveBeenCalledTimes(1);
    expect(unsubs).toHaveLength(2);
  });

  it('attaches serialized transport but skips heartbeat for HTTP', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'http',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    // Regression: HTTP's toDevice must be serialized too, or concurrent SDK
    // getWriter() calls (queue vs. NODEINFO/GetMetadata retries) throw
    // "WritableStream is locked" and silently drop outbound writes/sends.
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(
      device,
      'http',
      onTransportLost,
    );
    vi.advanceTimersByTime(60_000);
    expect(device.heartbeat).not.toHaveBeenCalled();
    expect(unsubs).toHaveLength(1);
  });

  it('attaches serialized transport and heartbeat for TCP', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'tcp',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    expect(window.electronAPI.onNobleBleDisconnected).not.toHaveBeenCalled();
    // TCP is a persistent duplex link like serial/BLE, not a polling link like HTTP,
    // so it gets both the serialized-writer wrap and heartbeat.
    expect(attachMeshtasticTransportLossWatch).toHaveBeenCalledWith(device, 'tcp', onTransportLost);
    vi.advanceTimersByTime(60_000);
    expect(device.heartbeat).toHaveBeenCalledTimes(1);
    expect(unsubs).toHaveLength(2);
  });

  it('logs a normalized debug line and does not surface an unhandled rejection when heartbeat rejects with a non-Error', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const unhandledSpy = vi.fn();
    window.addEventListener('unhandledrejection', unhandledSpy);
    const rejectionValue = 'queue-gone: Packet does not exist';
    const device = {
      heartbeat: vi.fn().mockRejectedValue(rejectionValue),
    } as unknown as MeshDevice;
    try {
      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(device.heartbeat).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith(
        `[meshtasticTransportSideEffects] tcp: heartbeat send failed ` +
          errLikeToLogString(rejectionValue),
      );
      expect(unhandledSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandledSpy);
      debugSpy.mockRestore();
    }
  });

  it('stops the heartbeat after its unsubscribe runs', () => {
    const device = mockDevice();
    pushMeshtasticTransportSideEffectUnsubs(
      device,
      'tcp',
      (unsub) => unsubs.push(unsub),
      onTransportLost,
    );

    for (const unsub of unsubs) unsub();
    vi.advanceTimersByTime(180_000);
    expect(device.heartbeat).not.toHaveBeenCalled();
  });
});
