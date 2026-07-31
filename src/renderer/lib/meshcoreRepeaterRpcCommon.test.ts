import { describe, expect, it } from 'vitest';

import {
  buildSendBinaryReqFrame,
  buildSendLoginFrame,
  buildSendStatusReqFrame,
  buildSendTelemetryReqFrame,
  MESHCORE_PUBKEY_PREFIX_LEN,
  meshcoreLoginErrorIsAuthFailure,
  normalizePubKeyPrefix,
  parseRepeaterStatsFromStatusData,
  prefixToHex,
  pubKeyPrefixesEqual,
  requireContactPubKeyPrefix,
  unknownToError,
} from './meshcoreRepeaterRpcCommon';
import { makePubKey } from './meshcoreTestHelpers';
import {
  MC_CMD_SEND_BINARY_REQ,
  MC_CMD_SEND_LOGIN,
  MC_CMD_SEND_STATUS_REQ,
  MC_CMD_SEND_TELEMETRY_REQ,
} from './meshcoreWireCodes';

function buildStatusData(stats: {
  batt_milli_volts: number;
  curr_tx_queue_len: number;
  noise_floor: number;
  last_rssi: number;
  n_packets_recv: number;
  n_packets_sent: number;
  total_air_time_secs: number;
  total_up_time_secs: number;
  n_sent_flood: number;
  n_sent_direct: number;
  n_recv_flood: number;
  n_recv_direct: number;
  err_events: number;
  last_snr: number;
  n_direct_dups: number;
  n_flood_dups: number;
}): Uint8Array {
  const buf = new ArrayBuffer(48);
  const view = new DataView(buf);
  let o = 0;
  view.setUint16(o, stats.batt_milli_volts, true);
  o += 2;
  view.setUint16(o, stats.curr_tx_queue_len, true);
  o += 2;
  view.setInt16(o, stats.noise_floor, true);
  o += 2;
  view.setInt16(o, stats.last_rssi, true);
  o += 2;
  view.setUint32(o, stats.n_packets_recv, true);
  o += 4;
  view.setUint32(o, stats.n_packets_sent, true);
  o += 4;
  view.setUint32(o, stats.total_air_time_secs, true);
  o += 4;
  view.setUint32(o, stats.total_up_time_secs, true);
  o += 4;
  view.setUint32(o, stats.n_sent_flood, true);
  o += 4;
  view.setUint32(o, stats.n_sent_direct, true);
  o += 4;
  view.setUint32(o, stats.n_recv_flood, true);
  o += 4;
  view.setUint32(o, stats.n_recv_direct, true);
  o += 4;
  view.setUint16(o, stats.err_events, true);
  o += 2;
  view.setInt16(o, stats.last_snr, true);
  o += 2;
  view.setUint16(o, stats.n_direct_dups, true);
  o += 2;
  view.setUint16(o, stats.n_flood_dups, true);
  return new Uint8Array(buf);
}

describe('requireContactPubKeyPrefix', () => {
  it('returns the first 6 bytes of a long enough key', () => {
    const key = makePubKey(0xab);
    const prefix = requireContactPubKeyPrefix(key);
    expect(prefix).toEqual(key.subarray(0, MESHCORE_PUBKEY_PREFIX_LEN));
    expect(prefix.length).toBe(6);
  });

  it('throws when the key is shorter than 6 bytes', () => {
    expect(() => requireContactPubKeyPrefix(new Uint8Array([1, 2, 3]))).toThrow(
      /public key too short for prefix match/,
    );
  });
});

describe('normalizePubKeyPrefix', () => {
  it('accepts a 6-byte Uint8Array', () => {
    const prefix = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(normalizePubKeyPrefix(prefix)).toEqual(prefix);
  });

  it('accepts a DataView of length 6', () => {
    const buf = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    const view = new DataView(buf.buffer, 1, 6);
    expect(normalizePubKeyPrefix(view)).toEqual(new Uint8Array([8, 7, 6, 5, 4, 3]));
  });

  it('accepts a 6-element number array', () => {
    expect(normalizePubKeyPrefix([10, 20, 30, 40, 50, 60])).toEqual(
      new Uint8Array([10, 20, 30, 40, 50, 60]),
    );
  });

  it('returns null for wrong lengths and non-array-likes', () => {
    expect(normalizePubKeyPrefix(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(normalizePubKeyPrefix([1, 2, 3, 4, 5])).toBeNull();
    expect(normalizePubKeyPrefix(null)).toBeNull();
    expect(normalizePubKeyPrefix('deadbeef')).toBeNull();
  });
});

describe('pubKeyPrefixesEqual / prefixToHex', () => {
  it('compares equal 6-byte prefixes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const b = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(pubKeyPrefixesEqual(a, b)).toBe(true);
  });

  it('returns false for mismatched bytes or wrong lengths', () => {
    expect(
      pubKeyPrefixesEqual(new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([1, 2, 3, 4, 5, 7])),
    ).toBe(false);
    expect(pubKeyPrefixesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4, 5, 6]))).toBe(
      false,
    );
  });

  it('formats prefix bytes as lowercase hex', () => {
    expect(prefixToHex(new Uint8Array([0x0a, 0xbc, 0x00, 0xff, 0x10, 0x01]))).toBe('0abc00ff1001');
  });
});

