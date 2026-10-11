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
const COMPATIBILITY_CREDENTIAL_PREFIX = 'mesh-client:credentialCompatibility:';

function compatibilityCredentialKey(key: string): boolean {
  return /^(?:meshcore:identity|mqtt:(?:meshcore|meshtastic|profiles)|meshcore:(?:room|repeater):\d{1,10})$/.test(
    key,
  );
}

function readCompatibilityCredentials(): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(COMPATIBILITY_CREDENTIAL_PREFIX)) continue;
    const key = storageKey.slice(COMPATIBILITY_CREDENTIAL_PREFIX.length);
    if (!compatibilityCredentialKey(key))
      throw new Error('secure secret migration: invalid compatibility key');
    const raw = localStorage.getItem(storageKey);
    try {
      const value: unknown = JSON.parse(raw ?? '');
      if (value !== null && typeof value !== 'string') throw new Error('invalid credential');
      values[key] = value;
    } catch {
      throw new Error('secure secret migration: invalid compatibility credential');
    }
  }
  return values;
}

function writeCompatibilityCredential(key: string, value: string | null): void {
  const storageKey = `${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`;
  const serialized = JSON.stringify(value);
  localStorage.setItem(storageKey, serialized);
  if (localStorage.getItem(storageKey) !== serialized) {
    throw new Error('credential compatibility storage verification failed');
  }
}

function clearCompatibilityCredential(key: string): void {
  localStorage.removeItem(`${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`);
}

async function clearLegacyCredentialCopies(key: string): Promise<void> {
  const node = /^meshcore:(room|repeater):(\d+)$/.exec(key);
  if (node) {
    const settingKey = `${node[1] === 'room' ? MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX : MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX}${node[2]}`;
    for (const storageKey of [APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY]) {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const settings = parseLegacyRecord(raw, 'legacy app settings');
      if (Object.hasOwn(settings, settingKey)) {
        Reflect.deleteProperty(settings, settingKey);
        localStorage.setItem(storageKey, JSON.stringify(settings));
      }
    }
    await window.electronAPI.appSettings.remove(settingKey);
  }
  if (key === MESHCORE_IDENTITY_SECRET_KEY) {
    const raw = localStorage.getItem(LEGACY_MESHCORE_IDENTITY_KEY);
    if (raw) {
      const identity = parseLegacyRecord(raw, 'legacy MeshCore identity');
      Reflect.deleteProperty(identity, 'private_key');
      localStorage.setItem(LEGACY_MESHCORE_IDENTITY_KEY, JSON.stringify(identity));
    }
    localStorage.removeItem(LEGACY_MESHCORE_IDENTITY_CIPHERTEXT_KEY);
  }
}

const cache = new Map<string, string>();
const protectedKeys = new Set<string>();
const deletedCredentials = new Set<string>();
let persistentStorageAvailable = false;
let storageStatusKnown = false;
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

export function isProtectedSecureSecretUnavailable(key: string): boolean {
  return !persistentStorageAvailable && protectedKeys.has(key) && !cache.has(key);
}

export async function setSecureSecret(
  key: string,
  value: string,
  requirePersistent = false,
): Promise<{ persistent: boolean }> {
  const previous = cache.get(key);
  cache.set(key, value);
  try {
    const result = requirePersistent
      ? await window.electronAPI.secureSecrets.set(key, value, true)
      : await window.electronAPI.secureSecrets.set(key, value);
    if (!result.verified) throw new Error('secure secret verification failed');
    if (requirePersistent && !result.persistent) {
      throw new Error('secureSecrets: OS key storage unavailable');
    }
    persistentStorageAvailable = result.persistent;
    if (compatibilityCredentialKey(key)) {
      // Accepted local-profile disclosure risk: remembering credentials must not
      // require keyring setup. Prefer OS encryption; when unavailable, retain a
      // local compatibility copy, then remove it after verified durable encryption.
      // Key backups are excluded: their success contract requires OS-backed durability.
      if (result.persistent) clearCompatibilityCredential(key);
      else writeCompatibilityCredential(key, value);
    }
    deletedCredentials.delete(key);
    protectedKeys.delete(key);
    return { persistent: result.persistent };
  } catch (error) {
    if (previous == null) cache.delete(key);
    else cache.set(key, previous);
    throw error;
  }
}

