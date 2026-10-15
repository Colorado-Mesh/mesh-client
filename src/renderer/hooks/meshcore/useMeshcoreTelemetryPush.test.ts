import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MC_PUSH_BINARY_RESPONSE } from '../../lib/meshcoreWireCodes';
import {
  MESHCORE_TELEMETRY_PUSH_RECONNECT_DELAY_MS,
  MeshcoreTelemetryPushError,
  useMeshcoreTelemetryPush,
  type UseMeshcoreTelemetryPushDeps,
} from './useMeshcoreTelemetryPush';

type Listener = (...args: unknown[]) => void;

function fakeConn() {
  const listeners = new Map<string | number, Set<Listener>>();
  return {
    on: vi.fn((event: string | number, cb: Listener) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
    }),
    off: vi.fn((event: string | number, cb: Listener) => {
      listeners.get(event)?.delete(cb);
    }),
    emit(event: string | number, payload: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    },
  };
}

const GRANTED_3600 = Uint8Array.of(0x10, 0x0e, 0, 0);
const OPTIONS = { timeoutSecs: 3600, thresholds: { temperature: 0.5 } };

function makeDeps(
  conn: ReturnType<typeof fakeConn>,
  overrides: Partial<UseMeshcoreTelemetryPushDeps> = {},
): UseMeshcoreTelemetryPushDeps {
  return {
    connRef: { current: conn },
    connected: true,
    getTelemetryChannels: vi.fn(() => Promise.resolve([{ channel: 2, type: 103 }])),
    sendSensorRequest: vi.fn(() => Promise.resolve(GRANTED_3600)),
    onPushTelemetry: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMeshcoreTelemetryPush', () => {
  it('subscribes with min-deltas from the sensor channels and routes pushes by tag', async () => {
    const conn = fakeConn();
    const deps = makeDeps(conn);
    const { result } = renderHook(() => useMeshcoreTelemetryPush(deps));

    let tag = 0;
    await act(async () => {
      tag = (await result.current.subscribe(9, OPTIONS)).tag;
    });
    const sent = vi.mocked(deps.sendSensorRequest).mock.calls[0][1];
    expect(sent[0]).toBe(0x08);
    expect([...sent.subarray(8)]).toEqual([4, 2, 103, 0, 5]);
    expect(result.current.subscriptions.get(9)?.grantedSecs).toBe(3600);

    act(() => {
      conn.emit(MC_PUSH_BINARY_RESPONSE, {
        tag: tag ^ 1,
        responseData: Uint8Array.of(0, 0, 0, 0, 9),
      });
      conn.emit(MC_PUSH_BINARY_RESPONSE, {
        tag,
        responseData: Uint8Array.of(1, 0, 0, 0, 2, 103, 0, 220),
      });
    });
    expect(deps.onPushTelemetry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.onPushTelemetry).mock.calls[0][0]).toBe(9);
    expect([...vi.mocked(deps.onPushTelemetry).mock.calls[0][1]]).toEqual([2, 103, 0, 220]);
    expect(result.current.subscriptions.get(9)?.lastPushAt).not.toBeNull();
  });

  it('reports noMetrics and rejected as typed errors', async () => {
    const conn = fakeConn();
    const noChannels = makeDeps(conn, { getTelemetryChannels: () => Promise.resolve([]) });
    const a = renderHook(() => useMeshcoreTelemetryPush(noChannels));
    await expect(a.result.current.subscribe(1, OPTIONS)).rejects.toMatchObject({
      code: 'noMetrics',
    });
    expect(noChannels.sendSensorRequest).not.toHaveBeenCalled();

    const refused = makeDeps(conn, {
      sendSensorRequest: () => Promise.resolve(Uint8Array.of(0, 0, 0, 0)),
    });
    const b = renderHook(() => useMeshcoreTelemetryPush(refused));
    const err: unknown = await b.result.current.subscribe(1, OPTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeshcoreTelemetryPushError);
    expect((err as MeshcoreTelemetryPushError).code).toBe('rejected');
    expect(b.result.current.subscriptions.size).toBe(0);
  });

  it('unsubscribe forgets the node first and sends 0x09', async () => {
    const conn = fakeConn();
    const deps = makeDeps(conn);
    const { result } = renderHook(() => useMeshcoreTelemetryPush(deps));
    await act(async () => {
      await result.current.subscribe(9, OPTIONS);
    });
    await act(async () => {
      await result.current.unsubscribe(9);
    });
    expect(result.current.subscriptions.has(9)).toBe(false);
    expect([...vi.mocked(deps.sendSensorRequest).mock.calls[1][1]]).toEqual([0x09]);
  });

  it('pauses on disconnect and re-subscribes after reconnect', async () => {
    vi.useFakeTimers();
    const conn = fakeConn();
    const deps = makeDeps(conn);
    const { result, rerender } = renderHook(
      (props: { connected: boolean }) =>
        useMeshcoreTelemetryPush({ ...deps, connected: props.connected }),
      { initialProps: { connected: true } },
    );
    await act(async () => {
      await result.current.subscribe(9, OPTIONS);
    });
    expect(deps.sendSensorRequest).toHaveBeenCalledTimes(1);

    rerender({ connected: false });
    expect(conn.off).toHaveBeenCalled();
    rerender({ connected: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESHCORE_TELEMETRY_PUSH_RECONNECT_DELAY_MS);
    });
    expect(deps.sendSensorRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.sendSensorRequest).mock.calls[1][1][0]).toBe(0x08);
  });

  it('clearAll drops subscriptions without sending anything', async () => {
    const conn = fakeConn();
    const deps = makeDeps(conn);
    const { result } = renderHook(() => useMeshcoreTelemetryPush(deps));
    await act(async () => {
      await result.current.subscribe(9, OPTIONS);
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.subscriptions.size).toBe(0);
    expect(deps.sendSensorRequest).toHaveBeenCalledTimes(1);
  });

  it('discards a late subscribe reply after unsubscribe so it cannot restore the subscription', async () => {
    const conn = fakeConn();
    let release: (body: Uint8Array) => void = () => {};
    const deps = makeDeps(conn, {
      sendSensorRequest: vi.fn(
        () =>
          new Promise<Uint8Array>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useMeshcoreTelemetryPush(deps));
    let subscribePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      subscribePromise = result.current.subscribe(9, OPTIONS).catch((e: unknown) => e);
    });
    await act(async () => {
      await result.current.unsubscribe(9);
    });
    await act(async () => {
      release(GRANTED_3600);
      await subscribePromise;
    });
    expect(result.current.subscriptions.has(9)).toBe(false);
  });
});
