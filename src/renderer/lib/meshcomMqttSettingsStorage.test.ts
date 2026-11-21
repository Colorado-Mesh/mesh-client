import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from '../hooks/useProtocolMqttSettings';
import {
  MESHCOM_MQTT_SETTINGS_KEY,
  readMeshcomMqttSettingsFromStorage,
} from './meshcomMqttSettingsStorage';
import { resetSecureSecretCacheForTests } from './secureSecretStorage';

describe('meshcomMqttSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('uses a MeshCom-only storage key distinct from Meshtastic and MeshCore', () => {
    expect(getMqttSettingsStorageKey('meshcom')).toBe(MESHCOM_MQTT_SETTINGS_KEY);
    expect(getMqttSettingsStorageKey('meshcom')).not.toBe(getMqttSettingsStorageKey('meshtastic'));
    expect(getMqttSettingsStorageKey('meshcom')).not.toBe(getMqttSettingsStorageKey('meshcore'));
  });

  it('defaults to custom empty broker fields with meshcom topic prefix', () => {
    const settings = readMeshcomMqttSettingsFromStorage();
    expect(settings).toMatchObject({
      server: '',
      port: 1883,
      topicPrefix: 'meshcom',
      autoLaunch: false,
      useWebSocket: false,
      tlsEnabled: false,
    });
  });

  it('persists MeshCom settings without writing Meshtastic or MeshCore keys', async () => {
    persistMqttSettingsIfChanged(MESHCOM_MQTT_SETTINGS_KEY, {
      server: 'mqtt.example.ham',
      port: 8883,
      username: 'N0CALL',
      password: 'secret',
      topicPrefix: 'meshcom/us',
      autoLaunch: true,
      maxRetries: 5,
      tlsEnabled: true,
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem(MESHCOM_MQTT_SETTINGS_KEY)).toContain('mqtt.example.ham');
    });
    expect(localStorage.getItem('mesh-client:mqttSettings')).toBeNull();
    expect(localStorage.getItem('mesh-client:mqttSettings:meshcore')).toBeNull();
    expect(loadProtocolMqttSettings('meshcom').server).toBe('mqtt.example.ham');
    expect(loadProtocolMqttSettings('meshcom').password).toBe('secret');
  });
});
