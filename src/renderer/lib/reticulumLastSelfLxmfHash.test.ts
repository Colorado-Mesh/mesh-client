import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import { reticulumHashToNodeId } from './reticulum/destHash';
import {
  loadPersistedReticulumSelfLxmfHash,
  loadPersistedReticulumSelfNodeId,
  persistReticulumSelfLxmfHash,
  RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY,
} from './reticulumLastSelfLxmfHash';

describe('reticulumLastSelfLxmfHash', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('persists a canonical lowercase hash to localStorage and app_settings', () => {
    const hash = '8FD7A9361ACA12360C7985BC934BDD20';
    persistReticulumSelfLxmfHash(hash);
    expect(localStorage.getItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY)).toBe(
      '8fd7a9361aca12360c7985bc934bdd20',
    );
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain(
      '8fd7a9361aca12360c7985bc934bdd20',
    );
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
      'reticulumLastSelfLxmfHash',
      '8fd7a9361aca12360c7985bc934bdd20',
    );
  });

  it('loads from the localStorage fast path', () => {
    localStorage.setItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY, '81bc0c0c5937ee0b750dbed29e744997');
    expect(loadPersistedReticulumSelfLxmfHash()).toBe('81bc0c0c5937ee0b750dbed29e744997');
    expect(loadPersistedReticulumSelfNodeId()).toBe(
      reticulumHashToNodeId('81bc0c0c5937ee0b750dbed29e744997'),
    );
  });

  it('falls back to app_settings JSON when the fast path is empty', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ reticulumLastSelfLxmfHash: 'fbfebb9066de04011be36dfd206504e8' }),
    );
    expect(loadPersistedReticulumSelfLxmfHash()).toBe('fbfebb9066de04011be36dfd206504e8');
  });

  it('ignores invalid hashes on persist and load', () => {
    persistReticulumSelfLxmfHash('not-a-hash');
    expect(loadPersistedReticulumSelfLxmfHash()).toBeNull();
    expect(loadPersistedReticulumSelfNodeId()).toBe(0);
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();

    localStorage.setItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY, 'short');
    expect(loadPersistedReticulumSelfLxmfHash()).toBeNull();
  });
});
