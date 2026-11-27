import { MQTT_DEFAULT_RECONNECT_ATTEMPTS } from '@/shared/meshtasticMqttReconnect';

import type { MQTTSettings } from './types';

/** Chat-broker settings key. Analyzer feeds live in `meshcoreMqttFeeds`. */
export const MESHCORE_MQTT_SETTINGS_STORAGE_KEY = 'mesh-client:mqttSettings:meshcore';

/** Saved MeshCore analyzer-feed document (`{ version, chatName, feeds }`). */
export const MESHCORE_MQTT_FEEDS_STORAGE_KEY = 'mesh-client:mqttFeeds:meshcore';

export const MESHCORE_MQTT_DEFAULTS: MQTTSettings = {
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
