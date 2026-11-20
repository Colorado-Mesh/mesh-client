import { beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import type { DiscoveredMeshcoreRegion } from './meshcoreRegionDiscovery';
import {
  isDiscoveredMeshcoreRegionsStale,
  loadDiscoveredMeshcoreRegions,
  MESHCORE_DISCOVERED_REGIONS_MAX_ENTRIES,
  MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS,
  MESHCORE_DISCOVERED_REGIONS_SETTING_KEY,
  MESHCORE_DISCOVERED_REGIONS_STALE_MS,
  type MeshcoreDiscoveredRegionsCache,
  saveDiscoveredMeshcoreRegions,
} from './meshcoreRegionDiscoveryStorage';

const SIG_A = `meshcore:pk:${'a'.repeat(64)}`;
const SIG_B = `meshcore:pk:${'b'.repeat(64)}`;

function installMemoryLocalStorage(opts?: { throwOnSet?: boolean }): void {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      if (opts?.throwOnSet) throw new Error('QuotaExceededError');
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  });
}

function entry(
  partial: Partial<DiscoveredMeshcoreRegion> & Pick<DiscoveredMeshcoreRegion, 'name'>,
): DiscoveredMeshcoreRegion {
  return {
    scopeHashtag: partial.scopeHashtag ?? `#${partial.name}`,
    depth: partial.depth ?? 1,
    home: partial.home ?? false,
    floodAllowed: partial.floodAllowed ?? false,
    sources: partial.sources ?? [1],
    ...partial,
  };
}

function cache(
  partial: Partial<MeshcoreDiscoveredRegionsCache> &
    Pick<MeshcoreDiscoveredRegionsCache, 'entries'>,
): MeshcoreDiscoveredRegionsCache {
  return {
    version: 1,
    readAt: partial.readAt ?? 1_000,
    truncatedSources: partial.truncatedSources ?? [],
    entries: partial.entries,
  };
}

describe('meshcoreRegionDiscoveryStorage', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('round-trips save/load for a radio', () => {
    const payload = cache({
      readAt: 1_760_000_000_000,
      entries: [entry({ name: 'us-tn-tri', depth: 3, sources: [18, 42] })],
      truncatedSources: [42],
    });
    saveDiscoveredMeshcoreRegions(SIG_A, payload);
    expect(loadDiscoveredMeshcoreRegions(SIG_A)).toEqual(payload);
  });

  it('isolates caches per radio signature', () => {
    saveDiscoveredMeshcoreRegions(SIG_A, cache({ entries: [entry({ name: 'aaa' })] }));
    saveDiscoveredMeshcoreRegions(SIG_B, cache({ entries: [entry({ name: 'bbb' })] }));
    expect(loadDiscoveredMeshcoreRegions(SIG_A)?.entries.map((e) => e.name)).toEqual(['aaa']);
    expect(loadDiscoveredMeshcoreRegions(SIG_B)?.entries.map((e) => e.name)).toEqual(['bbb']);
  });

  it('returns null for corrupt JSON and invalid signatures', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, '{not-json');
    expect(loadDiscoveredMeshcoreRegions(SIG_A)).toBeNull();
    expect(loadDiscoveredMeshcoreRegions('not-a-signature')).toBeNull();
    expect(loadDiscoveredMeshcoreRegions(undefined)).toBeNull();
    saveDiscoveredMeshcoreRegions('bad', cache({ entries: [entry({ name: 'x' })] }));
    expect(loadDiscoveredMeshcoreRegions(SIG_A)).toBeNull();
  });

  it('sanitizes malformed entries, drops control-char names, dedupes, and caps', () => {
    const many = Array.from({ length: MESHCORE_DISCOVERED_REGIONS_MAX_ENTRIES + 5 }, (_, i) =>
      entry({ name: `r${i}` }),
    );
    saveDiscoveredMeshcoreRegions(
      SIG_A,
      cache({
        entries: [
          entry({ name: 'us', sources: [2, 2, 1, Number.NaN] }),
          entry({ name: 'us', depth: 9 }),
          {
            name: 'bad\u0000',
            scopeHashtag: null,
            depth: 0,
            home: false,
            floodAllowed: false,
            sources: [],
          },
          ...many,
        ],
      }),
    );
    const loaded = loadDiscoveredMeshcoreRegions(SIG_A);
    expect(loaded?.entries[0]).toMatchObject({ name: 'us', sources: [1, 2], depth: 1 });
    expect(loaded?.entries.some((e) => e.name.includes('\u0000'))).toBe(false);
    expect(loaded?.entries).toHaveLength(MESHCORE_DISCOVERED_REGIONS_MAX_ENTRIES);
  });

  it('evicts oldest radios when over the radio cap', () => {
    for (let i = 0; i < MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS + 2; i++) {
      const sig = `meshcore:pk:${i.toString(16).padStart(64, '0')}`;
      saveDiscoveredMeshcoreRegions(
        sig,
        cache({
          readAt: i + 1,
          entries: [entry({ name: `n${i}` })],
        }),
      );
    }
    const settings = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      Record<string, MeshcoreDiscoveredRegionsCache>
    >;
    const radios = Object.keys(settings[MESHCORE_DISCOVERED_REGIONS_SETTING_KEY] ?? {});
    expect(radios).toHaveLength(MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS);
    expect(radios.includes(`meshcore:pk:${'0'.repeat(64)}`)).toBe(false);
    expect(radios.includes(`meshcore:pk:${'1'.padStart(64, '0')}`)).toBe(false);
  });

  it('does not throw when localStorage setItem fails', () => {
    installMemoryLocalStorage({ throwOnSet: true });
    expect(() => {
      saveDiscoveredMeshcoreRegions(SIG_A, cache({ entries: [entry({ name: 'us' })] }));
    }).not.toThrow();
  });

  it('reports stale caches after the TTL', () => {
    const now = 10_000_000;
    expect(isDiscoveredMeshcoreRegionsStale({ readAt: now }, now)).toBe(false);
    expect(
      isDiscoveredMeshcoreRegionsStale(
        { readAt: now - MESHCORE_DISCOVERED_REGIONS_STALE_MS - 1 },
        now,
      ),
    ).toBe(true);
    expect(isDiscoveredMeshcoreRegionsStale(null, now)).toBe(false);
  });
});
