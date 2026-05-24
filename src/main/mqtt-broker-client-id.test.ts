// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MQTTSettings } from '../renderer/lib/types';
import {
  MESHCORE_MQTT_CLIENT_ID_SETTING_KEY,
  MESHTASTIC_MQTT_CLIENT_ID_SETTING_KEY,
  resolveMqttBrokerClientId,
} from './mqtt-broker-client-id';

const settings: MQTTSettings = {
  server: 'broker.example.com',
  port: 1883,
  username: 'user',
  password: 'pass',
  topicPrefix: 'msh',
  autoLaunch: false,
};

const store = new Map<string, string>();

vi.mock('./database', () => ({
  getDatabase: () => ({
    prepareOnce: (sql: string) => ({
      get: (key: string) => {
        if (sql.includes('SELECT value')) {
          const value = store.get(key);
          return value != null ? { value } : undefined;
        }
        return undefined;
      },
      run: (key: string, value: string) => {
        if (sql.includes('INSERT OR REPLACE')) {
          store.set(key, value);
        }
        return { changes: 1 };
      },
    }),
  }),
}));

describe('resolveMqttBrokerClientId', () => {
  beforeEach(() => {
    store.clear();
  });

  it('creates and persists a meshtastic clientId', () => {
    const id1 = resolveMqttBrokerClientId('meshtastic', settings);
    expect(id1).toMatch(/^meshtastic-electron-[0-9a-f]{16}$/);
    expect(store.get(MESHTASTIC_MQTT_CLIENT_ID_SETTING_KEY)).toBe(id1);

    const id2 = resolveMqttBrokerClientId('meshtastic', settings);
    expect(id2).toBe(id1);
  });

  it('creates and persists a meshcore clientId for non-v1 username', () => {
    const id1 = resolveMqttBrokerClientId('meshcore', settings);
    expect(id1).toMatch(/^meshcore-mqtt-[0-9a-f]{16}$/);
    expect(store.get(MESHCORE_MQTT_CLIENT_ID_SETTING_KEY)).toBe(id1);

    const id2 = resolveMqttBrokerClientId('meshcore', settings);
    expect(id2).toBe(id1);
  });

  it('uses v1 username as clientId without persisting meshcore key', () => {
    const v1Username = `v1_${'a'.repeat(64)}`;
    const id = resolveMqttBrokerClientId('meshcore', { ...settings, username: v1Username });
    expect(id).toBe(v1Username);
    expect(store.has(MESHCORE_MQTT_CLIENT_ID_SETTING_KEY)).toBe(false);
  });
});
