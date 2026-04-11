import { describe, expect, it } from 'vitest';

import { queueLenFromMeshCoreCoreStatsRaw } from './meshcoreCoreStatsQueue';

describe('queueLenFromMeshCoreCoreStatsRaw', () => {
  it('uses byte 8 when raw has 9-byte CORE payload', () => {
    const raw = new Uint8Array(9);
    raw[6] = 0x05;
    raw[7] = 0x01;
    raw[8] = 3;
    expect(queueLenFromMeshCoreCoreStatsRaw(raw, 5)).toBe(3);
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
