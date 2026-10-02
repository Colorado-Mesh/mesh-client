import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';
import type { MQTTSettings } from './types';

/** Same storage as Meshtastic `MQTTSettings` (localStorage, password included). */
export const MQTT_PROFILES_STORAGE_KEY = 'mesh-client:mqttProfiles:meshtastic';
export const MQTT_PROFILE_NAME_MAX_LENGTH = 60;
export const MQTT_PROFILES_MAX = 50;

/** Connection fields a profile stores; `MQTTSettings` satisfies this shape. */
export interface MqttProfileFields {
  server: string;
  port: number;
  username: string;
  password: string;
  topicPrefix: string;
  tlsEnabled?: boolean;
  useWebSocket?: boolean;
  wsPath?: string;
}

/** User-saved Meshtastic MQTT broker + root topic, switchable from the network preset picker. */
export interface MqttProfile extends MqttProfileFields {
  id: string;
  name: string;
}

/** Value used for a profile entry in the network preset `<select>`. */
export function mqttProfileSelectValue(id: string): string {
  return `profile:${id}`;
}

export function mqttProfileIdFromSelectValue(value: string): string | null {
  return value.startsWith('profile:') ? value.slice('profile:'.length) : null;
}

export function normalizeMqttProfileName(name: string): string {
  return name.trim().slice(0, MQTT_PROFILE_NAME_MAX_LENGTH);
}

function isMqttProfile(v: unknown): v is MqttProfile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    typeof p.server === 'string' &&
    typeof p.port === 'number' &&
    Number.isInteger(p.port) &&
    typeof p.username === 'string' &&
    typeof p.password === 'string' &&
    typeof p.topicPrefix === 'string' &&
    (p.tlsEnabled === undefined || typeof p.tlsEnabled === 'boolean') &&
    (p.useWebSocket === undefined || typeof p.useWebSocket === 'boolean') &&
    (p.wsPath === undefined || typeof p.wsPath === 'string')
  );
}

export function loadMqttProfiles(): MqttProfile[] {
  try {
    const parsed = parseStoredJson<unknown>(
      localStorage.getItem(MQTT_PROFILES_STORAGE_KEY),
      'loadMqttProfiles',
    );
    if (Array.isArray(parsed)) return parsed.filter(isMqttProfile).slice(0, MQTT_PROFILES_MAX);
  } catch (e) {
    console.debug('[mqttProfiles] load failed ' + errLikeToLogString(e));
  }
  return [];
}

export function saveMqttProfiles(profiles: readonly MqttProfile[]): void {
  try {
    localStorage.setItem(
      MQTT_PROFILES_STORAGE_KEY,
      JSON.stringify(profiles.slice(0, MQTT_PROFILES_MAX)),
    );
  } catch (e) {
    console.debug('[mqttProfiles] save failed ' + errLikeToLogString(e));
  }
}

function pickProfileFields(src: MqttProfileFields): MqttProfileFields {
  return {
    server: src.server,
    port: src.port,
    username: src.username,
    password: src.password,
    topicPrefix: src.topicPrefix,
    tlsEnabled: src.tlsEnabled,
    useWebSocket: src.useWebSocket,
    wsPath: src.wsPath,
  };
}

/** Append a profile built from the current settings. Returns the list unchanged for a blank name. */
export function createMqttProfile(
  profiles: readonly MqttProfile[],
  name: string,
  settings: MQTTSettings,
  id: string = crypto.randomUUID(),
): MqttProfile[] {
  const clean = normalizeMqttProfileName(name);
  if (!clean || profiles.length >= MQTT_PROFILES_MAX) return [...profiles];
  return [...profiles, { id, name: clean, ...pickProfileFields(settings) }];
}

export function renameMqttProfile(
  profiles: readonly MqttProfile[],
  id: string,
  name: string,
): MqttProfile[] {
  const clean = normalizeMqttProfileName(name);
  if (!clean) return [...profiles];
  return profiles.map((p) => (p.id === id ? { ...p, name: clean } : p));
}

export function deleteMqttProfile(profiles: readonly MqttProfile[], id: string): MqttProfile[] {
  return profiles.filter((p) => p.id !== id);
}

/** Merge a profile into settings; app-only fields (auto-launch, PSKs, retries) are kept. */
export function applyMqttProfile(settings: MQTTSettings, profile: MqttProfile): MQTTSettings {
  return { ...settings, ...pickProfileFields(profile) };
}

function sameConnectionFields(a: MqttProfileFields, b: MqttProfileFields): boolean {
  return (
    a.server.trim() === b.server.trim() &&
    a.port === b.port &&
    a.username === b.username &&
    a.password === b.password &&
    (a.tlsEnabled ?? null) === (b.tlsEnabled ?? null) &&
    (a.useWebSocket ?? false) === (b.useWebSocket ?? false) &&
    (a.wsPath ?? '') === (b.wsPath ?? '')
  );
}

/** The saved profile whose fields equal the current settings, if any. */
export function matchMqttProfile(
  profiles: readonly MqttProfile[],
  settings: MQTTSettings,
): MqttProfile | undefined {
  return profiles.find(
    (p) =>
      sameConnectionFields(settings, p) && settings.topicPrefix.trim() === p.topicPrefix.trim(),
  );
}

/**
 * What a live MQTT session needs after switching settings: nothing, a topic re-subscribe
 * (`mqtt.updateTopicPrefix`), or a reconnect (broker, credentials, or transport changed).
 */
export function mqttProfileApplyEffect(
  prev: MQTTSettings,
  next: MQTTSettings,
): 'none' | 'topicPrefix' | 'reconnect' {
  if (!sameConnectionFields(prev, next)) return 'reconnect';
  if (prev.topicPrefix.trim() !== next.topicPrefix.trim()) return 'topicPrefix';
  return 'none';
}
