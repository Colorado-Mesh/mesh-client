import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './meshtasticMqttTlsMigration';
import type { MQTTSettings } from './types';

export const MESHTASTIC_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';
const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
const PSK_RECOVERY_FLAG = 'mesh-client:migrated:meshtastic-psk-recovery-v1';

type MqttSettingsWithPsks = Partial<MQTTSettings> & { channelPsks?: string[] };

/**
 * Legacy `connectionPanelStorageMigrations` moved the entire JSON blob to the MeshCore key when
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

  const merged: MqttSettingsWithPsks = {
    ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS,
    ...(meshtastic ?? {}),
    channelPsks: psks,
  };
  localStorage.setItem(MESHTASTIC_MQTT_SETTINGS_KEY, JSON.stringify(merged));
  localStorage.setItem(PSK_RECOVERY_FLAG, '1');
}

/** Read persisted Meshtastic MQTT settings (same merge as ConnectionPanel). */
export function readMeshtasticMqttSettingsFromStorage(): MQTTSettings {
  try {
    const raw = localStorage.getItem(MESHTASTIC_MQTT_SETTINGS_KEY);
    if (!raw) return { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<MQTTSettings>;
    const merged = { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS, ...parsed };
    const r = merged.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS;
    return {
      ...merged,
      maxRetries: Math.min(MQTT_MAX_RECONNECT_ATTEMPTS, Math.max(1, r)),
    };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS };
  }
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
