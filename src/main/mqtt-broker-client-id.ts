import { randomBytes } from 'crypto';

import type { MQTTSettings } from '../renderer/lib/types';
import type { MeshProtocol } from '../shared/meshProtocol';
import { getDatabase } from './database';
import { sanitizeLogMessage } from './sanitize-log-message';

export const MESHTASTIC_MQTT_CLIENT_ID_SETTING_KEY = 'meshtasticMqttClientId';
export const MESHCORE_MQTT_CLIENT_ID_SETTING_KEY = 'meshcoreMqttClientId';
export const MESHCOM_MQTT_CLIENT_ID_SETTING_KEY = 'meshcomMqttClientId';

const MESHTASTIC_CLIENT_ID_PREFIX = 'meshtastic-electron-';
const MESHCORE_CLIENT_ID_PREFIX = 'meshcore-mqtt-';
const MESHCOM_CLIENT_ID_PREFIX = 'meshcom-mqtt-';
const MESHCORE_FEED_CLIENT_ID_SETTING_PREFIX = 'meshcoreMqttClientId:';
const CLIENT_ID_HEX_BYTES = 8;
/** Feed ids come from the renderer; bound the setting key they map to. */
const MAX_CONNECTION_ID_LENGTH = 64;

const V1_USERNAME_PATTERN = /^v1_[0-9a-f]{64}$/i;

function readAppSetting(key: string): string | null {
  try {
    const row = getDatabase()
      .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return typeof row?.value === 'string' && row.value.length > 0 ? row.value : null;
  } catch (e: unknown) {
    console.debug(
      '[main/mqtt-broker-client-id] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );

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

function generateMeshcomClientId(): string {
  return `${MESHCOM_CLIENT_ID_PREFIX}${randomBytes(CLIENT_ID_HEX_BYTES).toString('hex')}`;
}

function isValidMeshtasticClientId(id: string): boolean {
  return new RegExp(`^${MESHTASTIC_CLIENT_ID_PREFIX}[0-9a-f]{${CLIENT_ID_HEX_BYTES * 2}}$`).test(
    id,
  );
}

function isValidMeshcoreClientId(id: string): boolean {
  return new RegExp(`^${MESHCORE_CLIENT_ID_PREFIX}[0-9a-f]{${CLIENT_ID_HEX_BYTES * 2}}$`).test(id);
}

function isValidMeshcomClientId(id: string): boolean {
  return new RegExp(`^${MESHCOM_CLIENT_ID_PREFIX}[0-9a-f]{${CLIENT_ID_HEX_BYTES * 2}}$`).test(id);
}

/**
 * Resolve a stable MQTT broker clientId for this install.
 * MeshCore LetsMesh v1 usernames double as clientId (unchanged).
 *
 * MeshCore analyzer feeds pass a `connectionId`; each gets its own stored clientId so two feeds
 * pointing at the same broker never share an MQTT session id.
 */
export function resolveMqttBrokerClientId(
  protocol: MeshProtocol,
  settings: MQTTSettings,
  connectionId?: string,
): string {
  if (protocol === 'meshcore' && V1_USERNAME_PATTERN.test(settings.username ?? '')) {
    return settings.username;
  }

  if (protocol === 'meshcom') {
    const existing = readAppSetting(MESHCOM_MQTT_CLIENT_ID_SETTING_KEY);
    if (existing && isValidMeshcomClientId(existing)) return existing;
    const clientId = generateMeshcomClientId();
    writeAppSetting(MESHCOM_MQTT_CLIENT_ID_SETTING_KEY, clientId);
    return clientId;
  }

  if (protocol === 'meshcore' && connectionId && connectionId !== 'chat') {
    const safeId = connectionId.slice(0, MAX_CONNECTION_ID_LENGTH);
    const settingKey = `${MESHCORE_FEED_CLIENT_ID_SETTING_PREFIX}${safeId}`;
    const existing = readAppSetting(settingKey);
    if (existing && isValidMeshcoreClientId(existing)) return existing;
    const clientId = generateMeshcoreClientId();
    writeAppSetting(settingKey, clientId);
    return clientId;
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
