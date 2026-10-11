import {
  clampMqttMaxRetries,
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

import { getCachedSecureSecret } from './secureSecretStorage';
import type { MQTTSettings } from './types';

/** Merge persisted MQTT JSON with defaults and clamp maxRetries. */
export function readMqttSettingsFromStorage(
  storageKey: string,
  defaults: MQTTSettings,
  secretKey?: string,
): MQTTSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<MQTTSettings>) : {};
    let secureSettings: Partial<MQTTSettings> = {};
    if (secretKey) {
      const secureRaw = getCachedSecureSecret(secretKey);
      if (secureRaw) {
        try {
          secureSettings = JSON.parse(secureRaw) as Partial<MQTTSettings>;
        } catch {
          // catch-no-log-ok corrupt session secret is treated as absent
        }
      }
    }
    // Older secure rows contain the entire settings object. Local preferences
    // take precedence over that snapshot; only credentials come from the service.
    const merged = {
      ...defaults,
      ...secureSettings,
      ...parsed,
      password: secureSettings.password ?? defaults.password,
      channelPsks: secureSettings.channelPsks ?? defaults.channelPsks,
    };
    return {
      ...merged,
      maxRetries: clampMqttMaxRetries(merged.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS),
    };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...defaults };
  }
}
