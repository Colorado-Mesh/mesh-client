import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './meshtasticMqttTlsMigration';
import { readMqttSettingsFromStorage } from './mqttSettingsStorage';
import {
  getCachedSecureSecret,
  MESHTASTIC_MQTT_SECRET_KEY,
  recoverMeshtasticChannelPsksFromLegacyMigration,
} from './secureSecretStorage';
import type { MQTTSettings } from './types';

export const MESHTASTIC_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings';

type MqttSettingsWithPsks = Partial<MQTTSettings> & { channelPsks?: string[] };

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
  const recovered = recoverMeshtasticChannelPsksFromLegacyMigration();
  const parsed = parseStoredJson<MqttSettingsWithPsks>(
    getCachedSecureSecret(MESHTASTIC_MQTT_SECRET_KEY),
    'loadMeshtasticMqttManualChannelPsksFromStorage',
  );
  return parsed?.channelPsks?.length ? parsed.channelPsks : (recovered ?? []);
}
