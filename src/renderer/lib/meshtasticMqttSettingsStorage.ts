import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './meshtasticMqttTlsMigration';
import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import {
  getCachedSecureSecret,
  MESHCORE_MQTT_SECRET_KEY,
  MESHTASTIC_MQTT_SECRET_KEY,
  setSecureSecret,
} from './secureSecretStorage';
import type { MQTTSettings } from './types';

export const MESHTASTIC_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const PSK_RECOVERY_FLAG = 'mesh-client:migrated:meshtastic-psk-recovery-v1';

type MqttSettingsWithPsks = Partial<MQTTSettings> & { channelPsks?: string[] };

/**
 * Legacy `connectionPanelStorageMigrations` moved the entire JSON blob to the MeshCore key when
 * topicPrefix started with "meshcore", leaving Meshtastic manual PSK lines unreachable.
 */
function recoverMeshtasticChannelPsksFromLegacyMigration(): void {
  if (localStorage.getItem(PSK_RECOVERY_FLAG) !== null) return;

  const meshtasticRaw = getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY);
  const meshtastic = parseStoredJson<MqttSettingsWithPsks>(
    meshtasticRaw,
    'recoverMeshtasticChannelPsksFromLegacyMigration meshtastic',
  );
  if (meshtastic?.channelPsks?.length) {
    localStorage.setItem(PSK_RECOVERY_FLAG, '1');
    return;
  }

  const meshcoreRaw = getCachedSecureSecret(MESHCORE_MQTT_SECRET_KEY);
  const meshcore = parseStoredJson<MqttSettingsWithPsks>(
    meshcoreRaw,
    'recoverMeshtasticChannelPsksFromLegacyMigration meshcore',
  );
  const psks = meshcore?.channelPsks;
  if (!psks?.length) {
    localStorage.setItem(PSK_RECOVERY_FLAG, '1');
    return;
  }

  const merged: MqttSettingsWithPsks = { ...meshtastic, channelPsks: psks };
  void setSecureSecret(MESHTASTIC_MQTT_SECRET_KEY, JSON.stringify(merged));
  localStorage.setItem(PSK_RECOVERY_FLAG, '1');
}

/** Read persisted Meshtastic MQTT settings (same merge as ConnectionPanel). */
export function readMeshtasticMqttSettingsFromStorage(): MQTTSettings {
  return readMqttSettingsFromStorage(
    MESHTASTIC_MQTT_SETTINGS_KEY,
    MESHTASTIC_OFFICIAL_PRESET_DEFAULTS,
    MESHTASTIC_MQTT_SECRET_KEY,
  );
}

/** Manual Connection panel channel PSK lines for Meshtastic MQTT decrypt/publish fallback. */
export function loadMeshtasticMqttManualChannelPsksFromStorage(): string[] {
  recoverMeshtasticChannelPsksFromLegacyMigration();
  const parsed = parseStoredJson<MqttSettingsWithPsks>(
    getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY),
    'loadMeshtasticMqttManualChannelPsksFromStorage',
  );
  return parsed?.channelPsks ?? [];
}
