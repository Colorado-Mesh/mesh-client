import {
  MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
} from '@/shared/appSettingsKeyPrefixes';

import { APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';

export const MESHCORE_IDENTITY_SECRET_KEY = 'meshcore:identity';
export const MESHCORE_MQTT_SECRET_KEY = 'mqtt:meshcore';
export const MESHTASTIC_MQTT_SECRET_KEY = 'mqtt:meshtastic';
export const MQTT_PROFILES_SECRET_KEY = 'mqtt:profiles';

const LEGACY_MESHCORE_IDENTITY_KEY = 'mesh-client:meshcoreIdentity';
const LEGACY_MESHCORE_IDENTITY_CIPHERTEXT_KEY = 'mesh-client:meshcoreIdentityEncPK';
const LEGACY_MESHCORE_MQTT_KEY = 'mesh-client:mqttSettings:meshcore';
const LEGACY_MESHTASTIC_MQTT_KEY = 'mesh-client:mqttSettings';
const LEGACY_MQTT_PROFILES_KEY = 'mesh-client:mqttProfiles:meshtastic';
const LEGACY_MESHCORE_BACKUP_PREFIX = 'mesh-client:meshcore-key-backup:';
const LEGACY_MESHTASTIC_BACKUP_PREFIX = 'mesh-client:meshtastic-dm-key-backup:';

const cache = new Map<string, string>();
let persistentStorageAvailable = false;
let initialized = false;

export function meshcoreRepeaterSecretKey(nodeId: number): string {
  return `meshcore:repeater:${String(nodeId >>> 0)}`;
}

export function meshcoreRoomSecretKey(nodeId: number): string {
  return `meshcore:room:${String(nodeId >>> 0)}`;
}

export function keyBackupSecretKey(protocol: 'meshcore' | 'meshtastic', id: number): string {
  return `backup:${protocol}:${String(id >>> 0)}`;
}

export function keyBackupIndexSecretKey(protocol: 'meshcore' | 'meshtastic'): string {
  return `backup-index:${protocol}`;
}

export function getCachedSecureSecret(key: string): string | null {
  return cache.get(key) ?? null;
}

export function listCachedSecureSecretKeys(prefix = ''): string[] {
  return [...cache.keys()].filter((key) => key.startsWith(prefix)).sort();
}

export function isPersistentSecureStorageAvailable(): boolean {
  return persistentStorageAvailable;
}

export function secureSecretsInitialized(): boolean {
  return initialized;
}

export async function setSecureSecret(
  key: string,
  value: string,
): Promise<{ persistent: boolean }> {
  const previous = cache.get(key);
  cache.set(key, value);
  try {
    const result = await window.electronAPI.secureSecrets.set(key, value);
    if (!result.verified) throw new Error('secure secret verification failed');
    persistentStorageAvailable = result.persistent;
    return { persistent: result.persistent };
  } catch (error) {
    if (previous == null) cache.delete(key);
    else cache.set(key, previous);
    throw error;
  }
}

export async function removeSecureSecret(key: string): Promise<void> {
  const previous = cache.get(key);
  cache.delete(key);
  try {
    await window.electronAPI.secureSecrets.remove(key);
  } catch (error) {
    if (previous != null) cache.set(key, previous);
    throw error;
  }
}

async function hydrateExistingSecrets(): Promise<void> {
  cache.clear();
  const values = await window.electronAPI.secureSecrets.getAll();
  for (const [key, value] of Object.entries(values)) {
    cache.set(key, value);
  }
}

/** Legacy sources must survive until their replacement is confidential and durable. */
async function persistMigratedSecret(key: string, value: string): Promise<void> {
  const result = await setSecureSecret(key, value);
  if (!result.persistent) {
    throw new Error(
      'secure secret migration: configure an OS keyring before migrating saved secrets',
    );
  }
}

async function migrateLegacyIdentityCiphertext(localStorageKey: string): Promise<boolean> {
  const ciphertext = localStorage.getItem(localStorageKey);
  if (!ciphertext) return false;
  if (persistentStorageAvailable && cache.has(MESHCORE_IDENTITY_SECRET_KEY)) {
    localStorage.removeItem(localStorageKey);
    return true;
  }
  const result = await window.electronAPI.secureSecrets.migrateLegacyIdentityCiphertext(ciphertext);
  if (!result.verified || !result.persistent) {
    throw new Error('secure secret migration: legacy identity requires persistent secure storage');
  }
  const value = await window.electronAPI.secureSecrets.get(MESHCORE_IDENTITY_SECRET_KEY);
  if (value == null) return false;
  cache.set(MESHCORE_IDENTITY_SECRET_KEY, value);
  localStorage.removeItem(localStorageKey);
  persistentStorageAvailable = result.persistent;
  return true;
}

export async function migrateLegacyBackupCiphertext(
  protocol: 'meshcore' | 'meshtastic',
  id: number,
  format: 'per-node' | 'meshtastic-single',
  ciphertext: string,
): Promise<boolean> {
  const key = keyBackupSecretKey(protocol, id);
  const result = await window.electronAPI.secureSecrets.migrateLegacyBackupCiphertext(
    protocol,
    id,
    format,
    ciphertext,
  );
  if (!result.verified || !result.persistent) return false;
  const value = await window.electronAPI.secureSecrets.get(key);
  if (value == null) return false;
  cache.set(key, value);
  persistentStorageAvailable = result.persistent;
  return true;
}

async function migrateMeshcoreIdentity(): Promise<void> {
  const encryptedMigrated = await migrateLegacyIdentityCiphertext(
    LEGACY_MESHCORE_IDENTITY_CIPHERTEXT_KEY,
  );

  const raw = localStorage.getItem(LEGACY_MESHCORE_IDENTITY_KEY);
  if (!raw) return;
  let parsed: { public_key?: unknown; private_key?: unknown };
  try {
    const candidate = JSON.parse(raw) as unknown;
    if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('invalid legacy identity');
    }
    parsed = candidate;
  } catch {
    throw new Error('secure secret migration: malformed legacy MeshCore identity');
  }
  if (!encryptedMigrated && parsed.private_key != null) {
    const privateKey = parsed.private_key;
    const validArray =
      Array.isArray(privateKey) &&
      (privateKey.length === 32 || privateKey.length === 64) &&
      privateKey.every(
        (byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 0xff,
      );
    const validHex =
      typeof privateKey === 'string' &&
      /^(?:0x)?(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/.test(privateKey);
    if (!validArray && !validHex) {
      throw new Error('secure secret migration: invalid legacy MeshCore private key');
    }
    await persistMigratedSecret(MESHCORE_IDENTITY_SECRET_KEY, JSON.stringify(parsed.private_key));
  }
  if (parsed.private_key != null) {
    const next =
      parsed.public_key == null ? null : JSON.stringify({ public_key: parsed.public_key });
    if (next == null) localStorage.removeItem(LEGACY_MESHCORE_IDENTITY_KEY);
    else localStorage.setItem(LEGACY_MESHCORE_IDENTITY_KEY, next);
  }
}

interface LegacyMqttSecrets {
  password?: string;
  channelPsks?: string[];
}

function parseLegacyRecord(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`secure secret migration: malformed ${label}`);
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`secure secret migration: malformed ${label}`);
  }
  return parsed as Record<string, unknown>;
}

