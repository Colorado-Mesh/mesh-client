import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';

import type { MQTTSettings } from './types';

/** Merge persisted MQTT JSON with defaults and clamp maxRetries. */
export function readMqttSettingsFromStorage(
  storageKey: string,
  defaults: MQTTSettings,
): MQTTSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<MQTTSettings>;
    const merged = { ...defaults, ...parsed };
    const r = merged.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS;
    return {
      ...merged,
      maxRetries: Math.min(MQTT_MAX_RECONNECT_ATTEMPTS, Math.max(1, r)),
    };
  } catch {
    // catch-no-log-ok corrupt localStorage JSON — fall back to defaults
    return { ...defaults };
  }
}
