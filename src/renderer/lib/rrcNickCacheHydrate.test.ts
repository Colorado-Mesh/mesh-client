import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateRrcHubNicks,
  resetRrcNickCacheHydrationForTests,
} from '@/renderer/lib/rrcNickCacheHydrate';
import { selectRrcFocusedHubNicks, useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

const HUB = 'a'.repeat(32);

describe('hydrateRrcHubNicks', () => {
  beforeEach(() => {
    resetRrcNickCacheHydrationForTests();
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.setState({ nicksByHub: new Map(), focusedHubHash: HUB });
    vi.mocked(window.electronAPI.db.listRrcNicks).mockReset();
    vi.mocked(window.electronAPI.db.listRrcNicks).mockResolvedValue([]);
  });

  it('seeds the store once per hub and skips malformed rows', async () => {
    vi.mocked(window.electronAPI.db.listRrcNicks).mockResolvedValue([
      { identity_hash: 'C'.repeat(32), nickname: 'Alice', last_seen: 2 },
      { identity_hash: 'nick:bob', nickname: 'Bob', last_seen: 1 },
      { identity_hash: 'd'.repeat(32), nickname: '  ', last_seen: 1 },
    ]);

    await hydrateRrcHubNicks(HUB);
    expect(selectRrcFocusedHubNicks(useRrcSessionStore.getState())).toEqual([
      { hash: 'c'.repeat(32), nickname: 'Alice' },
    ]);

    await hydrateRrcHubNicks(HUB);
    expect(window.electronAPI.db.listRrcNicks).toHaveBeenCalledTimes(1);
  });

  it('keeps a live sighting when the cached row disagrees', async () => {
    const peer = 'c'.repeat(32);
    useRrcSessionStore.getState().learnHubNicks(HUB, [{ hash: peer, nickname: 'NewNick' }]);
    vi.mocked(window.electronAPI.db.listRrcNicks).mockResolvedValue([
      { identity_hash: peer, nickname: 'OldNick', last_seen: 1 },
    ]);

    await hydrateRrcHubNicks(HUB);
    expect(selectRrcFocusedHubNicks(useRrcSessionStore.getState())).toEqual([
      { hash: peer, nickname: 'NewNick' },
    ]);
  });

  it('allows a retry after a failed load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.db.listRrcNicks).mockRejectedValueOnce(new Error('db down'));
    await hydrateRrcHubNicks(HUB);
    await hydrateRrcHubNicks(HUB);
    expect(window.electronAPI.db.listRrcNicks).toHaveBeenCalledTimes(2);
  });
});

describe('learnHubNicks', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.setState({ nicksByHub: new Map(), focusedHubHash: HUB });
    vi.mocked(window.electronAPI.db.upsertRrcNick).mockClear();
  });

  it('persists new sightings and ignores placeholders and synthetic keys', () => {
    const peer = 'c'.repeat(32);
    useRrcSessionStore.getState().learnHubNicks(HUB, [
      { hash: peer, nickname: 'Alice' },
      { hash: 'nick:bob', nickname: 'Bob' },
      { hash: 'd'.repeat(32), nickname: 'anonymous' },
    ]);
    expect(selectRrcFocusedHubNicks(useRrcSessionStore.getState())).toEqual([
      { hash: peer, nickname: 'Alice' },
    ]);
    expect(window.electronAPI.db.upsertRrcNick).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.upsertRrcNick).toHaveBeenCalledWith(
      expect.objectContaining({ hub_hash: HUB, identity_hash: peer, nickname: 'Alice' }),
    );
  });

  it('does not re-persist an unchanged nick', () => {
    const peer = 'c'.repeat(32);
    const nicks = [{ hash: peer, nickname: 'Alice' }];
    useRrcSessionStore.getState().learnHubNicks(HUB, nicks);
    useRrcSessionStore.getState().learnHubNicks(HUB, nicks);
    expect(window.electronAPI.db.upsertRrcNick).toHaveBeenCalledTimes(1);
  });

  it('records nicks seen in a roster snapshot', () => {
    const peer = 'c'.repeat(32);
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Hub');
    useRrcSessionStore.getState().roomJoined('general', [
      { identity_hash: peer, nickname: 'Alice' },
      { identity_hash: 'd'.repeat(32), nickname: null },
    ]);
    expect(selectRrcFocusedHubNicks(useRrcSessionStore.getState())).toEqual([
      { hash: peer, nickname: 'Alice' },
    ]);
  });
});