function routeLegacyMqttSettingsByProtocol(): void {
  const raw = localStorage.getItem(LEGACY_MESHTASTIC_MQTT_KEY);
  if (!raw) return;
  const parsed = parseLegacyRecord(raw, 'legacy MQTT settings');
  if (
    typeof parsed.topicPrefix === 'string' &&
    parsed.topicPrefix.startsWith('meshcore') &&
    localStorage.getItem(LEGACY_MESHCORE_MQTT_KEY) == null
  ) {
    localStorage.setItem(LEGACY_MESHCORE_MQTT_KEY, raw);
    localStorage.removeItem(LEGACY_MESHTASTIC_MQTT_KEY);
  }
}

async function migrateMqttSettings(storageKey: string, secretKey: string): Promise<void> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  const parsed = parseLegacyRecord(raw, 'legacy MQTT settings');
  const ownsPassword = Object.prototype.hasOwnProperty.call(parsed, 'password');
  const ownsPsks = Object.prototype.hasOwnProperty.call(parsed, 'channelPsks');
  if (!ownsPassword && !ownsPsks) return;

  const secrets: LegacyMqttSecrets = {};
  if (ownsPassword) {
    if (typeof parsed.password !== 'string') {
      throw new Error('secure secret migration: invalid legacy MQTT password');
    }
    secrets.password = parsed.password;
  }
  if (ownsPsks) {
    if (
      !Array.isArray(parsed.channelPsks) ||
      parsed.channelPsks.some((value) => typeof value !== 'string')
    ) {
      throw new Error('secure secret migration: invalid legacy MQTT channel keys');
    }
    secrets.channelPsks = parsed.channelPsks;
  }
  if (Object.keys(secrets).length > 0) {
    let existing: LegacyMqttSecrets = {};
    const secureRaw = getCachedSecureSecret(secretKey);
    if (secureRaw) {
      try {
        existing = JSON.parse(secureRaw) as LegacyMqttSecrets;
      } catch {
        throw new Error('secure secret migration: malformed encrypted MQTT settings');
      }
    }
    await persistMigratedSecret(secretKey, JSON.stringify({ ...secrets, ...existing }));
  }
  delete parsed.password;
  delete parsed.channelPsks;
  localStorage.setItem(storageKey, JSON.stringify(parsed));
}

