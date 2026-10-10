import { afterEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import { getStoredEnabledMeshProtocol, sanitizeHiddenProtocols } from './enabledProtocols';
import { MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

describe('enabledProtocols', () => {
  afterEach(() => {
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(MESH_PROTOCOL_STORAGE_KEY);
  });

  describe('sanitizeHiddenProtocols', () => {
    it('defaults to none hidden for missing or non-array values', () => {
      expect(sanitizeHiddenProtocols(undefined)).toEqual([]);
      expect(sanitizeHiddenProtocols('meshcore')).toEqual([]);
    });

    it('drops unknown values and duplicates', () => {
      expect(sanitizeHiddenProtocols(['meshcore', 'garbage', 3, 'meshcore'])).toEqual(['meshcore']);
    });
  });

  it('getStoredEnabledMeshProtocol redirects a hidden stored protocol and writes it back', () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ hiddenProtocols: ['meshtastic'] }),
    );
    expect(getStoredEnabledMeshProtocol()).toBe('meshcore');
    expect(localStorage.getItem(MESH_PROTOCOL_STORAGE_KEY)).toBe('meshcore');
  });
});
