import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...MESHCORE_MQTT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<MQTTSettings>;
    const merged = { ...MESHCORE_MQTT_DEFAULTS, ...parsed };
    const r = merged.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS;
    return {
      ...merged,
      maxRetries: Math.min(MQTT_MAX_RECONNECT_ATTEMPTS, Math.max(1, r)),
    };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...MESHCORE_MQTT_DEFAULTS };
  }
}
