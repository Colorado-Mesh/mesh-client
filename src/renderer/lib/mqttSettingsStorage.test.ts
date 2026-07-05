// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
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
});
