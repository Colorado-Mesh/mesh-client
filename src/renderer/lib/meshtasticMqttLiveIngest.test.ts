import { afterEach, describe, expect, it } from 'vitest';

import {
  shouldAutoLaunchMeshtasticMqtt,
  shouldIngestMeshtasticMqttLive,
  shouldMaintainMeshtasticMqttConnection,
} from './meshtasticMqttLiveIngest';
import { MESHTASTIC_MQTT_SETTINGS_KEY } from './meshtasticMqttSettingsStorage';

describe('shouldIngestMeshtasticMqttLive', () => {
  it('blocks live ingest for MeshCore tab without RF', () => {
    expect(shouldIngestMeshtasticMqttLive('meshcore', false)).toBe(false);
  });

  it('allows live ingest on Meshtastic tab without RF (MQTT-only)', () => {
    expect(shouldIngestMeshtasticMqttLive('meshtastic', false)).toBe(true);
  });

  it('allows live ingest on MeshCore tab when Meshtastic RF is connected', () => {
    expect(shouldIngestMeshtasticMqttLive('meshcore', true)).toBe(true);
  });
});

describe('shouldAutoLaunchMeshtasticMqtt', () => {
  afterEach(() => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
  });

  it('auto-launches when Meshtastic is the stored protocol', () => {
    expect(shouldAutoLaunchMeshtasticMqtt('meshtastic')).toBe(true);
  });

  it('auto-launches on MeshCore tab when auto-connect is enabled', () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: true }));
    expect(shouldAutoLaunchMeshtasticMqtt('meshcore')).toBe(true);
  });

  it('skips startup on MeshCore tab when auto-connect is disabled', () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: false }));
    expect(shouldAutoLaunchMeshtasticMqtt('meshcore')).toBe(false);
  });
});

describe('shouldMaintainMeshtasticMqttConnection', () => {
  afterEach(() => {
    localStorage.removeItem(MESHTASTIC_MQTT_SETTINGS_KEY);
  });

  it('maintains connection on MeshCore tab when auto-connect is enabled', () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: true }));
    expect(shouldMaintainMeshtasticMqttConnection('meshcore', false)).toBe(true);
  });

  it('matches shouldIngestMeshtasticMqttLive when auto-connect is disabled', () => {
    localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify({ autoLaunch: false }));
    expect(shouldMaintainMeshtasticMqttConnection('meshcore', false)).toBe(false);
    expect(shouldMaintainMeshtasticMqttConnection('meshtastic', false)).toBe(true);
    expect(shouldMaintainMeshtasticMqttConnection('meshcore', true)).toBe(true);
  });
});
