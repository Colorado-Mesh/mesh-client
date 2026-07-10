// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLORADO_MESH_PORT_MIGRATION_KEY,
  LEGACY_MQTT_SETTINGS_KEY,
  MESHCORE_MQTT_SETTINGS_KEY,
  MESHCORE_TOPIC_IATA_MIGRATION_KEY,
  runConnectionPanelStorageMigrations,
} from './connectionPanelStorageMigrations';
import { COLORADO_MESH_HOST } from './letsMeshJwt';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
});

describe('runConnectionPanelStorageMigrations', () => {
  it('moves legacy meshcore mqtt blob from mesh-client:mqttSettings to meshcore key', () => {
    const legacy = JSON.stringify({
      server: 'mqtt.example.com',
      topicPrefix: 'meshcore/test',
      port: 1883,
    });
    localStorage.setItem(LEGACY_MQTT_SETTINGS_KEY, legacy);

    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY)).toBe(legacy);
    expect(localStorage.getItem(LEGACY_MQTT_SETTINGS_KEY)).toBeNull();
  });

  it('does not move legacy blob when topicPrefix is not meshcore', () => {
    const legacy = JSON.stringify({ server: 'mqtt.example.com', topicPrefix: 'msh/US' });
    localStorage.setItem(LEGACY_MQTT_SETTINGS_KEY, legacy);

    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem(LEGACY_MQTT_SETTINGS_KEY)).toBe(legacy);
    expect(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY)).toBeNull();
  });

  it('migrates meshcore topicPrefix to IATA for Colorado Mesh host', () => {
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({ server: COLORADO_MESH_HOST, topicPrefix: 'meshcore', port: 443 }),
    );

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      topicPrefix?: string;
    };
    expect(parsed.topicPrefix).toBe('meshcore/DEN');
    expect(localStorage.getItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY)).toBe('1');
  });

  it('migrates meshcore topicPrefix to test IATA for non-Colorado hosts', () => {
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({ server: 'mqtt.example.com', topicPrefix: 'meshcore', port: 1883 }),
    );

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      topicPrefix?: string;
    };
    expect(parsed.topicPrefix).toBe('meshcore/test');
  });

  it('sets migration marker even when meshcore settings are absent', () => {
    runConnectionPanelStorageMigrations();
    expect(localStorage.getItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY)).toBe('1');
  });

  it('migrates Colorado Mesh port from 1883 to 443', () => {
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({ server: COLORADO_MESH_HOST, topicPrefix: 'meshcore/DEN', port: 1883 }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      port?: number;
    };
    expect(parsed.port).toBe(443);
    expect(localStorage.getItem(COLORADO_MESH_PORT_MIGRATION_KEY)).toBe('1');
  });

  it('is idempotent on second call', () => {
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({ server: COLORADO_MESH_HOST, topicPrefix: 'meshcore', port: 443 }),
    );
    runConnectionPanelStorageMigrations();
    const afterFirst = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);

    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY)).toBe(afterFirst);
  });
});
