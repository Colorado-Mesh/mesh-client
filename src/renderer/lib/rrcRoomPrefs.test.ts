import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadRrcRoomFavourites,
  toggleRrcAutoJoinRoom,
  toggleRrcRoomFavourite,
} from './rrcRoomPrefs';

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

describe('rrcRoomPrefs', () => {
  const hub = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => {
    stubLocalStorage();
  });

  it('stores favourites under bare match keys and migrates legacy #names', () => {
    localStorage.setItem(
      `mesh-client:rrc:roomFavourites:${hub}`,
      JSON.stringify(['#general', 'Lobby', 'general']),
    );
    expect(loadRrcRoomFavourites(hub)).toEqual(['general', 'lobby']);
    expect(JSON.parse(localStorage.getItem(`mesh-client:rrc:roomFavourites:${hub}`)!)).toEqual([
      'general',
      'lobby',
    ]);
  });

  it('toggles favourite with #general mapping to general', () => {
    expect(toggleRrcRoomFavourite(hub, '#general')).toEqual(['general']);
    expect(toggleRrcRoomFavourite(hub, 'general')).toEqual([]);
  });

  it('toggles auto-join with the same soft key rules', () => {
    expect(toggleRrcAutoJoinRoom(hub, '#ops')).toEqual(['ops']);
    expect(toggleRrcAutoJoinRoom(hub, 'OPS')).toEqual([]);
  });
});
