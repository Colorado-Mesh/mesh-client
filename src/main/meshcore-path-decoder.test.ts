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
      // Header: 0x21 (ROUTE_TYPE_FLOOD + PAYLOAD_TYPE_PATH, no transport codes)
      // Bits 0-1 = 01 (ROUTE_TYPE_FLOOD), Bits 2-5 = 1000 (PAYLOAD_TYPE_PATH)
      // Path length: 0x03 (3 hops, 1-byte hashes)
      // Path: 0xAA, 0xBB, 0xCC
      const buffer = Buffer.from([0x21, 0x03, 0xaa, 0xbb, 0xcc]);
      const result = decodePathPayload(buffer);
      expect(result.hops).toBe(3);
      expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
    });

    it('handles route type with transport codes (offset drift fix)', () => {
      // Header: 0x08 (ROUTE_TYPE_TRANSPORT_FLOOD + PAYLOAD_TYPE_PATH)
      // Transport codes: 4 bytes (0x00, 0x00, 0x00, 0x00)
      // Path length: 0x03 (3 hops, 1-byte hashes)
      // Path: 0xAA, 0xBB, 0xCC
      const buffer = Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
      const result = decodePathPayload(buffer);
      expect(result.hops).toBe(3);
      expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
    });

    it('handles 2-byte hash size (hash_size_code = 1)', () => {
      // Header: 0x21 (ROUTE_TYPE_FLOOD, no transport codes)
      // Path length: 0x45 = 0b01000101 (5 hops, hash_size_code = 1 -> 2 bytes)
      // Need 5 hops * 2 bytes = 10 bytes of path data
      const buffer = Buffer.from([
        0x21, 0x45, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44,
      ]);
      const result = decodePathPayload(buffer);
      expect(result.hops).toBe(5);
      expect(result.path).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44]);
    });

    it('handles 3-byte hash size (hash_size_code = 2)', () => {
      // Header: 0x21 (ROUTE_TYPE_FLOOD, no transport codes)
      // Path length: 0x8A = 0b10001010 (10 hops, hash_size_code = 2 -> 3 bytes)
      const buffer = Buffer.from([
        0x21, 0x8a, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
        0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
        0x1d, 0x1e,
      ]);
      const result = decodePathPayload(buffer);
      expect(result.hops).toBe(10);
      expect(result.path.length).toBe(30);
    });

    it('throws on buffer underrun', () => {
      // Header: 0x21 (ROUTE_TYPE_FLOOD), Length: 5, but only 2 bytes follow
      const buffer = Buffer.from([0x21, 0x05, 0xaa, 0xbb]);
      expect(() => decodePathPayload(buffer)).toThrow(/Buffer Underrun/);
    });

    it('throws if header is too short', () => {
      const buffer = Buffer.from([0x20]);
      expect(() => decodePathPayload(buffer)).toThrow(/Packet too short/);
    });
  });
});
