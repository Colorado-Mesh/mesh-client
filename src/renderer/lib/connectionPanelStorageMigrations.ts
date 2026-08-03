import {
  COLORADO_MESH_HOST,
  isLetsMeshSettings,
  MESHMAPPER_HOST,
  MESHMAPPER_HOST_LEGACY_CC,
  migrateMeshmapperServerHost,
} from './letsMeshJwt';
import {
  applyMeshcoreMqttPreset,
  MESHCORE_MQTT_PRESET_STORAGE_KEY,
  type MeshcoreMqttPreset,
  meshcoreMqttPresetFields,
  readStoredMeshcoreMqttPreset,
} from './meshcoreMqttPresets';
import { readMeshcoreMqttSettingsFromStorage } from './meshcoreMqttSettingsStorage';
import { parseMeshcoreIataTopicPrefix } from './meshcoreMqttTopicPrefix';
import { parseStoredJson } from './parseStoredJson';
import type { MQTTSettings } from './types';

const LEGACY_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
const MESHCORE_TOPIC_IATA_MIGRATION_KEY = 'mesh-client:migrated:meshcore-topic-iata-v1';
const COLORADO_MESH_PORT_MIGRATION_KEY = 'mesh-client:migrated:colorado-mesh-port-443-v1';
const MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY = 'mesh-client:migrated:meshcore-letsmesh-default-v1';
const MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY = 'mesh-client:migrated:meshcore-topic-iata-shape-v1';
const MESHMAPPER_HOST_NET_MIGRATION_KEY = 'mesh-client:migrated:meshmapper-host-net-v1';
/** Set after the one-time Colorado-region ConfirmModal (or Colorado preset confirm). */
export const COLORADO_MQTT_REGION_ACK_KEY = 'mesh-client:coloradoMqttRegionAck-v1';

/** True when Colorado Mesh is configured and the user has not answered the region gate yet. */
export function meshcoreMqttNeedsColoradoRegionAck(): boolean {
  if (localStorage.getItem(COLORADO_MQTT_REGION_ACK_KEY) !== null) return false;
  if (readStoredMeshcoreMqttPreset() === 'coloradomesh') return true;
  return readMeshcoreMqttSettingsFromStorage().server.trim() === COLORADO_MESH_HOST;
}

const PRESET_RECONCILE_PRESETS = new Set<MeshcoreMqttPreset>([
  'letsmesh',
  'coloradomesh',
  'meshmapper',
]);

function meshcorePresetFieldsDiffer(preset: MeshcoreMqttPreset, settings: MQTTSettings): boolean {
  const fields = meshcoreMqttPresetFields(preset, settings);
  if (!fields) return false;
  return (Object.keys(fields) as (keyof MQTTSettings)[]).some(
    (key) => settings[key] !== fields[key],
  );
}

function migrateMqttSettingsOnce(): void {
  if (localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY) !== null) return;
  const raw = localStorage.getItem(LEGACY_MQTT_SETTINGS_KEY);
  if (!raw) return;
  const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMqttSettingsOnce');
  if (!parsed) return;
  if (typeof parsed.topicPrefix === 'string' && parsed.topicPrefix.startsWith('meshcore')) {
    localStorage.setItem(MESHCORE_MQTT_SETTINGS_KEY, raw);
    localStorage.removeItem(LEGACY_MQTT_SETTINGS_KEY);
  }
}

function migrateMeshcoreTopicIataOnce(): void {
  if (localStorage.getItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY) !== null) return;
  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  if (raw) {
    const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMeshcoreTopicIataOnce');
    if (parsed?.topicPrefix === 'meshcore' && typeof parsed.server === 'string') {
      const iata = parsed.server.trim() === COLORADO_MESH_HOST ? 'DEN' : 'test';
      localStorage.setItem(
        MESHCORE_MQTT_SETTINGS_KEY,
        JSON.stringify({ ...parsed, topicPrefix: `meshcore/${iata}` }),
      );
    }
  }
  localStorage.setItem(MESHCORE_TOPIC_IATA_MIGRATION_KEY, '1');
}

function migrateColoradoMeshPortOnce(): void {
  if (localStorage.getItem(COLORADO_MESH_PORT_MIGRATION_KEY) !== null) return;
  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  if (raw) {
    const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateColoradoMeshPortOnce');
    if (
      parsed &&
      typeof parsed.server === 'string' &&
      parsed.server.trim() === COLORADO_MESH_HOST &&
      parsed.port === 1883
    ) {
      localStorage.setItem(MESHCORE_MQTT_SETTINGS_KEY, JSON.stringify({ ...parsed, port: 443 }));
    }
  }
  localStorage.setItem(COLORADO_MESH_PORT_MIGRATION_KEY, '1');
}