describe('unknownToError', () => {
  it('passes through Error instances', () => {
    const err = new Error('boom');
    expect(unknownToError(err, 'fallback')).toBe(err);
  });

  it('wraps strings and uses fallback for nullish/other', () => {
    expect(unknownToError('nope', 'fallback').message).toBe('nope');
    expect(unknownToError(null, 'fallback').message).toBe('fallback');
    expect(unknownToError(undefined, 'fallback').message).toBe('fallback');
    expect(unknownToError({ x: 1 }, 'fallback').message).toBe('fallback');
  });
});

describe('frame builders', () => {
  const key = makePubKey(0x42);

  it('buildSendLoginFrame encodes cmd + 32-byte key + password', () => {
    const frame = buildSendLoginFrame(key, 'secret');
    expect(frame[0]).toBe(MC_CMD_SEND_LOGIN);
    expect(frame.subarray(1, 33)).toEqual(key);
    expect(new TextDecoder().decode(frame.subarray(33))).toBe('secret');
  });

  it('buildSendLoginFrame allows empty password', () => {
    const frame = buildSendLoginFrame(key, '');
    expect(frame.length).toBe(33);
    expect(frame[0]).toBe(MC_CMD_SEND_LOGIN);
  });

  it('buildSendStatusReqFrame encodes cmd + key', () => {
    const frame = buildSendStatusReqFrame(key);
    expect(frame).toEqual(new Uint8Array([MC_CMD_SEND_STATUS_REQ, ...key]));
  });

  it('buildSendTelemetryReqFrame leaves 3 reserved bytes before the key', () => {
    const frame = buildSendTelemetryReqFrame(key);
    expect(frame[0]).toBe(MC_CMD_SEND_TELEMETRY_REQ);
    expect(frame.subarray(1, 4)).toEqual(new Uint8Array([0, 0, 0]));
    expect(frame.subarray(4)).toEqual(key);
  });

  it('buildSendBinaryReqFrame appends request payload after the key', () => {
    const payload = new Uint8Array([0x06, 1, 2, 3]);
    const frame = buildSendBinaryReqFrame(key, payload);
    expect(frame[0]).toBe(MC_CMD_SEND_BINARY_REQ);
    expect(frame.subarray(1, 33)).toEqual(key);
    expect(frame.subarray(33)).toEqual(payload);
  });

  it('rejects non-32-byte public keys', () => {
    const short = new Uint8Array(16);
    expect(() => buildSendLoginFrame(short, 'x')).toThrow(/32-byte public key/);
    expect(() => buildSendStatusReqFrame(short)).toThrow(/32-byte public key/);
    expect(() => buildSendTelemetryReqFrame(short)).toThrow(/32-byte public key/);
    expect(() => buildSendBinaryReqFrame(short, new Uint8Array([1]))).toThrow(/32-byte public key/);
  });
});

describe('parseRepeaterStatsFromStatusData', () => {
  it('parses little-endian status payload fields', () => {
    const expected = {
      batt_milli_volts: 3700,
      curr_tx_queue_len: 12,
      noise_floor: -95,
      last_rssi: -72,
      n_packets_recv: 1001,
      n_packets_sent: 2002,
      total_air_time_secs: 3003,
      total_up_time_secs: 4004,
      n_sent_flood: 5,
      n_sent_direct: 6,
      n_recv_flood: 7,
      n_recv_direct: 8,
      err_events: 9,
      last_snr: -11,
      n_direct_dups: 10,
      n_flood_dups: 11,
    };
    expect(parseRepeaterStatsFromStatusData(buildStatusData(expected))).toEqual(expected);
  });

  it('reads correctly from a non-zero byteOffset view', () => {
    const inner = buildStatusData({
      batt_milli_volts: 3300,
      curr_tx_queue_len: 1,
      noise_floor: -100,
      last_rssi: -80,
      n_packets_recv: 1,
      n_packets_sent: 2,
      total_air_time_secs: 3,
      total_up_time_secs: 4,
      n_sent_flood: 5,
      n_sent_direct: 6,
      n_recv_flood: 7,
      n_recv_direct: 8,
      err_events: 9,
      last_snr: 3,
      n_direct_dups: 10,
      n_flood_dups: 11,
    });
    const padded = new Uint8Array(4 + inner.length);
    padded.set(inner, 4);
    const sliced = padded.subarray(4);
    expect(parseRepeaterStatsFromStatusData(sliced).batt_milli_volts).toBe(3300);
    expect(parseRepeaterStatsFromStatusData(sliced).n_flood_dups).toBe(11);
  });
});

describe('meshcoreLoginErrorIsAuthFailure', () => {
  it('detects rejected / wrong password / acl denied messages', () => {
    expect(meshcoreLoginErrorIsAuthFailure(new Error('Login rejected'))).toBe(true);
    expect(meshcoreLoginErrorIsAuthFailure('Wrong password')).toBe(true);
    expect(meshcoreLoginErrorIsAuthFailure(new Error('ACL denied by repeater'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(meshcoreLoginErrorIsAuthFailure(new Error('timeout waiting for LoginSuccess'))).toBe(
      false,
    );
    expect(meshcoreLoginErrorIsAuthFailure(null)).toBe(false);
    expect(meshcoreLoginErrorIsAuthFailure(42)).toBe(false);
  });
});
