import { randomBytes } from 'crypto';

import type { MQTTSettings } from '../renderer/lib/types';
import { getDatabase } from './database';

export const MESHTASTIC_MQTT_CLIENT_ID_SETTING_KEY = 'meshtasticMqttClientId';
export const MESHCORE_MQTT_CLIENT_ID_SETTING_KEY = 'meshcoreMqttClientId';

const MESHTASTIC_CLIENT_ID_PREFIX = 'meshtastic-electron-';
const MESHCORE_CLIENT_ID_PREFIX = 'meshcore-mqtt-';
const CLIENT_ID_HEX_BYTES = 8;

const V1_USERNAME_PATTERN = /^v1_[0-9A-Fa-f]{64}$/i;

function readAppSetting(key: string): string | null {
  try {
    const row = getDatabase()
      .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return typeof row?.value === 'string' && row.value.length > 0 ? row.value : null;
  } catch {
    // catch-no-log-ok DB read during early startup
    return null;
  }
}

function writeAppSetting(key: string, value: string): void {
  getDatabase()
    .prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)')
    .run(key, value);
}

function generateMeshtasticClientId(): string {
  return `${MESHTASTIC_CLIENT_ID_PREFIX}${randomBytes(CLIENT_ID_HEX_BYTES).toString('hex')}`;
}

function generateMeshcoreClientId(): string {
  return `${MESHCORE_CLIENT_ID_PREFIX}${randomBytes(CLIENT_ID_HEX_BYTES).toString('hex')}`;
}

function isValidMeshtasticClientId(id: string): boolean {
  return new RegExp(`^${MESHTASTIC_CLIENT_ID_PREFIX}[0-9a-f]{${CLIENT_ID_HEX_BYTES * 2}}$`).test(
    id,
  );
}

function isValidMeshcoreClientId(id: string): boolean {
  return new RegExp(`^${MESHCORE_CLIENT_ID_PREFIX}[0-9a-f]{${CLIENT_ID_HEX_BYTES * 2}}$`).test(id);
}

/**
 * Resolve a stable MQTT broker clientId for this install.
 * MeshCore LetsMesh v1 usernames double as clientId (unchanged).
 */
export function resolveMqttBrokerClientId(
  protocol: 'meshtastic' | 'meshcore',
  settings: MQTTSettings,
): string {
  if (protocol === 'meshcore' && V1_USERNAME_PATTERN.test(settings.username ?? '')) {
    return settings.username;
  }

  const settingKey =
    protocol === 'meshtastic'
      ? MESHTASTIC_MQTT_CLIENT_ID_SETTING_KEY
      : MESHCORE_MQTT_CLIENT_ID_SETTING_KEY;
  const isValid = protocol === 'meshtastic' ? isValidMeshtasticClientId : isValidMeshcoreClientId;
  const generate =
    protocol === 'meshtastic' ? generateMeshtasticClientId : generateMeshcoreClientId;

  const existing = readAppSetting(settingKey);
  if (existing && isValid(existing)) {
    return existing;
  }

  const clientId = generate();
  writeAppSetting(settingKey, clientId);
  return clientId;
}
