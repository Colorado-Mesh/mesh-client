// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLORADO_MESH_PORT_MIGRATION_KEY,
  LEGACY_MQTT_SETTINGS_KEY,
  MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY,
  MESHCORE_MQTT_SETTINGS_KEY,
  MESHCORE_TOPIC_IATA_MIGRATION_KEY,
  MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY,
  MESHMAPPER_HOST_LEGACY_CC,
  MESHMAPPER_HOST_NET_MIGRATION_KEY,
  runConnectionPanelStorageMigrations,
} from './connectionPanelStorageMigrations';
import { COLORADO_MESH_HOST, LETSMESH_HOST_US, MESHMAPPER_HOST, WAEV_HOST } from './letsMeshJwt';

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
    // Legacy Meshtastic blob stays; MeshCore settings may be seeded as LetsMesh for new installs.
    const meshcoreRaw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
    expect(meshcoreRaw).not.toBe(legacy);
    if (meshcoreRaw) {
      const parsed = JSON.parse(meshcoreRaw) as { server?: string };
      expect(parsed.server).toBe(LETSMESH_HOST_US);
    }
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

  it('reconciles stale Colorado Mesh preset settings to port 443 on startup', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: COLORADO_MESH_HOST,
        topicPrefix: 'meshcore/DEN',
        port: 1883,
        useWebSocket: true,
        tlsEnabled: true,
        autoLaunch: true,
      }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      port?: number;
      wsPath?: string;
      autoLaunch?: boolean;
    };
    expect(parsed.port).toBe(443);
    expect(parsed.wsPath).toBe('/ws');
    expect(parsed.autoLaunch).toBe(true);
  });

  it('reconciles stale Waev preset settings to the WSS device-signing defaults', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'waev');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: WAEV_HOST,
        topicPrefix: 'meshcore/test',
        port: 1883,
        useWebSocket: false,
        tlsEnabled: false,
        autoLaunch: true,
      }),
    );
    // Skip unrelated one-time migrations so only the preset reconcile runs.
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHMAPPER_HOST_NET_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      server?: string;
      port?: number;
      useWebSocket?: boolean;
      tlsEnabled?: boolean;
      wsPath?: string;
      autoLaunch?: boolean;
    };
    expect(parsed.server).toBe(WAEV_HOST);
    expect(parsed.port).toBe(443);
    expect(parsed.useWebSocket).toBe(true);
    expect(parsed.tlsEnabled).toBe(true);
    expect(parsed.wsPath).toBe('/mqtt');
    expect(parsed.autoLaunch).toBe(true);
  });

  it('does not overwrite custom preset settings', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'custom');
    const custom = JSON.stringify({
      server: 'mqtt.example.com',
      topicPrefix: 'meshcore/custom',
      port: 1883,
    });
    localStorage.setItem(MESHCORE_MQTT_SETTINGS_KEY, custom);

    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY)).toBe(custom);
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

  it('seeds LetsMesh for new installs with no preset and empty server', () => {
    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('letsmesh');
    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      server?: string;
      topicPrefix?: string;
      port?: number;
    };
    expect(parsed.server).toBe(LETSMESH_HOST_US);
    expect(parsed.topicPrefix).toBe('meshcore/test');
    expect(parsed.port).toBe(443);
    expect(localStorage.getItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY)).toBe('1');
  });

  it('marks custom when preset missing but server is non-empty', () => {
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({ server: 'mqtt.example.com', topicPrefix: 'meshcore/foo', port: 1883 }),
    );

    runConnectionPanelStorageMigrations();

    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('custom');
    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      server?: string;
    };
    expect(parsed.server).toBe('mqtt.example.com');
  });

  it('repairs invalid IATA topic shapes on device-signing hosts', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: LETSMESH_HOST_US,
        topicPrefix: 'meshcore/xx',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
      }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      topicPrefix?: string;
    };
    expect(parsed.topicPrefix).toBe('meshcore/test');
    expect(localStorage.getItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY)).toBe('1');
  });

  it('uppercases lowercase IATA segments on Colorado host', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: COLORADO_MESH_HOST,
        topicPrefix: 'meshcore/den',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      topicPrefix?: string;
    };
    // Preset reconcile stamps DEN; shape migration also uppercases den → DEN.
    expect(parsed.topicPrefix).toBe('meshcore/DEN');
  });

  it('migrates MeshMapper mqtt.meshmapper.cc to mqtt.meshmapper.net', () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'meshmapper');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: MESHMAPPER_HOST_LEGACY_CC,
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      server?: string;
    };
    expect(parsed.server).toBe(MESHMAPPER_HOST);
    expect(localStorage.getItem(MESHMAPPER_HOST_NET_MIGRATION_KEY)).toBe('1');
  });

  it('rewrites MeshMapper .cc even when migration marker is already set', () => {
    localStorage.setItem(MESHMAPPER_HOST_NET_MIGRATION_KEY, '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'custom');
    localStorage.setItem(
      MESHCORE_MQTT_SETTINGS_KEY,
      JSON.stringify({
        server: MESHMAPPER_HOST_LEGACY_CC,
        topicPrefix: 'meshcore/test',
        port: 443,
      }),
    );
    localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
    localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');
    localStorage.setItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY, '1');

    runConnectionPanelStorageMigrations();

    const parsed = JSON.parse(localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) ?? '{}') as {
      server?: string;
    };
    expect(parsed.server).toBe(MESHMAPPER_HOST);
  });
});