async function migrateMqttProfiles(): Promise<void> {
  const raw = localStorage.getItem(LEGACY_MQTT_PROFILES_KEY);
  if (!raw) return;
  let profiles: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (profile) => profile == null || typeof profile !== 'object' || Array.isArray(profile),
      )
    ) {
      throw new Error('invalid legacy MQTT profiles');
    }
    profiles = parsed as Record<string, unknown>[];
  } catch {
    throw new Error('secure secret migration: malformed legacy MQTT profiles');
  }

  const passwords: Record<string, string> = {};
  const changed = profiles.some((profile) => Object.hasOwn(profile, 'password'));
  const scrubbed = profiles.map((profile) => {
    const next = { ...profile };
    if (Object.hasOwn(profile, 'password')) {
      if (typeof profile.id !== 'string' || typeof profile.password !== 'string') {
        throw new Error('secure secret migration: invalid legacy MQTT profile password');
      }
      passwords[profile.id] = profile.password;
      delete next.password;
    }
    return next;
  });
  if (!changed) return;
  let existing: Record<string, string> = {};
  const secureRaw = getCachedSecureSecret(MQTT_PROFILES_SECRET_KEY);
  if (secureRaw) {
    try {
      existing = JSON.parse(secureRaw) as Record<string, string>;
    } catch {
      throw new Error('secure secret migration: malformed encrypted MQTT profiles');
    }
  }
  await persistMigratedSecret(
    MQTT_PROFILES_SECRET_KEY,
    JSON.stringify({ ...passwords, ...existing }),
  );
  localStorage.setItem(LEGACY_MQTT_PROFILES_KEY, JSON.stringify(scrubbed));
}

function credentialSecretKey(settingKey: string): string | null {
  if (settingKey.startsWith(MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX)) {
    const id = Number(settingKey.slice(MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX.length));
    return Number.isFinite(id) && id >= 0 ? meshcoreRepeaterSecretKey(id) : null;
  }
  if (settingKey.startsWith(MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX)) {
    const id = Number(settingKey.slice(MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX.length));
    return Number.isFinite(id) && id >= 0 ? meshcoreRoomSecretKey(id) : null;
  }
  return null;
}

async function migrateCredentialRecord(
  settingKey: string,
  raw: unknown,
  preserveCurrent = false,
): Promise<boolean> {
  const secretKey = credentialSecretKey(settingKey);
  if (!secretKey) return false;
  if (typeof raw !== 'string') {
    throw new Error('secure secret migration: malformed legacy MeshCore credential');
  }
  if (raw.length === 0) return false;
  if (preserveCurrent && persistentStorageAvailable && cache.has(secretKey)) return true;
  await persistMigratedSecret(secretKey, raw);
  return getCachedSecureSecret(secretKey) === raw;
}

async function migrateCredentialSettings(): Promise<void> {
  for (const storageKey of [APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY]) {
    const localRaw = localStorage.getItem(storageKey);
    if (!localRaw) continue;
    const local = parseLegacyRecord(localRaw, 'legacy app settings');
    let changed = false;
    for (const [key, value] of Object.entries(local)) {
      if (
        await migrateCredentialRecord(key, value, storageKey === LEGACY_APP_SETTINGS_STORAGE_KEY)
      ) {
        Reflect.deleteProperty(local, key);
        changed = true;
      }
    }
    if (changed) localStorage.setItem(storageKey, JSON.stringify(local));
  }

  const persisted = await window.electronAPI.appSettings.getAll();
  for (const [key, value] of Object.entries(persisted)) {
    if (await migrateCredentialRecord(key, value)) {
      await window.electronAPI.appSettings.remove(key);
    }
  }
}

async function migrateBackupSlots(
  prefix: string,
  protocol: 'meshcore' | 'meshtastic',
): Promise<void> {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const storageKey of keys) {
    const id = Number(storageKey.slice(prefix.length));
    if (!Number.isFinite(id) || id < 0) continue;
    const ciphertext = localStorage.getItem(storageKey);
    if (!ciphertext) continue;
    const migrated = await migrateLegacyBackupCiphertext(protocol, id, 'per-node', ciphertext);
    if (!migrated) {
      throw new Error('secure secret migration: legacy backup verification failed');
    }
    localStorage.removeItem(storageKey);
  }
}

/** Hydrate and erase all known legacy renderer/SQLite secret copies before React mounts. */
export async function initializeSecureSecrets(): Promise<void> {
  const status = await window.electronAPI.secureSecrets.status();
  persistentStorageAvailable = status.persistent;
  await hydrateExistingSecrets();
  await migrateMeshcoreIdentity();
  routeLegacyMqttSettingsByProtocol();
  await migrateMqttSettings(LEGACY_MESHCORE_MQTT_KEY, MESHCORE_MQTT_SECRET_KEY);
  await migrateMqttSettings(LEGACY_MESHTASTIC_MQTT_KEY, MESHTASTIC_MQTT_SECRET_KEY);
  await migrateMqttProfiles();
  await migrateCredentialSettings();
  await migrateBackupSlots(LEGACY_MESHCORE_BACKUP_PREFIX, 'meshcore');
  await migrateBackupSlots(LEGACY_MESHTASTIC_BACKUP_PREFIX, 'meshtastic');
  initialized = true;
}

export async function initializeSecureSecretsFailClosed(): Promise<void> {
  try {
    await initializeSecureSecrets();
  } catch (error) {
    console.warn('[secureSecretStorage] initialization failed ' + errLikeToLogString(error));
    throw error;
  }
}

/** Test-only reset for module cache isolation. */
export function resetSecureSecretCacheForTests(): void {
  cache.clear();
  persistentStorageAvailable = false;
  initialized = false;
}