/** New installs (and missing preset + empty server): default MeshCore MQTT to LetsMesh. */
function seedMeshcoreLetsMeshDefaultOnce(): void {
  if (localStorage.getItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY) !== null) return;

  const hadPreset = localStorage.getItem(MESHCORE_MQTT_PRESET_STORAGE_KEY) !== null;
  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  const parsed = raw
    ? parseStoredJson<Partial<MQTTSettings>>(raw, 'seedMeshcoreLetsMeshDefaultOnce')
    : null;
  const server = typeof parsed?.server === 'string' ? parsed.server.trim() : '';

  if (!hadPreset) {
    if (server) {
      // Hand-tuned broker without a preset key — do not overwrite settings.
      localStorage.setItem(MESHCORE_MQTT_PRESET_STORAGE_KEY, 'custom');
    } else {
      localStorage.setItem(MESHCORE_MQTT_PRESET_STORAGE_KEY, 'letsmesh');
      const next = applyMeshcoreMqttPreset('letsmesh', (parsed ?? {}) as MQTTSettings);
      localStorage.setItem(MESHCORE_MQTT_SETTINGS_KEY, JSON.stringify(next));
    }
  }

  localStorage.setItem(MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY, '1');
}

/**
 * Repair malformed IATA-scoped topic prefixes; uppercase 3-letter segments.
 * Colorado host → meshcore/DEN; other device-signing hosts → meshcore/test.
 */
function migrateMeshcoreTopicIataShapeOnce(): void {
  if (localStorage.getItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY) !== null) return;
  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  if (raw) {
    const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMeshcoreTopicIataShapeOnce');
    const server = typeof parsed?.server === 'string' ? parsed.server.trim() : '';
    const topicPrefix = typeof parsed?.topicPrefix === 'string' ? parsed.topicPrefix : '';
    if (parsed && server && isLetsMeshSettings(server) && topicPrefix) {
      const result = parseMeshcoreIataTopicPrefix(topicPrefix);
      if (result.ok) {
        if (result.normalized !== topicPrefix) {
          localStorage.setItem(
            MESHCORE_MQTT_SETTINGS_KEY,
            JSON.stringify({ ...parsed, topicPrefix: result.normalized }),
          );
        }
      } else {
        const fallback = server === COLORADO_MESH_HOST ? 'meshcore/DEN' : 'meshcore/test';
        localStorage.setItem(
          MESHCORE_MQTT_SETTINGS_KEY,
          JSON.stringify({ ...parsed, topicPrefix: fallback }),
        );
      }
    }
  }
  localStorage.setItem(MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY, '1');
}

/**
 * Rewrite mqtt.meshmapper.cc → mqtt.meshmapper.net (TLS on `.cc` fails with alert 80).
 * Also runs when migration marker is set if the legacy host is still present (idempotent rewrite).
 */
function migrateMeshmapperHostToNetOnce(): void {
  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  if (raw) {
    const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMeshmapperHostToNetOnce');
    if (parsed && typeof parsed.server === 'string') {
      const nextServer = migrateMeshmapperServerHost(parsed.server);
      if (nextServer !== parsed.server) {
        localStorage.setItem(
          MESHCORE_MQTT_SETTINGS_KEY,
          JSON.stringify({ ...parsed, server: nextServer }),
        );
      }
    }
  }
  if (localStorage.getItem(MESHMAPPER_HOST_NET_MIGRATION_KEY) === null) {
    localStorage.setItem(MESHMAPPER_HOST_NET_MIGRATION_KEY, '1');
  }
}

/** Re-apply saved MeshCore network preset defaults when stored fields are stale. */
function reconcileMeshcoreMqttPresetSettings(): void {
  const preset = readStoredMeshcoreMqttPreset();
  if (!PRESET_RECONCILE_PRESETS.has(preset)) return;

  const raw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  const parsed = raw
    ? parseStoredJson<Partial<MQTTSettings>>(raw, 'reconcileMeshcoreMqttPresetSettings')
    : null;
  const current = (parsed ?? {}) as MQTTSettings;
  if (!meshcorePresetFieldsDiffer(preset, current)) return;

  const next = applyMeshcoreMqttPreset(preset, current);
  localStorage.setItem(MESHCORE_MQTT_SETTINGS_KEY, JSON.stringify(next));
}

/** Idempotent localStorage migrations for ConnectionPanel MQTT settings. */
export function runConnectionPanelStorageMigrations(): void {
  migrateMqttSettingsOnce();
  migrateMeshcoreTopicIataOnce();
  migrateColoradoMeshPortOnce();
  seedMeshcoreLetsMeshDefaultOnce();
  migrateMeshcoreTopicIataShapeOnce();
  migrateMeshmapperHostToNetOnce();
  reconcileMeshcoreMqttPresetSettings();
}

export {
  COLORADO_MESH_PORT_MIGRATION_KEY,
  LEGACY_MQTT_SETTINGS_KEY,
  MESHCORE_LETSMESH_DEFAULT_MIGRATION_KEY,
  MESHCORE_MQTT_SETTINGS_KEY,
  MESHCORE_TOPIC_IATA_MIGRATION_KEY,
  MESHCORE_TOPIC_IATA_SHAPE_MIGRATION_KEY,
  MESHMAPPER_HOST,
  MESHMAPPER_HOST_LEGACY_CC,
  MESHMAPPER_HOST_NET_MIGRATION_KEY,
};
