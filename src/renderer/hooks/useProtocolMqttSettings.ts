import { useCallback, useEffect, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { readMeshcoreMqttSettingsFromStorage } from '@/renderer/lib/meshcoreMqttSettingsStorage';
import {
  MESHTASTIC_MQTT_SETTINGS_KEY,
  readMeshtasticMqttSettingsFromStorage,
} from '@/renderer/lib/meshtasticMqttSettingsStorage';
import {
  MESHCORE_MQTT_SECRET_KEY,
  MESHTASTIC_MQTT_SECRET_KEY,
  setSecureSecret,
} from '@/renderer/lib/secureSecretStorage';
import type { MeshProtocol, MQTTSettings } from '@/renderer/lib/types';

const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';
export const MQTT_SETTINGS_PERSIST_DEBOUNCE_MS = 100;

export function getMqttSettingsStorageKey(protocol: MeshProtocol): string {
  return protocol === 'meshcore' ? MESHCORE_MQTT_SETTINGS_KEY : MESHTASTIC_MQTT_SETTINGS_KEY;
}

export function loadProtocolMqttSettings(protocol: MeshProtocol): MQTTSettings {
  return protocol === 'meshcore'
    ? readMeshcoreMqttSettingsFromStorage()
    : readMeshtasticMqttSettingsFromStorage();
}

export function persistMqttSettingsIfChanged(key: string, settings: MQTTSettings): void {
  const { password, channelPsks, ...metadata } = settings;
  const serialized = JSON.stringify(metadata);
  if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);

  const secretKey =
    key === MESHCORE_MQTT_SETTINGS_KEY ? MESHCORE_MQTT_SECRET_KEY : MESHTASTIC_MQTT_SECRET_KEY;
  const secrets = {
    password,
    ...(channelPsks?.length ? { channelPsks } : {}),
  };
  const pending = setSecureSecret(secretKey, JSON.stringify(secrets));
  void pending.catch((error: unknown) => {
    console.warn('[useProtocolMqttSettings] secure persist failed ' + errLikeToLogString(error));
  });
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

/** Shared MQTT settings load/persist for ConnectionPanel (Meshtastic + MeshCore). */
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
      flushPendingMqttSave(persistTimerRef, storageKey, settingsRef.current);
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
