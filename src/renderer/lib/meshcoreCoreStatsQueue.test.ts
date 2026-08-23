import { describe, expect, it } from 'vitest';

import { queueLenFromMeshCoreCoreStatsRaw } from './meshcoreCoreStatsQueue';

describe('queueLenFromMeshCoreCoreStatsRaw', () => {
  it('uses byte 8 when raw has 9-byte CORE payload', () => {
    const raw = new Uint8Array(9);
    raw[6] = 0x05;
    raw[7] = 0x01;
    raw[8] = 7;
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 5)).toBe(7);
  });

  it('ignores 0xff byte-8 padding on HTTP/TCP 7-byte-padded CORE stats', () => {
    const raw = Uint8Array.from([0, 0, 0xec, 0xeb, 0, 0, 0, 0, 0xff]);
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 0)).toBe(0);
  });

  it('ignores RESP_CODE_STATS (0x18) byte-8 framing leak on TCP-padded CORE stats', () => {
    // pyMC/OpenHop: …000018 with meshcore.js reading legacy queue at byte 6 (=0)
    const raw = Uint8Array.from([0, 0, 0x33, 0x32, 0x02, 0, 0, 0, 0x18]);
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 0)).toBe(0);
  });

  it('treats 0x18 as real queue_len when err_flags high byte is non-zero', () => {
    const raw = new Uint8Array(9);
    raw[6] = 0x05;
    raw[7] = 0x01;
    raw[8] = 0x18;
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 5)).toBe(0x18);
  });

  it('does not treat byte 8 as padding when byte 7 is non-zero', () => {
    const raw = new Uint8Array(9);
    raw[6] = 0x05;
    raw[7] = 0x01;
    raw[8] = 0xff;
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 5)).toBe(0xff);
  });

  it('uses last byte for legacy 7-byte payload', () => {
    const raw = new Uint8Array(7);
    raw[6] = 12;
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 99)).toBe(12);
  });

  it('falls back when raw is too short', () => {
    expect(queueLenFromMeshCoreCoreStatsRaw(new Uint8Array(3), 4)).toBe(4);
    expect(queueLenFromMeshCoreCoreStatsRaw(undefined, 4)).toBe(4);
  });
});
