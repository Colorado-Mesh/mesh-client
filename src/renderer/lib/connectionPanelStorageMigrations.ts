import { COLORADO_MESH_HOST } from './letsMeshJwt';
import {
  applyMeshcoreMqttPreset,
  type MeshcoreMqttPreset,
  meshcoreMqttPresetFields,
  readStoredMeshcoreMqttPreset,
} from './meshcoreMqttPresets';
import { parseStoredJson } from './parseStoredJson';
import type { MQTTSettings } from './types';

const LEGACY_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
const MESHCORE_TOPIC_IATA_MIGRATION_KEY = 'mesh-client:migrated:meshcore-topic-iata-v1';
const COLORADO_MESH_PORT_MIGRATION_KEY = 'mesh-client:migrated:colorado-mesh-port-443-v1';

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
  reconcileMeshcoreMqttPresetSettings();
}

export {
  COLORADO_MESH_PORT_MIGRATION_KEY,
  LEGACY_MQTT_SETTINGS_KEY,
  MESHCORE_MQTT_SETTINGS_KEY,
  MESHCORE_TOPIC_IATA_MIGRATION_KEY,
};
