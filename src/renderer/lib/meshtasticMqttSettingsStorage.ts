import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

import type { MQTTSettings } from './types';

export const MESHTASTIC_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
const PSK_RECOVERY_FLAG = 'mesh-client:migrated:meshtastic-psk-recovery-v1';

type MqttSettingsWithPsks = Partial<MQTTSettings> & { channelPsks?: string[] };

/**
 * Legacy `migrateMqttSettingsOnce` moved the entire JSON blob to the MeshCore key when
 * topicPrefix started with "meshcore", leaving Meshtastic manual PSK lines unreachable.
 */
function recoverMeshtasticChannelPsksFromLegacyMigration(): void {
  if (localStorage.getItem(PSK_RECOVERY_FLAG) !== null) return;

  const meshtasticRaw = localStorage.getItem(MESHTASTIC_MQTT_SETTINGS_KEY);
  const meshtastic = parseStoredJson<MqttSettingsWithPsks>(
    meshtasticRaw,
    'recoverMeshtasticChannelPsksFromLegacyMigration meshtastic',
  );
  if (meshtastic?.channelPsks?.length) {
    localStorage.setItem(PSK_RECOVERY_FLAG, '1');
    return;
  }

  const meshcoreRaw = localStorage.getItem(MESHCORE_MQTT_SETTINGS_KEY);
  const meshcore = parseStoredJson<MqttSettingsWithPsks>(
    meshcoreRaw,
    'recoverMeshtasticChannelPsksFromLegacyMigration meshcore',
  );
  const psks = meshcore?.channelPsks;
  if (!psks?.length) {
    localStorage.setItem(PSK_RECOVERY_FLAG, '1');
    return;
  }

  const merged: MqttSettingsWithPsks = { ...(meshtastic ?? {}), channelPsks: psks };
  localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify(merged));
  localStorage.setItem(PSK_RECOVERY_FLAG, '1');
}

/** Manual Connection panel channel PSK lines for Meshtastic MQTT decrypt/publish fallback. */
export function loadMeshtasticMqttManualChannelPsksFromStorage(): string[] {
  recoverMeshtasticChannelPsksFromLegacyMigration();
  const raw = localStorage.getItem(MESHTASTIC_MQTT_SETTINGS_KEY);
  const parsed = parseStoredJson<MqttSettingsWithPsks>(
    raw,
    'loadMeshtasticMqttManualChannelPsksFromStorage',
  );
  return parsed?.channelPsks ?? [];
}
