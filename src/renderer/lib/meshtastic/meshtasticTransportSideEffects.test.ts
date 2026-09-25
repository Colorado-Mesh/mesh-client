// @vitest-environment jsdom
import type { MeshDevice } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errLikeToLogString } from '../errLikeToLogString';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';
import {
  isElevatedMeshtasticHeartbeatFailure,
  pushMeshtasticTransportSideEffectUnsubs,
} from './meshtasticTransportSideEffects';

vi.mock('./meshtasticTransportLossDetection', () => ({
  attachMeshtasticTransportLossWatch: vi.fn(() => () => {}),
}));

describe('isElevatedMeshtasticHeartbeatFailure', () => {
  const idle = {
    consecutive: 1,
    elapsedMs: 61_000,
    depthBefore: 1,
    depthAfter: 1,
    tornDown: false,
  };

  it.each([
    ['idle 60s settle with stable queue', idle, false],
    [
      '0→1 queue is the heartbeat item, not a backlog',
      { ...idle, depthBefore: 0, depthAfter: 1 },
      false,
    ],
    ['1→0 drain is not a backlog', { ...idle, depthBefore: 1, depthAfter: 0 }, false],
    ['second consecutive miss', { ...idle, consecutive: 2 }, true],
    ['teardown race', { ...idle, tornDown: true }, true],
    ['settle far below 60s', { ...idle, elapsedMs: 5_000 }, true],
    ['settle far above 60s', { ...idle, elapsedMs: 120_000 }, true],
    ['queue grew beyond the heartbeat item', { ...idle, depthBefore: 1, depthAfter: 3 }, true],
    ['empty queue filled with a backlog', { ...idle, depthBefore: 0, depthAfter: 3 }, true],
  ] as const)('%s', (_name, diagnostics, expected) => {
    expect(isElevatedMeshtasticHeartbeatFailure(diagnostics)).toBe(expected);
  });
});

describe('pushMeshtasticTransportSideEffectUnsubs', () => {
  const onTransportLost = vi.fn();
  let unsubs: (() => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    unsubs = [];
    window.electronAPI.onGattDisconnected = vi.fn(() => () => {});
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

    expect(window.electronAPI.onGattDisconnected).not.toHaveBeenCalled();
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

    expect(window.electronAPI.onGattDisconnected).not.toHaveBeenCalled();
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

    expect(window.electronAPI.onGattDisconnected).not.toHaveBeenCalled();
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

    expect(window.electronAPI.onGattDisconnected).not.toHaveBeenCalled();
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

    it('stays quiet for the idle 60s queue-timeout with a stable queue', async () => {
      let calls = 0;
      const device = {
        heartbeat: vi.fn(() => {
          calls += 1;
          if (calls === 1) {
            return new Promise((_resolve, reject) => {
              setTimeout(() => {
                reject(new Error('Packet does not exist'));
              }, 60_000);
            });
          }
          return Promise.resolve(0);
        }),
        queue: { getState: () => [{ id: 1 }] },
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(findLine('heartbeat send failed')).toBeUndefined();
      expect(findLine('heartbeat recovered')).toBeUndefined();
      expect(onTransportLost).not.toHaveBeenCalled();
    });

    it('logs elapsed time and queue depth when the queue grows during the wait', async () => {
      let depth = 1;
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              setTimeout(() => {
                depth = 3;
                reject(new Error('Packet does not exist'));
              }, 60_000);
            }),
        ),
        queue: {
          getState: () => Array.from({ length: depth }, (_, id) => ({ id })),
        },
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
      expect(line).toContain('queueDepth=1->3');
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

    it('does not log recover when an older heartbeat settles after a newer elevated reject', async () => {
      const pending: { resolve: () => void; reject: (reason: unknown) => void }[] = [];
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              pending.push({
                resolve: () => {
                  resolve(0);
                },
                reject,
              });
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
      expect(pending).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pending).toHaveLength(2);

      pending[1]?.reject(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat send failed')).toBeDefined();
      expect(findLine('heartbeat recovered')).toBeUndefined();

      pending[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat recovered')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(60_000);
      pending[2]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat recovered after 1 consecutive failures')).toBeDefined();
      expect(onTransportLost).not.toHaveBeenCalled();
    });

    it('does not log recover when a pending heartbeat fulfills after teardown', async () => {
      const pending: { resolve: () => void; reject: (reason: unknown) => void }[] = [];
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              pending.push({
                resolve: () => {
                  resolve(0);
                },
                reject,
              });
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
      pending[0]?.reject(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat send failed')).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(pending).toHaveLength(2);
      for (const unsub of unsubs) unsub();
      pending[1]?.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(findLine('heartbeat recovered')).toBeUndefined();
      expect(onTransportLost).not.toHaveBeenCalled();
    });

    it('logs the second consecutive 60s miss and recovers only after that elevated fail', async () => {
      let settle: { resolve: () => void; reject: (reason: unknown) => void } | undefined;
      const device = {
        heartbeat: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              settle = {
                resolve: () => {
                  resolve(0);
                },
                reject,
              };
            }),
        ),
        queue: { getState: () => [{ id: 1 }] },
      } as unknown as MeshDevice;

      pushMeshtasticTransportSideEffectUnsubs(
        device,
        'tcp',
        (unsub) => unsubs.push(unsub),
        onTransportLost,
      );

      // Reject just before the next interval tick so elapsed stays in the ~60s
      // band and the following heartbeat does not settle on the same timer fire.
      await vi.advanceTimersByTimeAsync(60_000);
      const first = settle;
      await vi.advanceTimersByTimeAsync(60_000 - 1);
      first?.reject(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat send failed')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      const second = settle;
      await vi.advanceTimersByTimeAsync(60_000 - 1);
      second?.reject(new Error('Packet does not exist'));
      await vi.advanceTimersByTimeAsync(0);
      const failLine = findLine('heartbeat send failed');
      expect(failLine).toContain('elapsed=59999ms');
      expect(failLine).toContain('consecutive=2');
      expect(findLine('heartbeat recovered')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      settle?.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(findLine('heartbeat recovered after 2 consecutive failures')).toBeDefined();
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
