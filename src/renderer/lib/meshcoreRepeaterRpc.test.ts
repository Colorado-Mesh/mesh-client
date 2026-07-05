import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMeshcoreRepeaterLogin } from './meshcoreRepeaterLoginRpc';
import {
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  MC_PUSH_STATUS_RESPONSE,
  MC_PUSH_TELEMETRY_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
  parseRepeaterStatsFromStatusData,
} from './meshcoreRepeaterRpcCommon';
import { runMeshcoreRepeaterStatusRequest } from './meshcoreRepeaterStatusRpc';
import { runMeshcoreRepeaterTelemetryRequest } from './meshcoreRepeaterTelemetryRpc';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';

function createMockConn() {
  return createMockMeshcoreConn();
}

function buildStatusData(): Uint8Array {
  const buf = new ArrayBuffer(48);
  const view = new DataView(buf);
  let o = 0;
  view.setUint16(o, 3700, true);
  o += 2;
  view.setUint16(o, 2, true);
  o += 2;
  view.setInt16(o, -95, true);
  o += 2;
  view.setInt16(o, -80, true);
  o += 2;
  for (let i = 0; i < 8; i++) {
    view.setUint32(o, 100 + i, true);
    o += 4;
  }
  view.setUint16(o, 1, true);
  o += 2;
  view.setInt16(o, 8, true);
  o += 2;
  view.setUint16(o, 0, true);
  o += 2;
  view.setUint16(o, 0, true);
  return new Uint8Array(buf);
}

describe('parseRepeaterStatsFromStatusData', () => {
  it('parses LE fields matching meshcore.js layout', () => {
    const stats = parseRepeaterStatsFromStatusData(buildStatusData());
    expect(stats.batt_milli_volts).toBe(3700);
    expect(stats.curr_tx_queue_len).toBe(2);
    expect(stats.last_snr).toBe(8);
  });
});

describe('runMeshcoreRepeaterLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds when wrong-prefix LoginSuccess arrives before the matching one', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);
    const wrongPrefix = makePubKey(0xcd).subarray(0, 6);

    const loginPromise = runMeshcoreRepeaterLogin(conn, pubKey, 'secret');
    await Promise.resolve();

    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: wrongPrefix });
    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), permissions: 1 });

    await expect(loginPromise).resolves.toMatchObject({
      pubKeyPrefix: pubKey.subarray(0, 6),
      permissions: 1,
    });
  });

  it('succeeds when matching LoginFail arrives before LoginSuccess (meshcore.js ignores LoginFail)', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);

    const loginPromise = runMeshcoreRepeaterLogin(conn, pubKey, 'secret');
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    conn.emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: pubKey.subarray(0, 6) });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), permissions: 1 });

    await expect(loginPromise).resolves.toMatchObject({
      pubKeyPrefix: pubKey.subarray(0, 6),
      permissions: 1,
    });
  });

  it('rejects as timeout after matching LoginFail without LoginSuccess', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xcd);

    const loginPromise = runMeshcoreRepeaterLogin(conn, pubKey, 'bad');
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: pubKey.subarray(0, 6) });
    vi.advanceTimersByTime(100 + 10_000);

    await expect(loginPromise).rejects.toThrow(/^timeout$/i);
  });
});

describe('runMeshcoreRepeaterStatusRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds when wrong-prefix StatusResponse arrives before the matching one', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0x11);
    const wrongPrefix = makePubKey(0x22).subarray(0, 6);
    const statusData = buildStatusData();

    const statusPromise = runMeshcoreRepeaterStatusRequest(conn, pubKey, 1000);
    await Promise.resolve();

    conn.emit(MC_PUSH_STATUS_RESPONSE, { pubKeyPrefix: wrongPrefix, statusData });
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_STATUS_RESPONSE, {
      pubKeyPrefix: pubKey.subarray(0, 6),
      statusData,
    });

    await expect(statusPromise).resolves.toMatchObject({ batt_milli_volts: 3700 });
  });

  it('rejects on Err after send', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(3);
    const statusPromise = runMeshcoreRepeaterStatusRequest(conn, pubKey, 1000);
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    await expect(statusPromise).rejects.toThrow(/rejected status request/i);
  });
});

describe('runMeshcoreRepeaterTelemetryRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds when wrong-prefix TelemetryResponse arrives before the matching one', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0x33);
    const wrongPrefix = makePubKey(0x44).subarray(0, 6);
    const lppSensorData = new Uint8Array([1, 2, 3]);

    const telemetryPromise = runMeshcoreRepeaterTelemetryRequest(conn, pubKey, 1000);
    await Promise.resolve();

    conn.emit(MC_PUSH_TELEMETRY_RESPONSE, { pubKeyPrefix: wrongPrefix, lppSensorData });
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_TELEMETRY_RESPONSE, {
      pubKeyPrefix: pubKey.subarray(0, 6),
      lppSensorData,
    });

    await expect(telemetryPromise).resolves.toMatchObject({ lppSensorData });
  });
});
