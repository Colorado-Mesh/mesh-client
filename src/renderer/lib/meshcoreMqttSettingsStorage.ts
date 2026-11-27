import { MESHCORE_MQTT_DEFAULTS, MESHCORE_MQTT_SETTINGS_STORAGE_KEY } from './meshcoreMqttDefaults';
import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import { MESHCORE_MQTT_SECRET_KEY } from './secureSecretStorage';
import type { MQTTSettings } from './types';

/**
 * Read persisted MeshCore chat-broker settings (same merge as ConnectionPanel).
 * Analyzer feeds use `loadMeshcoreMqttFeeds()` instead — the chat broker keeps the legacy key so
 * presets, migrations and auto-launch keep working unchanged.
 */
export function readMeshcoreMqttSettingsFromStorage(): MQTTSettings {
  return readMqttSettingsFromStorage(
    MESHCORE_MQTT_SETTINGS_STORAGE_KEY,
    MESHCORE_MQTT_DEFAULTS,
    MESHCORE_MQTT_SECRET_KEY,
  );
}
