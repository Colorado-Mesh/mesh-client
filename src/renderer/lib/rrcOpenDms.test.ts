import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRrcOpenDms,
  loadRrcOpenDms,
  removeRrcOpenDm,
  saveRrcOpenDms,
  upsertRrcOpenDm,
} from './rrcOpenDms';

const HUB = '28c7c1a68c735693aa8e6b8193ed44b2';
const alice = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bob = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
}

describe('rrcOpenDms', () => {
  beforeEach(() => {
    stubLocalStorage();
    clearRrcOpenDms(HUB);
  });

  it('upserts, preserves prior nick when new nick is null, and removes', () => {
    expect(loadRrcOpenDms(HUB)).toEqual([]);
    upsertRrcOpenDm(HUB, { identity_hash: alice, nickname: 'Alice' });
    expect(loadRrcOpenDms(HUB)).toEqual([{ identity_hash: alice, nickname: 'Alice' }]);

    upsertRrcOpenDm(HUB, { identity_hash: alice, nickname: null });
    expect(loadRrcOpenDms(HUB)).toEqual([{ identity_hash: alice, nickname: 'Alice' }]);

    upsertRrcOpenDm(HUB, { identity_hash: bob, nickname: 'Bob' });
    expect(loadRrcOpenDms(HUB).map((d) => d.identity_hash)).toEqual([bob, alice]);

    removeRrcOpenDm(HUB, alice);
    expect(loadRrcOpenDms(HUB)).toEqual([{ identity_hash: bob, nickname: 'Bob' }]);
  });

  it('rejects invalid hashes and corrupt storage payloads', () => {
    expect(upsertRrcOpenDm(HUB, { identity_hash: 'short', nickname: 'X' })).toEqual([]);
    localStorage.setItem(`mesh-client:rrc:openDms:${HUB}`, '{not-json');
    expect(loadRrcOpenDms(HUB)).toEqual([]);
    localStorage.setItem(
      `mesh-client:rrc:openDms:${HUB}`,
      JSON.stringify({ identity_hash: alice }),
    );
    expect(loadRrcOpenDms(HUB)).toEqual([]);
    localStorage.setItem(
      `mesh-client:rrc:openDms:${HUB}`,
      JSON.stringify([{ nickname: 'Alice' }, { identity_hash: alice, nickname: 'Alice' }, null]),
    );
    expect(loadRrcOpenDms(HUB)).toEqual([{ identity_hash: alice, nickname: 'Alice' }]);
  });

  it('caps open DMs at 50 and clear removes the hub key', () => {
    const peers = Array.from({ length: 55 }, (_, i) => ({
      identity_hash: i.toString(16).padStart(32, '0'),
      nickname: `n${i}`,
    }));
    saveRrcOpenDms(HUB, peers);
    expect(loadRrcOpenDms(HUB)).toHaveLength(50);
    expect(loadRrcOpenDms(HUB)[0]?.identity_hash).toBe(peers[0]?.identity_hash);

    clearRrcOpenDms(HUB);
    expect(localStorage.getItem(`mesh-client:rrc:openDms:${HUB}`)).toBeNull();
    expect(loadRrcOpenDms(HUB)).toEqual([]);
  });
});
