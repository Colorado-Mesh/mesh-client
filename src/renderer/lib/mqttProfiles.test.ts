import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyMqttProfile,
  createMqttProfile,
  deleteMqttProfile,
  loadMqttProfiles,
  matchMqttProfile,
  MQTT_PROFILE_NAME_MAX_LENGTH,
  MQTT_PROFILES_STORAGE_KEY,
  mqttProfileApplyEffect,
  mqttProfileIdFromSelectValue,
  mqttProfileSelectValue,
  renameMqttProfile,
  saveMqttProfiles,
} from './mqttProfiles';
import type { MQTTSettings } from './types';

const base: MQTTSettings = {
  server: 'mqtt.chimesh.org',
  port: 1883,
  username: 'meshdev',
  password: 'large4cats',
  topicPrefix: 'msh/US/IL/Chi',
  autoLaunch: true,
  maxRetries: 7,
  channelPsks: ['abc='],
};

describe('mqttProfiles', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates, renames and deletes, surviving a save-and-load round trip', () => {
    let list = createMqttProfile([], '  Chicago  ', base, 'a');
    list = createMqttProfile(list, 'Illinois', { ...base, topicPrefix: 'msh/US/IL' }, 'b');
    list = renameMqttProfile(list, 'a', 'Chicagoland');
    saveMqttProfiles(list);

    let loaded = loadMqttProfiles();
    expect(loaded.map((p) => p.name)).toEqual(['Chicagoland', 'Illinois']);
    expect(loaded[0]).toMatchObject({ server: 'mqtt.chimesh.org', topicPrefix: 'msh/US/IL/Chi' });

    saveMqttProfiles(deleteMqttProfile(loaded, 'a'));
    loaded = loadMqttProfiles();
    expect(loaded.map((p) => p.id)).toEqual(['b']);
  });

  it('ignores blank names and trims long ones', () => {
    expect(createMqttProfile([], '   ', base, 'a')).toEqual([]);
    const [p] = createMqttProfile([], 'x'.repeat(200), base, 'a');
    expect(p.name).toHaveLength(MQTT_PROFILE_NAME_MAX_LENGTH);
    expect(renameMqttProfile([p], 'a', ' ')[0].name).toBe(p.name);
  });

  it('drops malformed stored entries', () => {
    localStorage.setItem(
      MQTT_PROFILES_STORAGE_KEY,
      JSON.stringify([{ id: 'x' }, ...createMqttProfile([], 'ok', base, 'ok')]),
    );
    expect(loadMqttProfiles().map((p) => p.id)).toEqual(['ok']);
    localStorage.setItem(MQTT_PROFILES_STORAGE_KEY, '{not json');
    expect(loadMqttProfiles()).toEqual([]);
  });

  it('applies connection fields and keeps app-only settings', () => {
    const [p] = createMqttProfile(
      [],
      'USA',
      { ...base, server: 'mqtt.meshtastic.org', topicPrefix: 'msh/US' },
      'u',
    );
    const next = applyMqttProfile({ ...base, autoLaunch: false }, p);
    expect(next).toMatchObject({
      server: 'mqtt.meshtastic.org',
      topicPrefix: 'msh/US',
      autoLaunch: false,
      maxRetries: 7,
      channelPsks: ['abc='],
    });
  });

  it('matches the current settings to a profile', () => {
    const list = createMqttProfile([], 'Chicago', base, 'a');
    expect(matchMqttProfile(list, { ...base, autoLaunch: false })?.id).toBe('a');
    expect(matchMqttProfile(list, { ...base, topicPrefix: 'msh/US' })).toBeUndefined();
  });

  it('classifies what a live session needs after switching', () => {
    expect(mqttProfileApplyEffect(base, { ...base })).toBe('none');
    expect(mqttProfileApplyEffect(base, { ...base, topicPrefix: 'msh/US/IN/NWI' })).toBe(
      'topicPrefix',
    );
    expect(mqttProfileApplyEffect(base, { ...base, server: 'other' })).toBe('reconnect');
    expect(mqttProfileApplyEffect(base, { ...base, password: 'x' })).toBe('reconnect');
  });

  it('round-trips select values', () => {
    expect(mqttProfileIdFromSelectValue(mqttProfileSelectValue('abc'))).toBe('abc');
    expect(mqttProfileIdFromSelectValue('liam')).toBeNull();
  });
});
