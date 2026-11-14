import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSendSelfTelemetryReqFrame,
  MC_PUSH_TELEMETRY_RESPONSE,
} from './meshcoreRepeaterRpcCommon';
import { runMeshcoreSelfTelemetryRequest } from './meshcoreSelfTelemetryRpc';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';
import { MC_CMD_SEND_TELEMETRY_REQ } from './meshcoreWireCodes';

describe('runMeshcoreSelfTelemetryRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the 4-byte self frame and resolves on matching TelemetryResponse', async () => {
    const conn = createMockMeshcoreConn();
    const selfKey = makePubKey(0x26);
    const lppSensorData = new Uint8Array([1, 136, 0x18, 0x6a, 0x00, 0x9c, 0x40, 0x00, 0x00, 0x64]);

    const promise = runMeshcoreSelfTelemetryRequest(conn, selfKey, { timeoutMs: 5000 });
    await Promise.resolve();

    expect(conn.sentFrames).toHaveLength(1);
    expect(conn.sentFrames[0]).toEqual(buildSendSelfTelemetryReqFrame());
    expect(conn.sentFrames[0]?.[0]).toBe(MC_CMD_SEND_TELEMETRY_REQ);
    expect(conn.sentFrames[0]?.length).toBe(4);

    conn.emit(MC_PUSH_TELEMETRY_RESPONSE, {
      pubKeyPrefix: selfKey.subarray(0, 6),
      lppSensorData,
    });

    await expect(promise).resolves.toMatchObject({ lppSensorData });
  });

  it('ignores wrong-prefix TelemetryResponse until the matching one arrives', async () => {
    const conn = createMockMeshcoreConn();
    const selfKey = makePubKey(0x33);
    const wrongPrefix = makePubKey(0x44).subarray(0, 6);
    const lppSensorData = new Uint8Array([2, 3, 4]);

    const promise = runMeshcoreSelfTelemetryRequest(conn, selfKey, { timeoutMs: 5000 });
    await Promise.resolve();

    conn.emit(MC_PUSH_TELEMETRY_RESPONSE, { pubKeyPrefix: wrongPrefix, lppSensorData });
    conn.emit(MC_PUSH_TELEMETRY_RESPONSE, {
      pubKeyPrefix: selfKey.subarray(0, 6),
      lppSensorData,
    });

    await expect(promise).resolves.toMatchObject({ lppSensorData });
  });

  it('times out when no matching TelemetryResponse arrives', async () => {
    const conn = createMockMeshcoreConn();
    const selfKey = makePubKey(0x55);

    const promise = runMeshcoreSelfTelemetryRequest(conn, selfKey, { timeoutMs: 1000 });
    await Promise.resolve();
    const expectation = expect(promise).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });
});
