import type { MQTTSettings } from './types';

const STORAGE_KEY = 'mesh-client:mqttSettings:meshcore';

const MESHCORE_MQTT_DEFAULTS: MQTTSettings = {
  server: '',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'meshcore',
  autoLaunch: false,
  maxRetries: 5,
};

/** Read persisted MeshCore MQTT settings (same merge as ConnectionPanel). */
export function readMeshcoreMqttSettingsFromStorage(): MQTTSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...MESHCORE_MQTT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<MQTTSettings>;
    return { ...MESHCORE_MQTT_DEFAULTS, ...parsed };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...MESHCORE_MQTT_DEFAULTS };
  }
}
