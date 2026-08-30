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
        expect.stringContaining(
          `[meshtasticTransportSideEffects] tcp: heartbeat send failed ` +
            errLikeToLogString(rejectionValue),
        ),
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

  describe('heartbeat failure diagnostics', () => {
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    function debugLines(): string[] {
      return debugSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    }

    function findLine(fragment: string): string | undefined {
      return debugLines().find((line) => line.includes(fragment));
    }

    it('records elapsed time and queue depth so a stalled write is distinguishable from teardown', async () => {
      // Mirrors the suspected cause: sendRaw's queued item is dropped by the SDK's own 60s
      // queue timeout, so the rejection arrives a full interval after the send started.
      const queueItems = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              setTimeout(() => {
                reject(new Error('Packet does not exist'));
              }, 60_000);
            }),
        ),
        queue: { getState: () => queueItems },
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      const line = findLine('heartbeat send failed');
      expect(line).toContain('elapsed=60000ms');
      expect(line).toContain('queueDepth=3->3');
      expect(line).toContain('consecutive=1');
      expect(line).not.toContain('teardown');
      expect(onTransportLost).not.toHaveBeenCalled();
    });

    it('reports an unknown queue depth rather than throwing when the device exposes no queue', async () => {
      const device = {
        heartbeat: vi.fn().mockRejectedValue(new Error('Packet does not exist')),
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(findLine('heartbeat send failed')).toContain('queueDepth=?->?');
    });

    it('labels a rejection that lands after unsubscribe as teardown', async () => {
      let rejectHeartbeat: (reason: unknown) => void = () => {};
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectHeartbeat = reject;
            }),
        ),
        queue: { getState: () => [] },
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);
      for (const unsub of unsubs) unsub();
      rejectHeartbeat(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(0);

      expect(findLine('heartbeat send failed')).toContain('teardown');
      expect(onTransportLost).not.toHaveBeenCalled();
    });

    it('counts consecutive failures and logs recovery on the next success', async () => {
      const device = {
        heartbeat: vi
          .fn()
          .mockRejectedValueOnce(new Error('Packet does not exist'))
          .mockRejectedValueOnce(new Error('Packet does not exist'))
          .mockResolvedValue(0),
        queue: { getState: () => [] },
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(findLine('consecutive=1')).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(findLine('consecutive=2')).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(findLine('heartbeat recovered after 2 consecutive failures')).toBeDefined();

      // Counter resets, so a later failure starts from 1 again.
      device.heartbeat = vi.fn().mockRejectedValue(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(debugLines().filter((line) => line.includes('consecutive=1'))).toHaveLength(2);
      expect(onTransportLost).not.toHaveBeenCalled();
    });
  });
});
