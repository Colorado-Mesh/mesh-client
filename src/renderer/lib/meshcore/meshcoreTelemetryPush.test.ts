import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildMeshcoreTelemetryMinDeltas,
  buildMeshcoreTelemetrySubscribeRequest,
  buildMeshcoreTelemetryUnsubscribeRequest,
  clampMeshcoreTelemetryPushTimeoutSecs,
  meshcoreTelemetryPushMetricForLppType,
  MeshcoreTelemetryPushRegistry,
  type MeshcoreTelemetryPushSubscription,
  meshcoreTelemetryResubscribeDelayMs,
  parseMeshcoreTelemetryPushPayload,
  parseMeshcoreTelemetrySubscribeReply,
  randomMeshcoreTelemetryPushTag,
} from './meshcoreTelemetryPush';

const SENSOR_CHANNELS = [
  { channel: 1, type: 116 }, // voltage
  { channel: 2, type: 103 }, // temperature
  { channel: 2, type: 104 }, // humidity
  { channel: 3, type: 115 }, // pressure
];

function sub(nodeId: number, tag: number): MeshcoreTelemetryPushSubscription {
  return {
    nodeId,
    tag,
    options: { timeoutSecs: 3600, thresholds: { temperature: 1 } },
    grantedSecs: 3600,
    subscribedAt: 0,
    lastPushAt: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildMeshcoreTelemetryMinDeltas', () => {
  it('encodes channel, type and a big-endian scaled delta per reported metric', () => {
    const out = buildMeshcoreTelemetryMinDeltas(SENSOR_CHANNELS, {
      temperature: 0.5,
      humidity: 2,
      voltage: 0.1,
    });
    // prettier-ignore
    expect([...out]).toEqual([
      2, 103, 0x00, 0x05, // temperature 0.5 °C ×10
      2, 104, 0x00, 0x14, // humidity 2 % ×10
      1, 116, 0x00, 0x0a, // voltage 0.1 V ×100
    ]);
  });

  it('skips metrics the sensor does not report and non-positive thresholds', () => {
    const out = buildMeshcoreTelemetryMinDeltas([{ channel: 4, type: 103 }], {
      temperature: 1.5,
      humidity: 2,
      voltage: 0,
    });
    expect([...out]).toEqual([4, 103, 0x00, 0x0f]);
  });

  it('stops at the 14-byte firmware limit', () => {
    const out = buildMeshcoreTelemetryMinDeltas(SENSOR_CHANNELS, {
      temperature: 1,
      humidity: 1,
      voltage: 1,
      pressure: 1,
    });
    expect(out.length).toBe(12);
    expect(out.includes(115)).toBe(false);
  });

  it('maps LPP types back to metrics', () => {
    expect(meshcoreTelemetryPushMetricForLppType(115)).toBe('pressure');
    expect(meshcoreTelemetryPushMetricForLppType(136)).toBeNull();
  });
});

describe('subscribe request', () => {
  it('lays out type, tag, timeout, reserved, length and deltas', () => {
    const deltas = Uint8Array.of(2, 103, 0, 5);
    const req = buildMeshcoreTelemetrySubscribeRequest(0x11223344, 3600, deltas);
    expect([...req]).toEqual([0x08, 0x44, 0x33, 0x22, 0x11, 0x10, 0x0e, 0, 4, 2, 103, 0, 5]);
  });

  it('clamps the timeout and rejects bad delta lengths', () => {
    expect(clampMeshcoreTelemetryPushTimeoutSecs(5)).toBe(60);
    expect(clampMeshcoreTelemetryPushTimeoutSecs(1e9)).toBe(0xffff);
    expect(clampMeshcoreTelemetryPushTimeoutSecs(Number.NaN)).toBe(60);
    expect(() => buildMeshcoreTelemetrySubscribeRequest(1, 60, Uint8Array.of(1, 2))).toThrow();
    expect(() => buildMeshcoreTelemetrySubscribeRequest(1, 60, new Uint8Array(15))).toThrow();
  });

  it('builds the one-byte unsubscribe request', () => {
    expect([...buildMeshcoreTelemetryUnsubscribeRequest()]).toEqual([0x09]);
  });
});

describe('reply and push parsing', () => {
  it('reads granted seconds and the NUL-terminated scope', () => {
    const scope = new TextEncoder().encode('#denver');
    const data = Uint8Array.of(0x10, 0x0e, 0, 0, ...scope, 0, 0xff);
    expect(parseMeshcoreTelemetrySubscribeReply(data)).toEqual({
      grantedSecs: 3600,
      scope: '#denver',
    });
    expect(parseMeshcoreTelemetrySubscribeReply(Uint8Array.of(0))).toEqual({
      grantedSecs: 0,
      scope: '',
    });
  });

  it('splits the push timestamp from the LPP body', () => {
    const parsed = parseMeshcoreTelemetryPushPayload(Uint8Array.of(1, 0, 0, 0x80, 2, 103, 0, 220));
    expect(parsed?.timestamp).toBe(0x80000001);
    expect([...(parsed?.lpp ?? [])]).toEqual([2, 103, 0, 220]);
    expect(parseMeshcoreTelemetryPushPayload(Uint8Array.of(1, 2))).toBeNull();
  });

  it('renews at 80% of the grant with a 30s floor', () => {
    expect(meshcoreTelemetryResubscribeDelayMs(3600)).toBe(2_880_000);
    expect(meshcoreTelemetryResubscribeDelayMs(10)).toBe(30_000);
  });

  it('never returns a zero tag', () => {
    const values = [0, 0, 42];
    expect(randomMeshcoreTelemetryPushTag(() => values.shift() ?? 1)).toBe(42);
  });
});

describe('MeshcoreTelemetryPushRegistry', () => {
  it('routes by tag and records the last push', () => {
    const reg = new MeshcoreTelemetryPushRegistry();
    reg.set(sub(1, 0xdeadbeef));
    reg.set(sub(2, 7));
    expect(reg.findByTag(0xdeadbeef)?.nodeId).toBe(1);
    expect(reg.findByTag(8)).toBeUndefined();
    expect(reg.markPush(2, 123)?.lastPushAt).toBe(123);
    expect(reg.get(2)?.lastPushAt).toBe(123);
  });

  it('pausing cancels timers but keeps subscriptions; clearing forgets them', () => {
    vi.useFakeTimers();
    const reg = new MeshcoreTelemetryPushRegistry();
    reg.set(sub(1, 5));
    const run = vi.fn();
    reg.scheduleResubscribe(1, 1000, run);
    reg.pauseAll();
    vi.advanceTimersByTime(2000);
    expect(run).not.toHaveBeenCalled();
    expect(reg.list()).toHaveLength(1);

    reg.scheduleResubscribe(1, 1000, run);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);

    reg.scheduleResubscribe(1, 1000, run);
    reg.clearAll();
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reg.list()).toHaveLength(0);
  });
});
