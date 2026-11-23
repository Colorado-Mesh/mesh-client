import { useCallback, useEffect, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MESHCOM_MQTT_SETTINGS_KEY,
  readMeshcomMqttSettingsFromStorage,
} from '@/renderer/lib/meshcomMqttSettingsStorage';
import { readMeshcoreMqttSettingsFromStorage } from '@/renderer/lib/meshcoreMqttSettingsStorage';
import {
  MESHTASTIC_MQTT_SETTINGS_KEY,
  readMeshtasticMqttSettingsFromStorage,
} from '@/renderer/lib/meshtasticMqttSettingsStorage';
import {
  getCachedSecureSecret,
  isProtectedSecureSecretUnavailable,
  MESHCOM_MQTT_SECRET_KEY,
  MESHCORE_MQTT_SECRET_KEY,
  MESHTASTIC_MQTT_SECRET_KEY,
  setSecureSecret,
} from '@/renderer/lib/secureSecretStorage';
import type { MeshProtocol, MQTTSettings } from '@/renderer/lib/types';

const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
export const MQTT_SETTINGS_PERSIST_DEBOUNCE_MS = 100;
const pendingMqttSecretWrites = new Map<string, Promise<void>>();

function mqttSecretKeyForStorageKey(key: string): string {
  if (key === MESHCORE_MQTT_SETTINGS_KEY) return MESHCORE_MQTT_SECRET_KEY;
  if (key === MESHCOM_MQTT_SETTINGS_KEY) return MESHCOM_MQTT_SECRET_KEY;
  return MESHTASTIC_MQTT_SECRET_KEY;
}

function protocolForMqttSecretKey(secretKey: string): MeshProtocol {
  if (secretKey === MESHCORE_MQTT_SECRET_KEY) return 'meshcore';
  if (secretKey === MESHCOM_MQTT_SECRET_KEY) return 'meshcom';
  return 'meshtastic';
}

export function getMqttSettingsStorageKey(protocol: MeshProtocol): string {
  if (protocol === 'meshcore') return MESHCORE_MQTT_SETTINGS_KEY;
  if (protocol === 'meshcom') return MESHCOM_MQTT_SETTINGS_KEY;
  return MESHTASTIC_MQTT_SETTINGS_KEY;
}

export function loadProtocolMqttSettings(protocol: MeshProtocol): MQTTSettings {
  if (protocol === 'meshcore') return readMeshcoreMqttSettingsFromStorage();
  if (protocol === 'meshcom') return readMeshcomMqttSettingsFromStorage();
  return readMeshtasticMqttSettingsFromStorage();
}

export function persistMqttSettingsIfChanged(key: string, settings: MQTTSettings): void {
  const secretKey = mqttSecretKeyForStorageKey(key);
  const { password, channelPsks, ...preferences } = settings;
  const serialized = JSON.stringify({ password, channelPsks });
  if (isProtectedSecureSecretUnavailable(secretKey)) {
    const loaded = loadProtocolMqttSettings(protocolForMqttSecretKey(secretKey));
    if (
      password === loaded.password &&
      JSON.stringify(channelPsks) === JSON.stringify(loaded.channelPsks)
    ) {
      // Changing broker preferences must not replace an unreadable protected
      // credential with a default plaintext copy during a keyring outage.
      localStorage.setItem(key, JSON.stringify(preferences));
      return;
    }
  }
  // Broker preferences are intentionally durable without a keyring. Passwords and
  // channel keys use OS encryption when available and the documented local
  // compatibility copy during keyring outages.
  const persistPreferences = () => {
    localStorage.setItem(key, JSON.stringify(preferences));
  };
  const previous = pendingMqttSecretWrites.get(secretKey);
  if (!previous && getCachedSecureSecret(secretKey) === serialized) {
    persistPreferences();
    return;
  }
  const operation = previous
    ? previous
        .catch(() => undefined)
        .then(async () => {
          if (getCachedSecureSecret(secretKey) !== serialized) {
            await setSecureSecret(secretKey, serialized);
          }
          persistPreferences();
        })
    : setSecureSecret(secretKey, serialized).then(() => {
        persistPreferences();
      });
  const tracked = operation
    .catch((error: unknown) => {
      console.warn(
        'mcL0761 [useProtocolMqttSettings] secure persist failed ' + errLikeToLogString(error),
      );
    })
    .finally(() => {
      if (pendingMqttSecretWrites.get(secretKey) === tracked) {
        pendingMqttSecretWrites.delete(secretKey);
      }
    });
  pendingMqttSecretWrites.set(secretKey, tracked);
}

export function flushPendingMqttSave(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  key: string,
  settings: MQTTSettings,
): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  persistMqttSettingsIfChanged(key, settings);
}

/** Shared MQTT settings load/persist for ConnectionPanel (Meshtastic + MeshCore + MeshCom). */
export function useProtocolMqttSettings(protocol: MeshProtocol) {
  const storageKey = getMqttSettingsStorageKey(protocol);
  const [settings, setSettings] = useState<MQTTSettings>(() => loadProtocolMqttSettings(protocol));
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        flushPendingMqttSave(persistTimerRef, storageKey, settingsRef.current);
      }
    };
  }, [storageKey]);

  const persistNow = useCallback(() => {
    flushPendingMqttSave(persistTimerRef, storageKey, settingsRef.current);
  }, [storageKey]);

  const updateSettings = useCallback(
    (updater: MQTTSettings | ((prev: MQTTSettings) => MQTTSettings)) => {
      setSettings((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
        persistTimerRef.current = setTimeout(() => {
          persistMqttSettingsIfChanged(storageKey, next);
          persistTimerRef.current = null;
        }, MQTT_SETTINGS_PERSIST_DEBOUNCE_MS);
        return next;
      });
    },
    [storageKey],
  );

  return { settings, setSettings: updateSettings, persistNow, storageKey };
}
