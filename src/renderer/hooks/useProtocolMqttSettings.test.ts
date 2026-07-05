// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from './useProtocolMqttSettings';

describe('useProtocolMqttSettings helpers', () => {
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
});
