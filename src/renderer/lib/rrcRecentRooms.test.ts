import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRrcRecentRooms, pushRrcRecentRoom } from './rrcRecentRooms';

const HUB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
    key: () => null,
  });
}

describe('rrcRecentRooms', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it('stores lowercase per-hub keys and dedupes #room/room aliases', () => {
    pushRrcRecentRoom(HUB, '#General');
    pushRrcRecentRoom(HUB, 'general');
    expect(loadRrcRecentRooms(HUB)).toEqual(['general']);
  });

  it('orders by recency and caps at 10 rooms', () => {
    for (let i = 0; i < 12; i++) {
      pushRrcRecentRoom(HUB, `room${i}`);
    }
    const recent = loadRrcRecentRooms(HUB);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('room11');
    expect(recent).not.toContain('room0');
    expect(recent).not.toContain('room1');
  });

  it('rewrites malformed JSON arrays to canonical form', () => {
    localStorage.setItem(
      `mesh-client:rrc:recentRooms:${HUB}`,
      JSON.stringify(['#Lobby', 'lobby', 42, '', 'Other']),
    );
    expect(loadRrcRecentRooms(HUB)).toEqual(['lobby', 'other']);
  });

  it('returns empty when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    // Fall back to stub getItem throwing via localStorage override.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    });
    expect(loadRrcRecentRooms(HUB)).toEqual([]);
    spy.mockRestore();
  });
});