export async function removeSecureSecret(key: string): Promise<void> {
  const previous = cache.get(key);
  const compatibility = compatibilityCredentialKey(key);
  const priorCompatibility = compatibility
    ? localStorage.getItem(`${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`)
    : null;
  // A tombstone prevents retained legacy plaintext from restoring a credential
  // the user explicitly forgot while the keyring was unavailable.
  if (compatibility) writeCompatibilityCredential(key, null);
  try {
    await window.electronAPI.secureSecrets.remove(key);
  } catch (error) {
    if (compatibility) {
      const storageKey = `${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`;
      if (priorCompatibility == null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, priorCompatibility);
    }
    if (previous != null) cache.set(key, previous);
    throw error;
  }
  cache.delete(key);
  protectedKeys.delete(key);
  if (compatibility) deletedCredentials.add(key);
  await clearLegacyCredentialCopies(key);
}

async function hydrateExistingSecrets(): Promise<void> {
  cache.clear();
  protectedKeys.clear();
  deletedCredentials.clear();
  if (!persistentStorageAvailable) {
    for (const key of await window.electronAPI.secureSecrets.list()) protectedKeys.add(key);
  }
  const values = await window.electronAPI.secureSecrets.getAll();
  for (const [key, value] of Object.entries(values)) {
    cache.set(key, value);
  }
  for (const [key, value] of Object.entries(readCompatibilityCredentials())) {
    if (value === null) {
      cache.delete(key);
      deletedCredentials.add(key);
      continue;
    }
    // A compatibility copy may contain a newer user edit than an older protected
    // row retained during a keyring outage.
    if (!persistentStorageAvailable) cache.set(key, value);
    else if (cache.get(key) === value) clearCompatibilityCredential(key);
    else await setSecureSecret(key, value);
  }
}

/** Legacy sources must survive until their replacement is confidential and durable. */
async function persistMigratedSecret(key: string, value: string): Promise<boolean> {
  // Compatibility by design: an unavailable keyring must not block the app.
  // Use session secrets and retain legacy copies until confidential, durable
  // migration is possible. Their existing local-disclosure risk is accepted
  // to avoid requiring new setup just to open an upgraded installation.
  if (!persistentStorageAvailable && compatibilityCredentialKey(key)) {
    if (protectedKeys.has(key) || deletedCredentials.has(key)) return false;
    writeCompatibilityCredential(key, value);
    cache.set(key, value);
    return false;
  }
  const result = await setSecureSecret(key, value);
  return result.persistent;
}

async function migrateLegacyIdentityCiphertext(localStorageKey: string): Promise<boolean> {
  if (deletedCredentials.has(MESHCORE_IDENTITY_SECRET_KEY)) return false;
  const ciphertext = localStorage.getItem(localStorageKey);
  if (!ciphertext) return false;
  // Keep encrypted legacy data for a later keyring-backed start. There is no
  // plaintext to import during an outage, and unrelated app use can continue.
  if (!persistentStorageAvailable) return false;
  if (cache.has(MESHCORE_IDENTITY_SECRET_KEY)) {
    localStorage.removeItem(localStorageKey);
    return true;
  }
  const result = await window.electronAPI.secureSecrets.migrateLegacyIdentityCiphertext(ciphertext);
  if (!result.verified)
    throw new Error('secure secret migration: legacy identity verification failed');
  const value = await window.electronAPI.secureSecrets.get(MESHCORE_IDENTITY_SECRET_KEY);
  if (value == null) return false;
  cache.set(MESHCORE_IDENTITY_SECRET_KEY, value);
  if (result.persistent) localStorage.removeItem(localStorageKey);
  persistentStorageAvailable = result.persistent;
  return true;
}

