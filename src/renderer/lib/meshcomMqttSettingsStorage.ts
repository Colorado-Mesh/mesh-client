import { MQTT_DEFAULT_RECONNECT_ATTEMPTS } from '@/shared/meshtasticMqttReconnect';

import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import { MESHCOM_MQTT_SECRET_KEY } from './secureSecretStorage';
import type { MQTTSettings } from './types';

export const MESHCOM_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcom';

const MESHCOM_MQTT_DEFAULTS: MQTTSettings = {
  server: '',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'meshcom',
  autoLaunch: false,
  maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  useWebSocket: false,
  tlsEnabled: false,
};

/** Read persisted MeshCom MQTT settings (custom brokers only — no network presets). */
export function readMeshcomMqttSettingsFromStorage(): MQTTSettings {
  return readMqttSettingsFromStorage(
    MESHCOM_MQTT_SETTINGS_KEY,
    MESHCOM_MQTT_DEFAULTS,
    MESHCOM_MQTT_SECRET_KEY,
  );
}
