import { describe, expect, it, vi } from 'vitest';

import { isCacheableRrcIdentityHash, persistRrcNick } from './rrcNickPersist';

describe('isCacheableRrcIdentityHash', () => {
  it('accepts valid 8-64 hex lowercase hashes', () => {
    expect(isCacheableRrcIdentityHash('abcd1234')).toBe(true);
    expect(isCacheableRrcIdentityHash('a'.repeat(64))).toBe(true);
  });

  it('rejects short hashes', () => {
    expect(isCacheableRrcIdentityHash('abc')).toBe(false);
  });

  it('rejects hashes with non-hex characters', () => {
    expect(isCacheableRrcIdentityHash('abcd1234g')).toBe(false);
    expect(isCacheableRrcIdentityHash('abcd-1234')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isCacheableRrcIdentityHash('')).toBe(false);
  });
});

describe('persistRrcNick', () => {
  it('does nothing when hub or nick is empty', () => {
    const db = { upsertRrcNick: vi.fn() };
    Object.assign(window, { electronAPI: { db } });
    persistRrcNick('', 'abcd1234', 'alice');
    expect(db.upsertRrcNick).not.toHaveBeenCalled();
    persistRrcNick('hub1', 'abcd1234', '');
    expect(db.upsertRrcNick).not.toHaveBeenCalled();
  });

  it('does nothing when identity hash is not cacheable', () => {
    const db = { upsertRrcNick: vi.fn() };
    Object.assign(window, { electronAPI: { db } });
    persistRrcNick('hub1', 'short', 'alice');
    expect(db.upsertRrcNick).not.toHaveBeenCalled();
  });

  it('persists a valid nick', () => {
    const upsertRrcNick = vi.fn().mockResolvedValue(undefined);
    const db = { upsertRrcNick };
    Object.assign(window, { electronAPI: { db } });
    persistRrcNick('HUB1', 'ABCD1234', 'Alice');
    expect(upsertRrcNick).toHaveBeenCalledWith({
      hub_hash: 'hub1',
      identity_hash: 'abcd1234',
      nickname: 'Alice',
      last_seen: expect.any(Number),
    });
  });

  it('swallows DB failures', () => {
    const upsertRrcNick = vi.fn().mockRejectedValue(new Error('fail'));
    const db = { upsertRrcNick };
    Object.assign(window, { electronAPI: { db } });
    expect(() => {
      persistRrcNick('hub1', 'abcd1234', 'Alice');
    }).not.toThrow();
  });
});
