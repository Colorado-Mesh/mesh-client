import { beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  isValidMeshcoreFloodScopeHashtag,
  loadMeshcoreFloodScopePresets,
  MESHCORE_FLOOD_SCOPE_PRESETS_MAX,
  MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY,
  rememberMeshcoreFloodScopePreset,
  removeMeshcoreFloodScopePreset,
  sanitizeMeshcoreFloodScopePresets,
  saveMeshcoreFloodScopePresets,
} from './meshcoreFloodScopePresetsStorage';

/** Minimal localStorage for renderer-logic (node) project. */
function installMemoryLocalStorage(): void {
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
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  });
}

describe('meshcoreFloodScopePresetsStorage', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('validates normalized hashtags', () => {
    expect(isValidMeshcoreFloodScopeHashtag('')).toBe(false);
    expect(isValidMeshcoreFloodScopeHashtag('#')).toBe(false);
    expect(isValidMeshcoreFloodScopeHashtag('  #  ')).toBe(false);
    expect(isValidMeshcoreFloodScopeHashtag('colorado')).toBe(true);
    expect(isValidMeshcoreFloodScopeHashtag('#EU')).toBe(true);
  });

  it('sanitizes malformed data, normalizes, dedupes, and caps', () => {
    const many = Array.from({ length: MESHCORE_FLOOD_SCOPE_PRESETS_MAX + 5 }, (_, i) => `#t${i}`);
    expect(
      sanitizeMeshcoreFloodScopePresets(['eu', '#eu', '', '#', 12, null, '  #Japan  ', ...many]),
    ).toEqual(['#eu', '#Japan', ...many.slice(0, MESHCORE_FLOOD_SCOPE_PRESETS_MAX - 2)]);
  });

  it('seeds from meshcoreFloodScopeHashtag when presets key is absent', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ meshcoreFloodScopeHashtag: 'berlin' }),
    );
    expect(loadMeshcoreFloodScopePresets()).toEqual(['#berlin']);
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed[MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY]).toEqual(['#berlin']);
  });

  it('persists empty list when presets key is absent and seed is empty', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ locale: 'en' }));
    expect(loadMeshcoreFloodScopePresets()).toEqual([]);
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed[MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY]).toEqual([]);
  });

  it('does not re-seed when presets key is already present', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        meshcoreFloodScopeHashtag: '#berlin',
        [MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY]: ['#tokyo'],
      }),
    );
    expect(loadMeshcoreFloodScopePresets()).toEqual(['#tokyo']);
  });

  it('saveMeshcoreFloodScopePresets replaces the stored array', () => {
    expect(saveMeshcoreFloodScopePresets(['#a', 'b', '#a', '#'])).toEqual(['#a', '#b']);
    expect(loadMeshcoreFloodScopePresets()).toEqual(['#a', '#b']);
  });

  it('rememberMeshcoreFloodScopePreset prepends and moves existing to front', () => {
    const first = rememberMeshcoreFloodScopePreset(['#a', '#b'], 'c');
    expect(first).toEqual(['#c', '#a', '#b']);
    const moved = rememberMeshcoreFloodScopePreset(first, '#b');
    expect(moved).toEqual(['#b', '#c', '#a']);
  });

  it('rememberMeshcoreFloodScopePreset ignores invalid hashtags', () => {
    expect(rememberMeshcoreFloodScopePreset(['#a'], '#')).toEqual(['#a']);
  });

  it('removeMeshcoreFloodScopePreset drops the matching tag', () => {
    expect(removeMeshcoreFloodScopePreset(['#a', '#b', '#c'], 'b')).toEqual(['#a', '#c']);
  });
});
