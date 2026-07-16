import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isRrcHubAutoJoin,
  loadRrcHubAutoJoin,
  resolveRrcHubSidebarMarker,
  toggleRrcHubAutoJoin,
} from './rrcHubPrefs';

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

describe('rrcHubPrefs', () => {
  const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  beforeEach(() => {
    stubLocalStorage();
  });

  it('loads empty auto-join list by default', () => {
    expect(loadRrcHubAutoJoin()).toEqual([]);
  });

  it('toggles hub auto-join and canonicalizes hashes', () => {
    expect(toggleRrcHubAutoJoin(hubA.toUpperCase())).toEqual([hubA]);
    expect(isRrcHubAutoJoin(hubA)).toBe(true);
    expect(toggleRrcHubAutoJoin(hubB)).toEqual([hubA, hubB]);
    expect(toggleRrcHubAutoJoin(hubA)).toEqual([hubB]);
    expect(isRrcHubAutoJoin(hubA)).toBe(false);
  });

  it('resolves connected / connecting / auto-join / idle markers', () => {
    expect(resolveRrcHubSidebarMarker({ status: 'active', autoJoin: false }).glyph).toBe('●');
    expect(resolveRrcHubSidebarMarker({ status: 'reconnecting', autoJoin: true }).kind).toBe(
      'connected',
    );
    expect(resolveRrcHubSidebarMarker({ status: 'connecting', autoJoin: true }).glyph).toBe('◌');
    expect(resolveRrcHubSidebarMarker({ status: 'awaiting_welcome', autoJoin: false }).kind).toBe(
      'connecting',
    );
    expect(resolveRrcHubSidebarMarker({ status: null, autoJoin: true }).glyph).toBe('◐');
    expect(resolveRrcHubSidebarMarker({ status: 'disconnected', autoJoin: false }).glyph).toBe('○');
  });
});
