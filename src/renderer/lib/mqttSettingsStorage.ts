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
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<MQTTSettings>;
    let secrets: Partial<MQTTSettings> = {};
    if (secretKey) {
      const secureRaw = getCachedSecureSecret(secretKey);
      if (secureRaw) {
        try {
          const secureParsed = JSON.parse(secureRaw) as {
            password?: unknown;
            channelPsks?: unknown;
          };
          secrets = {
            ...(typeof secureParsed.password === 'string'
              ? { password: secureParsed.password }
              : {}),
            ...(Array.isArray(secureParsed.channelPsks) &&
            secureParsed.channelPsks.every((value) => typeof value === 'string')
              ? { channelPsks: secureParsed.channelPsks }
              : {}),
          };
        } catch {
          // catch-no-log-ok corrupt session secret is treated as absent
        }
      }
    }
    const merged = { ...defaults, ...parsed, ...secrets };
    return {
      ...merged,
      maxRetries: clampMqttMaxRetries(merged.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS),
    };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...defaults };
  }
}
