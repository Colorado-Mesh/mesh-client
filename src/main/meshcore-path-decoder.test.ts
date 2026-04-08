import { describe, expect, it } from 'vitest';

import { decodePathPayload, isPathPacket } from './meshcore-path-decoder';

describe('meshcore-path-decoder', () => {
  describe('isPathPacket', () => {
    it('returns true for a valid PATH packet (type 0x08)', () => {
      // (0x20 & 0x3C) >> 2 = 0x08
      const buffer = Buffer.from([0x20, 0x00]);
      expect(isPathPacket(buffer)).toBe(true);
    });

    it('returns false for other types', () => {
      // (0x3C & 0x3C) >> 2 = 0x0F
      const buffer = Buffer.from([0x3c, 0x00]);
      expect(isPathPacket(buffer)).toBe(false);
    });

    it('handles empty or short buffers', () => {
      expect(isPathPacket(Buffer.alloc(0))).toBe(false);
      // @ts-expect-error test invalid input
      expect(isPathPacket(null)).toBe(false);
    });
  });

  describe('decodePathPayload', () => {
    it('correctly extracts path_length and hashes', () => {
      // Header: 0x20, Length: 3, Hashes: 0xAA, 0xBB, 0xCC
      const buffer = Buffer.from([0x20, 0x03, 0xaa, 0xbb, 0xcc]);
      const result = decodePathPayload(buffer);
      expect(result.hops).toBe(3);
      expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
    });

    it('throws on buffer underrun', () => {
      // Header: 0x20, Length: 5, but only 2 bytes follow
      const buffer = Buffer.from([0x20, 0x05, 0xaa, 0xbb]);
      expect(() => decodePathPayload(buffer)).toThrow(/Buffer Underrun/);
    });

    it('throws if header is too short', () => {
      const buffer = Buffer.from([0x20]);
      expect(() => decodePathPayload(buffer)).toThrow(/Packet too short/);
    });
  });
});
