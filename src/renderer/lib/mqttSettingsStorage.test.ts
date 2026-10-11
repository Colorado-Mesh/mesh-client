// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import { resetSecureSecretCacheForTests, setSecureSecret } from './secureSecretStorage';
import type { MQTTSettings } from './types';

const DEFAULTS: MQTTSettings = {
  server: 'mqtt.example.com',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'msh',
  autoLaunch: false,
  maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
};

describe('readMqttSettingsFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('returns defaults when storage is empty', () => {
    expect(readMqttSettingsFromStorage('missing-key', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('merges stored values and clamps maxRetries', () => {
    localStorage.setItem(
      'test-mqtt-settings',
      JSON.stringify({ server: 'broker.local', maxRetries: 999 }),
    );
    const merged = readMqttSettingsFromStorage('test-mqtt-settings', DEFAULTS);
    expect(merged.server).toBe('broker.local');
    expect(merged.maxRetries).toBe(MQTT_MAX_RECONNECT_ATTEMPTS);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('bad-mqtt-settings', '{not json');
    expect(readMqttSettingsFromStorage('bad-mqtt-settings', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('loads complete settings from secure storage without clear metadata', async () => {
    await setSecureSecret(
      'mqtt:meshtastic',
      JSON.stringify({ ...DEFAULTS, server: 'secure.example.com', password: 'secret' }),
    );

    expect(readMqttSettingsFromStorage('missing-key', DEFAULTS, 'mqtt:meshtastic')).toMatchObject({
      server: 'secure.example.com',
      password: 'secret',
    });
  });

  it('merges legacy clear metadata with an older secret-only record', async () => {
    localStorage.setItem(
      'legacy-mqtt-settings',
      JSON.stringify({ server: 'legacy.example.com', port: 8883 }),
    );
    await setSecureSecret('mqtt:meshtastic', JSON.stringify({ password: 'secret' }));

    expect(
      readMqttSettingsFromStorage('legacy-mqtt-settings', DEFAULTS, 'mqtt:meshtastic'),
    ).toMatchObject({ server: 'legacy.example.com', port: 8883, password: 'secret' });
  });
});