export async function migrateLegacyBackupCiphertext(
  protocol: 'meshcore' | 'meshtastic',
  id: number,
  format: 'per-node' | 'meshtastic-single',
  ciphertext: string,
): Promise<boolean> {
  if (!storageStatusKnown) {
    const status = await window.electronAPI.secureSecrets.status();
    persistentStorageAvailable = status.persistent;
    storageStatusKnown = true;
  }
  if (!persistentStorageAvailable) return false;
  const key = keyBackupSecretKey(protocol, id);
  const result = await window.electronAPI.secureSecrets.migrateLegacyBackupCiphertext(
    protocol,
    id,
    format,
    ciphertext,
  );
  persistentStorageAvailable = result.persistent;
  if (!result.verified) return false;
  const value = await window.electronAPI.secureSecrets.get(key);
  if (value == null) return false;
  cache.set(key, value);
  persistentStorageAvailable = result.persistent;
  return result.persistent;
}

async function migrateMeshcoreIdentity(): Promise<void> {
  if (deletedCredentials.has(MESHCORE_IDENTITY_SECRET_KEY)) return;
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
  if (
    !encryptedMigrated &&
    !cache.has(MESHCORE_IDENTITY_SECRET_KEY) &&
    parsed.private_key != null
  ) {
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
  if (persistentStorageAvailable && parsed.private_key != null) {
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
  if (deletedCredentials.has(secretKey)) return;
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
    if (!(await persistMigratedSecret(secretKey, JSON.stringify({ ...secrets, ...existing }))))
      return;
  }
  delete parsed.password;
  delete parsed.channelPsks;
  localStorage.setItem(storageKey, JSON.stringify(parsed));
}

async function migrateMqttProfiles(): Promise<void> {
  if (deletedCredentials.has(MQTT_PROFILES_SECRET_KEY)) return;
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
  const persistent = await persistMigratedSecret(
    MQTT_PROFILES_SECRET_KEY,
    JSON.stringify({ ...passwords, ...existing }),
  );
  if (!persistent) return;
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
  if (deletedCredentials.has(secretKey)) return false;
  if (typeof raw !== 'string') {
    throw new Error('secure secret migration: malformed legacy MeshCore credential');
  }
  if (raw.length === 0) return false;
  if (preserveCurrent && cache.has(secretKey)) return persistentStorageAvailable;
  const persistent = await persistMigratedSecret(secretKey, raw);
  return persistent && getCachedSecureSecret(secretKey) === raw;
}

async function migrateCredentialSettings(): Promise<void> {
  for (const storageKey of [APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY]) {
    const localRaw = localStorage.getItem(storageKey);
    if (!localRaw) continue;
    const local = parseLegacyRecord(localRaw, 'legacy app settings');
    for (const [key, value] of Object.entries(local)) {
      if (await migrateCredentialRecord(key, value, true)) {
        Reflect.deleteProperty(local, key);
        // Commit each verified migration so a rate limit or crash resumes at the
        // next credential rather than replaying the same successful prefix.
        localStorage.setItem(storageKey, JSON.stringify(local));
      }
    }
  }

  const persisted = await window.electronAPI.appSettings.getAll();
  for (const [key, value] of Object.entries(persisted)) {
    if (await migrateCredentialRecord(key, value, true)) {
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
      if (!persistentStorageAvailable) continue;
      throw new Error('secure secret migration: legacy backup verification failed');
    }
    localStorage.removeItem(storageKey);
  }
}

/** Hydrate credentials before React mounts; erase legacy copies after durable encryption. */
export async function initializeSecureSecrets(): Promise<void> {
  const status = await window.electronAPI.secureSecrets.status();
  persistentStorageAvailable = status.persistent;
  storageStatusKnown = true;
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
  protectedKeys.clear();
  deletedCredentials.clear();
  persistentStorageAvailable = false;
  storageStatusKnown = false;
  initialized = false;
}
