import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSendAnonReqFrame,
  parseMeshcoreAnonBasicResponse,
  parseMeshcoreAnonOwnerResponse,
  parseMeshcoreAnonRegionsResponse,
  runMeshcoreAnonRegionsRequest,
  runMeshcoreAnonRequest,
} from './meshcoreAnonRequestRpc';
import { MC_PUSH_BINARY_RESPONSE, MC_RESP_ERR, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';
import {
  MC_ANON_REQ_TYPE_BASIC,
  MC_ANON_REQ_TYPE_OWNER,
  MC_ANON_REQ_TYPE_REGIONS,
  MC_CMD_SEND_ANON_REQ,
} from './meshcoreWireCodes';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';

function clockBytes(clock: number, rest: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + rest.length);
  new DataView(out.buffer).setUint32(0, clock >>> 0, true);
  out.set(rest, 4);
  return out;
}

describe('buildSendAnonReqFrame', () => {
  it('frames CMD 57 + pubkey + subtype + zero reply path', () => {
    const key = makePubKey(0x11);
    const frame = buildSendAnonReqFrame(key, MC_ANON_REQ_TYPE_REGIONS);
    expect(frame[0]).toBe(MC_CMD_SEND_ANON_REQ);
    expect(frame.subarray(1, 33)).toEqual(key);
    expect(frame[33]).toBe(MC_ANON_REQ_TYPE_REGIONS);
    expect(frame[34]).toBe(0);
    expect(frame.length).toBe(35);
  });

  it.each([
    [MC_ANON_REQ_TYPE_OWNER, 0x02],
    [MC_ANON_REQ_TYPE_BASIC, 0x03],
  ] as const)('embeds subtype %s', (subtype, expected) => {
    expect(buildSendAnonReqFrame(makePubKey(1), subtype)[33]).toBe(expected);
  });

  it('rejects non-32-byte keys', () => {
    expect(() => buildSendAnonReqFrame(new Uint8Array(16), MC_ANON_REQ_TYPE_REGIONS)).toThrow(
      /32-byte/,
    );
  });
});

describe('parseMeshcoreAnonRegionsResponse', () => {
  it('parses clock + CSV and drops * / empties', () => {
    const payload = clockBytes(1_700_000_000, new TextEncoder().encode('*,#us,us-tn-tri,,*\0\0\0'));
    expect(parseMeshcoreAnonRegionsResponse(payload)).toEqual({
      clock: 1_700_000_000,
      names: ['#us', 'us-tn-tri'],
    });
  });

  it('rejects short / non-printable payloads', () => {
    expect(() => parseMeshcoreAnonRegionsResponse(new Uint8Array([1, 2, 3]))).toThrow(/invalid/);
    const bad = clockBytes(1, new TextEncoder().encode('ok,\x01bad'));
    expect(() => parseMeshcoreAnonRegionsResponse(bad)).toThrow(/invalid/);
  });
});

describe('parseMeshcoreAnonOwnerResponse', () => {
  it('splits node name and owner info after clock', () => {
    const payload = clockBytes(42, new TextEncoder().encode('Tower-A\nCallsign / notes\0\0'));
    expect(parseMeshcoreAnonOwnerResponse(payload)).toEqual({
      clock: 42,
      nodeName: 'Tower-A',
      ownerInfo: 'Callsign / notes',
    });
  });

  it('allows empty owner info', () => {
    const payload = clockBytes(7, new TextEncoder().encode('OnlyName\n'));
    expect(parseMeshcoreAnonOwnerResponse(payload)).toMatchObject({
      nodeName: 'OnlyName',
      ownerInfo: '',
    });
  });
});

describe('parseMeshcoreAnonBasicResponse', () => {
  it('parses clock and feature flags', () => {
    const payload = new Uint8Array(5);
    new DataView(payload.buffer).setUint32(0, 99, true);
    payload[4] = 0x81; // UART bridge + forwarding disabled
    expect(parseMeshcoreAnonBasicResponse(payload)).toEqual({
      clock: 99,
      features: 0x81,
      isBridge: true,
      bridgeKind: 'uart',
      forwardingDisabled: true,
    });
  });

  it('detects ESP-NOW bridge bits', () => {
    const payload = new Uint8Array(5);
    new DataView(payload.buffer).setUint32(0, 1, true);
    payload[4] = 0x03;
    expect(parseMeshcoreAnonBasicResponse(payload).bridgeKind).toBe('espnow');
  });
});

describe('runMeshcoreAnonRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the anon frame and resolves BinaryResponse after SENT', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x55);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const responseData = clockBytes(10, new TextEncoder().encode('us,tn'));

    const promise = runMeshcoreAnonRegionsRequest(conn, pubKey, 1000, runSerialized);
    await Promise.resolve();
    await Promise.resolve();
    expect(conn.sentFrames[0]).toEqual(buildSendAnonReqFrame(pubKey, MC_ANON_REQ_TYPE_REGIONS));

    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 0xabcd });
    await Promise.resolve();
    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0xabcd, responseData });
    await expect(promise).resolves.toEqual({ clock: 10, names: ['us', 'tn'] });
  });

  it('accepts BinaryResponse with tag 0 after SENT (ANON quirk)', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x66);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const responseData = clockBytes(1, new TextEncoder().encode('hu'));

    const promise = runMeshcoreAnonRegionsRequest(conn, pubKey, 1000, runSerialized);
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 50, expectedAckCrc: 0xcafe1234 });
    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0, responseData });
    await expect(promise).resolves.toEqual({ clock: 1, names: ['hu'] });
  });

  it('accepts first BinaryResponse when SENT has no expectedAckCrc', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x77);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const responseData = clockBytes(2, new TextEncoder().encode('a'));

    const promise = runMeshcoreAnonRegionsRequest(conn, pubKey, 1000, runSerialized);
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 50 });
    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0, responseData });
    await expect(promise).resolves.toEqual({ clock: 2, names: ['a'] });
  });

  it('rejects when SENT reports flood routing', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x88);
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreAnonRequest(
      conn,
      pubKey,
      MC_ANON_REQ_TYPE_REGIONS,
      1000,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 50, expectedAckCrc: 1, type: 1 });
    await expect(promise).rejects.toThrow(/flood/i);
  });

  it('ignores mismatched non-zero tags then times out', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x99);
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreAnonRequest(
      conn,
      pubKey,
      MC_ANON_REQ_TYPE_BASIC,
      500,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 0x1111 });
    conn.emit(MC_PUSH_BINARY_RESPONSE, {
      tag: 0x2222,
      responseData: new Uint8Array([1, 2, 3, 4, 5]),
    });
    vi.advanceTimersByTime(600);
    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('rejects on Err after send', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const promise = runMeshcoreAnonRequest(
      conn,
      makePubKey(3),
      MC_ANON_REQ_TYPE_OWNER,
      1000,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    await expect(promise).rejects.toThrow(/rejected request/i);
  });
});
