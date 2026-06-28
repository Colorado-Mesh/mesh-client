import { COLORADO_MESH_HOST } from './letsMeshJwt';
import { parseStoredJson } from './parseStoredJson';
import type { MQTTSettings } from './types';

const LEGACY_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
const MESHCORE_TOPIC_IATA_MIGRATION_KEY = 'mesh-client:migrated:meshcore-topic-iata-v1';

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

/** Idempotent localStorage migrations for ConnectionPanel MQTT settings. */
export function runConnectionPanelStorageMigrations(): void {
  migrateMqttSettingsOnce();
  migrateMeshcoreTopicIataOnce();
}

export { LEGACY_MQTT_SETTINGS_KEY, MESHCORE_MQTT_SETTINGS_KEY, MESHCORE_TOPIC_IATA_MIGRATION_KEY };
