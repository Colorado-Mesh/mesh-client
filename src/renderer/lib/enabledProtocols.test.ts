import { afterEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  enabledProtocolsFrom,
  getStoredEnabledMeshProtocol,
  loadHiddenProtocols,
  newlyHiddenProtocols,
  resolveEnabledProtocol,
  sanitizeHiddenProtocols,
} from './enabledProtocols';
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

    it('never hides every protocol', () => {
      expect(sanitizeHiddenProtocols(['meshtastic', 'meshcore', 'reticulum'])).toEqual([]);
    });
  });

  it('loadHiddenProtocols reads App settings and defaults to all enabled', () => {
    expect(loadHiddenProtocols()).toEqual([]);
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ hiddenProtocols: ['reticulum', 'bogus'] }),
    );
    expect(loadHiddenProtocols()).toEqual(['reticulum']);
  });

  it('enabledProtocolsFrom keeps registry order', () => {
    expect(enabledProtocolsFrom([])).toEqual(['meshtastic', 'meshcore', 'reticulum']);
    expect(enabledProtocolsFrom(['meshcore'])).toEqual(['meshtastic', 'reticulum']);
    expect(enabledProtocolsFrom(['meshtastic', 'meshcore'])).toEqual(['reticulum']);
  });

  it('resolveEnabledProtocol falls back to the first enabled protocol', () => {
    expect(resolveEnabledProtocol('meshcore', ['meshtastic', 'meshcore'])).toBe('meshcore');
    expect(resolveEnabledProtocol('meshcore', ['meshtastic', 'reticulum'])).toBe('meshtastic');
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

  it('getStoredEnabledMeshProtocol keeps an enabled stored protocol', () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'reticulum');
    expect(getStoredEnabledMeshProtocol()).toBe('reticulum');
  });

  it('newlyHiddenProtocols lists only additions', () => {
    expect(newlyHiddenProtocols([], ['meshcore'])).toEqual(['meshcore']);
    expect(newlyHiddenProtocols(['meshcore'], ['meshcore', 'reticulum'])).toEqual(['reticulum']);
    expect(newlyHiddenProtocols(['meshcore'], [])).toEqual([]);
  });
});
