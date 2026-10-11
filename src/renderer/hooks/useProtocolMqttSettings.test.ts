// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSecureSecretCacheForTests } from '@/renderer/lib/secureSecretStorage';

import {
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from './useProtocolMqttSettings';

describe('useProtocolMqttSettings helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.set).mockClear();
  });

  it('maps storage keys by protocol', () => {
    expect(getMqttSettingsStorageKey('meshtastic')).toBe('mesh-client:mqttSettings');
    expect(getMqttSettingsStorageKey('meshcore')).toBe('mesh-client:mqttSettings:meshcore');
  });

  it('loads protocol defaults from storage helpers', () => {
    const meshtastic = loadProtocolMqttSettings('meshtastic');
    expect(meshtastic.topicPrefix).toBeTruthy();
    const meshcore = loadProtocolMqttSettings('meshcore');
    expect(meshcore.topicPrefix).toBe('meshcore');
  });

  it('persists complete settings securely, removes legacy metadata, and skips identical JSON', async () => {
    const key = 'test-mqtt-persist';
    const settings = loadProtocolMqttSettings('meshcore');
    localStorage.setItem(key, '{"legacy":true}');
    persistMqttSettingsIfChanged(key, settings);
    persistMqttSettingsIfChanged(key, settings);
    await vi.waitFor(() => {
      expect(localStorage.getItem(key)).toBeNull();
    });
    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
      'mqtt:meshtastic',
      JSON.stringify(settings),
    );
  });

  it('persists an intentional empty password as a secure override', () => {
    const settings = { ...loadProtocolMqttSettings('meshtastic'), password: '' };

    persistMqttSettingsIfChanged('mesh-client:mqttSettings', settings);

    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
      'mqtt:meshtastic',
      JSON.stringify(settings),
    );
  });
});
