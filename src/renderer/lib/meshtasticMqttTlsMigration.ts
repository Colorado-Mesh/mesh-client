import type { MQTTSettings } from '@/renderer/lib/types';
import { MQTT_DEFAULT_RECONNECT_ATTEMPTS } from '@/shared/meshtasticMqttReconnect';

export const MESHTASTIC_OFFICIAL_BROKER_HOST = 'mqtt.meshtastic.org';
export const LIAM_BROKER_HOST = 'mqtt.meshtastic.liamcottle.net';

const MESHTASTIC_OFFICIAL_SHARED: Pick<
  MQTTSettings,
  'server' | 'username' | 'password' | 'topicPrefix' | 'autoLaunch' | 'maxRetries'
> = {
  server: MESHTASTIC_OFFICIAL_BROKER_HOST,
  username: 'meshdev',
  password: 'large4cats',
  topicPrefix: 'msh/US/',
  autoLaunch: false,
  maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
};

/** Public broker — plaintext MQTT (port 1883). */
export const MESHTASTIC_OFFICIAL_1883: MQTTSettings = {
  ...MESHTASTIC_OFFICIAL_SHARED,
  port: 1883,
};

/** Default merged preset for new installs / missing keys. */
export const MESHTASTIC_OFFICIAL_PRESET_DEFAULTS: MQTTSettings = MESHTASTIC_OFFICIAL_1883;

/** Liam Cottle's uplink-only map server — plaintext MQTT :1883, no TLS. */
export const MESHTASTIC_LIAM_1883: MQTTSettings = {
  server: LIAM_BROKER_HOST,
  port: 1883,
  username: 'uplink',
  password: 'uplink',
  topicPrefix: 'msh/US/',
  autoLaunch: false,
  maxRetries: MQTT_DEFAULT_RECONNECT_ATTEMPTS,
};

export function isMeshtasticOfficialBrokerSettings(s: MQTTSettings): boolean {
  return s.server?.trim().toLowerCase() === MESHTASTIC_OFFICIAL_BROKER_HOST.toLowerCase();
}

export function isLiamBrokerSettings(s: MQTTSettings): boolean {
  return s.server?.trim().toLowerCase() === LIAM_BROKER_HOST.toLowerCase();
}

/** Extra context for Connection tab MQTT errors. */
export function meshtasticMqttErrorUserHint(error: string): string {
  return error;
}
