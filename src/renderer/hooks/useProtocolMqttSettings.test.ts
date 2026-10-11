// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from './useProtocolMqttSettings';

describe('useProtocolMqttSettings helpers', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('persistMqttSettingsIfChanged skips identical JSON', () => {
    const key = 'test-mqtt-persist';
    const settings = loadProtocolMqttSettings('meshcore');
    persistMqttSettingsIfChanged(key, settings);
    const first = localStorage.getItem(key);
    persistMqttSettingsIfChanged(key, settings);
    expect(localStorage.getItem(key)).toBe(first);
  });

  it('persists an intentional empty password as a secure override', () => {
    const settings = { ...loadProtocolMqttSettings('meshtastic'), password: '' };

    persistMqttSettingsIfChanged('mesh-client:mqttSettings', settings);

    expect(window.electronAPI.secureSecrets.set).toHaveBeenCalledWith(
      'mqtt:meshtastic',
      JSON.stringify({ password: '' }),
    );
  });
});
