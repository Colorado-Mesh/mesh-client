import { describe, expect, it } from 'vitest';

import {
  ALLOWED_KINDS,
  isRrcKind,
  normalizeRrcHubHash,
  storageRoomKey,
} from './rrcMessageStorageCommon';

describe('rrcMessageStorageCommon', () => {
  describe('ALLOWED_KINDS', () => {
    it('contains the five valid RRC message kinds', () => {
      expect(ALLOWED_KINDS.has('msg')).toBe(true);
      expect(ALLOWED_KINDS.has('notice')).toBe(true);
      expect(ALLOWED_KINDS.has('action')).toBe(true);
      expect(ALLOWED_KINDS.has('error')).toBe(true);
      expect(ALLOWED_KINDS.has('system')).toBe(true);
    });

    it('rejects other kinds', () => {
      expect(ALLOWED_KINDS.has('unknown' as never)).toBe(false);
      expect(ALLOWED_KINDS.has('' as never)).toBe(false);
    });
  });

  describe('isRrcKind', () => {
    it('accepts valid kinds', () => {
      expect(isRrcKind('msg')).toBe(true);
      expect(isRrcKind('error')).toBe(true);
    });

    it('rejects invalid kinds', () => {
      expect(isRrcKind('junk')).toBe(false);
      expect(isRrcKind('')).toBe(false);
    });
  });

  describe('storageRoomKey', () => {
    it('normalizes #lobby and lobby the same', () => {
      expect(storageRoomKey('#lobby')).toBe('lobby');
      expect(storageRoomKey('lobby')).toBe('lobby');
    });

    it('preserves @ and [ targets', () => {
      expect(storageRoomKey('@target')).toBe('@target');
      expect(storageRoomKey('[hub]')).toBe('[hub]');
    });

    it('trims and lowercases plain names', () => {
      expect(storageRoomKey('  My Room  ')).toBe('my room');
    });
  });

  describe('normalizeRrcHubHash', () => {
    it('trims and lowercases', () => {
      expect(normalizeRrcHubHash('  ABC123  ')).toBe('abc123');
      expect(normalizeRrcHubHash('ABC123')).toBe('abc123');
    });

    it('returns an empty string for empty input', () => {
      expect(normalizeRrcHubHash('')).toBe('');
    });
  });
});
