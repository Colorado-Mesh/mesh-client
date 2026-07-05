import { MQTT_DEFAULT_RECONNECT_ATTEMPTS } from '@/shared/meshtasticMqttReconnect';

import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import type { MQTTSettings } from './types';

const STORAGE_KEY = 'mesh-client:mqttSettings:meshcore';

const MESHCORE_MQTT_DEFAULTS: MQTTSettings = {
  server: '',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'meshcore',
  autoLaunch: false,
  maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  tokenExpiresAt: undefined,
  useWebSocket: true,
  tlsEnabled: true,
  wsPath: '/ws',
};

/** Read persisted MeshCore MQTT settings (same merge as ConnectionPanel). */
export function readMeshcoreMqttSettingsFromStorage(): MQTTSettings {
  return readMqttSettingsFromStorage(STORAGE_KEY, MESHCORE_MQTT_DEFAULTS);
}
