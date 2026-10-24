import {
  MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
} from '@/shared/appSettingsKeyPrefixes';
import { RENDERER_STORAGE_DELETION_SETTING_PREFIX } from '@/shared/rendererOrigin';
import {
  parseRendererStorageDeletionState,
  rendererStorageIntentOrigin,
} from '@/shared/rendererStorageIntent';

import { APP_SETTINGS_STORAGE_KEY, LEGACY_APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import { errLikeToLogString } from './errLikeToLogString';
import {
  commitRendererStorageItem,
  flushRendererStorageDeletions,
  removeRendererStorageItem,
  resetRendererStorageForTests,
  setRendererStorageItem,
} from './rendererStorage';

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

interface CompatibilityCredential {
  value: string | null;
  id?: string;
  origin?: string;
}

function readCompatibilityCredentials(): Record<string, CompatibilityCredential> {
  const values: Record<string, CompatibilityCredential> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(COMPATIBILITY_CREDENTIAL_PREFIX)) continue;
    const key = storageKey.slice(COMPATIBILITY_CREDENTIAL_PREFIX.length);
    if (!compatibilityCredentialKey(key))
      throw new Error('secure secret migration: invalid compatibility key');
    const raw = localStorage.getItem(storageKey);
    try {
      const value: unknown = JSON.parse(raw ?? '');
      if (value === null || typeof value === 'string') values[key] = { value };
      else if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'value' in value &&
        (value.value === null || typeof value.value === 'string') &&
        'id' in value &&
        typeof value.id === 'string' &&
        'origin' in value &&
        typeof value.origin === 'string'
      ) {
        values[key] = { value: value.value, id: value.id, origin: value.origin };
      } else throw new Error('invalid credential');
    } catch {
      throw new Error('secure secret migration: invalid compatibility credential');
    }
  }
  return values;
}

async function writeCompatibilityCredential(key: string, value: string | null): Promise<void> {
  const storageKey = `${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`;
  const id = crypto.randomUUID();
  const settings = await window.electronAPI.appSettings.getAll();
  const { secretRevision } = parseRendererStorageDeletionState(
    settings[`${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${storageKey}`],
  );
  const serialized = JSON.stringify({
    value,
    id,
    origin: rendererStorageIntentOrigin(window.location.href),
  });
  setRendererStorageItem(storageKey, serialized, id, secretRevision);
  if (localStorage.getItem(storageKey) !== serialized) {
    throw new Error('credential compatibility storage verification failed');
  }
  await commitRendererStorageItem(storageKey);
}

async function clearCompatibilityCredential(key: string): Promise<void> {
  const storageKey = `${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`;
  removeRendererStorageItem(storageKey);
  await commitRendererStorageItem(storageKey);
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
  const mqttKey =
    key === MESHCORE_MQTT_SECRET_KEY
      ? LEGACY_MESHCORE_MQTT_KEY
      : key === MESHTASTIC_MQTT_SECRET_KEY
        ? LEGACY_MESHTASTIC_MQTT_KEY
        : null;
  if (mqttKey) {
    const raw = localStorage.getItem(mqttKey);
    if (raw) {
      const metadata = parseLegacyRecord(raw, 'legacy MQTT settings');
      if (Object.hasOwn(metadata, 'password') || Object.hasOwn(metadata, 'channelPsks')) {
        delete metadata.password;
        delete metadata.channelPsks;
        localStorage.setItem(mqttKey, JSON.stringify(metadata));
      }
    }
  }
  if (key === MQTT_PROFILES_SECRET_KEY) {
    const raw = localStorage.getItem(LEGACY_MQTT_PROFILES_KEY);
    if (raw) {
      const profiles: unknown = JSON.parse(raw);
      if (Array.isArray(profiles)) {
        localStorage.setItem(
          LEGACY_MQTT_PROFILES_KEY,
          JSON.stringify(
            profiles.map((profile: unknown) => {
              if (profile === null || typeof profile !== 'object' || Array.isArray(profile))
                return profile;
              const metadata = { ...profile } as Record<string, unknown>;
              delete metadata.password;
              return metadata;
            }),
          ),
        );
      }
    }
  }
  const backup = /^backup:(meshcore|meshtastic):(\d+)$/.exec(key);
  if (backup)
    localStorage.removeItem(
      `${backup[1] === 'meshcore' ? LEGACY_MESHCORE_BACKUP_PREFIX : LEGACY_MESHTASTIC_BACKUP_PREFIX}${backup[2]}`,
    );
}

const cache = new Map<string, string>();
const protectedKeys = new Set<string>();
const deletedCredentials = new Set<string>();
const unavailableStartupCredentials = new Set<string>();
let persistentStorageAvailable = false;
let storageStatusKnown = false;
let initialized = false;
const mutations = new Map<string, Promise<unknown>>();

/** Keep cache/compatibility cleanup in the same order as explicit saves and Forget. */
function mutateSecret<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutations.get(key);
  // Existing synchronous readers consume the optimistic cache on the first save.
  const next = previous
    ? previous
        .catch(() => {
          /* catch-no-log-ok the original caller receives the error */
        })
        .then(operation)
    : operation();
  mutations.set(key, next);
  return next.finally(() => {
    if (mutations.get(key) === next) mutations.delete(key);
  });
}

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
  return protectedKeys.has(key) && !cache.has(key);
}

/** Only failed startup migrations are eligible; never offer unrelated credentials or backups. */
export function getUnavailableStartupCredentialKeys(): string[] {
  return [...unavailableStartupCredentials]
    .filter((key) => !cache.has(key) && (protectedKeys.has(key) || deletedCredentials.has(key)))
    .sort();
}

/** The recovery UI obtains explicit acknowledgement before invoking this narrow Forget flow. */
export async function forgetUnavailableStartupCredentials(keys: readonly string[]): Promise<void> {
  const selected: readonly unknown[] = Array.isArray(keys) ? [...(keys as readonly unknown[])] : [];
  const eligible = new Set(getUnavailableStartupCredentialKeys());
  if (
    !Array.isArray(keys) ||
    selected.length === 0 ||
    new Set(selected).size !== selected.length ||
    !selected.every((key): key is string => typeof key === 'string' && eligible.has(key))
  ) {
    throw new Error('Startup credential selection is no longer eligible');
  }
  for (const key of selected) {
    await mutateSecret(key, async () => {
      // A preceding save or Retry may have made the previously displayed selection readable.
      if (!getUnavailableStartupCredentialKeys().includes(key)) {
        throw new Error('Startup credential selection is no longer eligible');
      }
      await forgetSecureSecret(key);
    });
  }
}

export function setSecureSecret(
  key: string,
  value: string,
  requirePersistent = false,
): Promise<{ persistent: boolean }> {
  return mutateSecret(key, () => writeSecureSecret(key, value, requirePersistent));
}

async function writeSecureSecret(
  key: string,
  value: string,
  requirePersistent = false,
): Promise<{ persistent: boolean }> {
  const previous = cache.get(key);
  let accepted = false;
  cache.set(key, value);
  try {
    const result = requirePersistent
      ? await window.electronAPI.secureSecrets.set(key, value, true)
      : await window.electronAPI.secureSecrets.set(key, value);
    if (!result.verified) throw new Error('secure secret verification failed');
    if (requirePersistent && !result.persistent) {
      throw new Error('secureSecrets: OS key storage unavailable');
    }
    accepted = true;
    persistentStorageAvailable = result.persistent;
    if (compatibilityCredentialKey(key)) {
      // Accepted local-profile disclosure risk: remembering credentials must not
      // require keyring setup. Prefer OS encryption; when unavailable, retain a
      // local compatibility copy, then remove it after verified durable encryption.
      // Key backups are excluded: their success contract requires OS-backed durability.
      if (result.persistent) {
        // Main commits retirement atomically with encrypted storage. A renderer receipt
        // retry must not report a failed save after the verified secret already committed.
        try {
          await clearCompatibilityCredential(key);
        } catch (error) {
          console.warn(
            '[secureSecretStorage] compatibility cleanup deferred',
            errLikeToLogString(error),
          );
        }
      } else await writeCompatibilityCredential(key, value);
    }
    deletedCredentials.delete(key);
    protectedKeys.delete(key);
    unavailableStartupCredentials.delete(key);
    return { persistent: result.persistent };
  } catch (error) {
    if (!accepted) {
      if (previous == null) cache.delete(key);
      else cache.set(key, previous);
    }
    throw error;
  }
}

export function removeSecureSecret(key: string): Promise<void> {
  return mutateSecret(key, () => forgetSecureSecret(key));
}

async function forgetSecureSecret(key: string): Promise<void> {
  const previous = cache.get(key);
  const compatibility = compatibilityCredentialKey(key);
  const priorCompatibility = compatibility
    ? localStorage.getItem(`${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`)
    : null;
  // A tombstone prevents retained legacy plaintext from restoring a credential
  // the user explicitly forgot while the keyring was unavailable.
  if (compatibility) await writeCompatibilityCredential(key, null);
  try {
    await window.electronAPI.secureSecrets.remove(key);
  } catch (error) {
    if (compatibility) {
      const storageKey = `${COMPATIBILITY_CREDENTIAL_PREFIX}${key}`;
      if (priorCompatibility == null) await clearCompatibilityCredential(key);
      else {
        localStorage.setItem(storageKey, priorCompatibility);
        const prior = readCompatibilityCredentials()[key];
        await writeCompatibilityCredential(key, prior.value);
      }
    }
    if (previous != null) cache.set(key, previous);
    throw error;
  }
  cache.delete(key);
  protectedKeys.delete(key);
  if (compatibility) deletedCredentials.add(key);
  await clearLegacyCredentialCopies(key);
  if (compatibility) await clearCompatibilityCredential(key);
  unavailableStartupCredentials.delete(key);
}

async function hydrateExistingSecrets(): Promise<void> {
  cache.clear();
  protectedKeys.clear();
  deletedCredentials.clear();
  // An available keyring can still contain an individually unreadable encrypted row.
  for (const key of await window.electronAPI.secureSecrets.list()) protectedKeys.add(key);
  const values = await window.electronAPI.secureSecrets.getAll();
  for (const [key, value] of Object.entries(values)) {
    cache.set(key, value);
  }
  await flushRendererStorageDeletions();
  const settings: Partial<Record<string, string>> = await window.electronAPI.appSettings.getAll();
  const receiptPrefix = `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${COMPATIBILITY_CREDENTIAL_PREFIX}`;
  for (const [setting, raw] of Object.entries(settings)) {
    if (setting.startsWith(receiptPrefix)) {
      parseRendererStorageDeletionState(raw);
      const key = setting.slice(receiptPrefix.length);
      // A handled legacy copy cannot restore an absent/forgotten secret. Existing secure
      // rows still belong to the secure service, including protected rows during outages.
      if (!cache.has(key) && !protectedKeys.has(key)) deletedCredentials.add(key);
    }
  }
  for (const [key, credential] of Object.entries(readCompatibilityCredentials())) {
    const rawReceipt = settings[`${receiptPrefix}${key}`];
    const receipt = parseRendererStorageDeletionState(rawReceipt);
    if (
      rawReceipt !== undefined &&
      (receipt.deleted ||
        !credential.id ||
        !credential.origin ||
        receipt.applied[credential.origin] !== credential.id)
    )
      continue;
    // Only a receipt-matched explicit edit may supersede an unreadable native row.
    // Unversioned compatibility data cannot establish that it is newer than that row.
    if (isProtectedSecureSecretUnavailable(key) && rawReceipt === undefined) {
      requireAcknowledgedMigration(key, 'protected');
    }
    const { value } = credential;
    if (value === null) {
      // Finish a crash-interrupted Forget before accepting any legacy copies.
      await window.electronAPI.secureSecrets.remove(key);
      cache.delete(key);
      deletedCredentials.add(key);
      await clearCompatibilityCredential(key);
      continue;
    }
    deletedCredentials.delete(key);
    // A compatibility copy may contain a newer user edit than an older protected
    // row retained during a keyring outage.
    if (!persistentStorageAvailable) cache.set(key, value);
    // getAll also includes main-process session secrets. Equality does not prove encryption.
    else await setSecureSecret(key, value, true);
  }
  for (const key of deletedCredentials) await clearLegacyCredentialCopies(key);
}

type MigratedSecretOutcome = 'stored' | 'protected' | 'deleted';

/** Retire a source only after encrypted persistence or an acknowledged compatibility copy. */
async function persistMigratedSecret(key: string, value: string): Promise<MigratedSecretOutcome> {
  if (deletedCredentials.has(key)) return 'deleted';
  if (isProtectedSecureSecretUnavailable(key)) return 'protected';
  // Compatibility has the same accepted profile-disclosure risk as explicit saves.
  // Its SQLite receipt must acknowledge the replacement before the inline source retires.
  if (!persistentStorageAvailable && compatibilityCredentialKey(key)) {
    await writeCompatibilityCredential(key, value);
    cache.set(key, value);
    return 'stored';
  }
  await setSecureSecret(key, value);
  return 'stored';
}

function requireAcknowledgedMigration(key: string, outcome: MigratedSecretOutcome): void {
  if (outcome === 'protected') {
    if (compatibilityCredentialKey(key)) unavailableStartupCredentials.add(key);
    throw new Error(
      'secure secret migration: protected credential unavailable; retry or forget it',
    );
  }
}

async function migrateLegacyIdentityCiphertext(localStorageKey: string): Promise<boolean> {
  if (deletedCredentials.has(MESHCORE_IDENTITY_SECRET_KEY)) return false;
  const ciphertext = localStorage.getItem(localStorageKey);
  if (!ciphertext) return false;
  // Keep encrypted legacy data for a later keyring-backed start. There is no
  // plaintext to import during an outage, and unrelated app use can continue.
  if (!persistentStorageAvailable) return false;
  if (isProtectedSecureSecretUnavailable(MESHCORE_IDENTITY_SECRET_KEY)) return false;
  if (cache.has(MESHCORE_IDENTITY_SECRET_KEY)) {
    await setSecureSecret(
      MESHCORE_IDENTITY_SECRET_KEY,
      cache.get(MESHCORE_IDENTITY_SECRET_KEY)!,
      true,
    );
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

export function migrateLegacyBackupCiphertext(
  protocol: 'meshcore' | 'meshtastic',
  id: number,
  format: 'per-node' | 'meshtastic-single',
  ciphertext: string,
): Promise<boolean> {
  const key = keyBackupSecretKey(protocol, id);
  return mutateSecret(key, () => importLegacyBackupCiphertext(protocol, id, format, ciphertext));
}

async function importLegacyBackupCiphertext(
  protocol: 'meshcore' | 'meshtastic',
  id: number,
  format: 'per-node' | 'meshtastic-single',
  ciphertext: string,
): Promise<boolean> {
  const key = keyBackupSecretKey(protocol, id);
  if (deletedCredentials.has(key)) return false;
  if (!storageStatusKnown) {
    const status = await window.electronAPI.secureSecrets.status();
    persistentStorageAvailable = status.persistent;
    storageStatusKnown = true;
  }
  if (!persistentStorageAvailable) return false;
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
  await migrateLegacyIdentityCiphertext(LEGACY_MESHCORE_IDENTITY_CIPHERTEXT_KEY);

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
  if (parsed.private_key != null) {
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
    requireAcknowledgedMigration(
      MESHCORE_IDENTITY_SECRET_KEY,
      await persistMigratedSecret(
        MESHCORE_IDENTITY_SECRET_KEY,
        cache.get(MESHCORE_IDENTITY_SECRET_KEY) ?? JSON.stringify(parsed.private_key),
      ),
    );
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

async function routeLegacyMqttSettingsByProtocol(
  preferences?: Readonly<Record<string, string>>,
): Promise<boolean> {
  const raw = preferences
    ? preferences[LEGACY_MESHTASTIC_MQTT_KEY]
    : localStorage.getItem(LEGACY_MESHTASTIC_MQTT_KEY);
  if (!raw) return false;
  const parsed = parseLegacyRecord(raw, 'legacy MQTT settings');
  if (
    typeof parsed.topicPrefix === 'string' &&
    parsed.topicPrefix.startsWith('meshcore') &&
    (preferences
      ? !Object.hasOwn(preferences, LEGACY_MESHCORE_MQTT_KEY)
      : localStorage.getItem(LEGACY_MESHCORE_MQTT_KEY) == null)
  ) {
    // Read the original secret in place. Preference finalization moves prepared metadata
    // only after this acknowledgement, so an interrupted start keeps the route stable.
    await migrateMqttSettings(LEGACY_MESHTASTIC_MQTT_KEY, MESHCORE_MQTT_SECRET_KEY);
    if (!preferences) {
      const cleaned = localStorage.getItem(LEGACY_MESHTASTIC_MQTT_KEY);
      if (cleaned) {
        const metadata = parseLegacyRecord(cleaned, 'legacy MQTT settings');
        delete metadata.password;
        delete metadata.channelPsks;
        localStorage.setItem(LEGACY_MESHCORE_MQTT_KEY, JSON.stringify(metadata));
        localStorage.removeItem(LEGACY_MESHTASTIC_MQTT_KEY);
      }
    }
    return true;
  }
  return false;
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
    requireAcknowledgedMigration(
      secretKey,
      await persistMigratedSecret(secretKey, JSON.stringify({ ...secrets, ...existing })),
    );
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
  requireAcknowledgedMigration(
    MQTT_PROFILES_SECRET_KEY,
    await persistMigratedSecret(
      MQTT_PROFILES_SECRET_KEY,
      JSON.stringify({ ...passwords, ...existing }),
    ),
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
  if (deletedCredentials.has(secretKey)) return true;
  if (typeof raw !== 'string') {
    throw new Error('secure secret migration: malformed legacy MeshCore credential');
  }
  const value = preserveCurrent ? (cache.get(secretKey) ?? raw) : raw;
  requireAcknowledgedMigration(secretKey, await persistMigratedSecret(secretKey, value));
  return getCachedSecureSecret(secretKey) === value;
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
    if (deletedCredentials.has(keyBackupSecretKey(protocol, id))) continue;
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

/** Hydrate credentials before React mounts; retire inline copies only after acknowledgement. */
export async function initializeSecureSecrets(
  preferences?: Readonly<Record<string, string>>,
): Promise<void> {
  initialized = false;
  unavailableStartupCredentials.clear();
  const status = await window.electronAPI.secureSecrets.status();
  persistentStorageAvailable = status.persistent;
  storageStatusKnown = true;
  await hydrateExistingSecrets();
  await migrateMeshcoreIdentity();
  const routedLegacyMqtt = await routeLegacyMqttSettingsByProtocol(preferences);
  await migrateMqttSettings(LEGACY_MESHCORE_MQTT_KEY, MESHCORE_MQTT_SECRET_KEY);
  if (!routedLegacyMqtt)
    await migrateMqttSettings(LEGACY_MESHTASTIC_MQTT_KEY, MESHTASTIC_MQTT_SECRET_KEY);
  const { migrateLegacyMeshtasticMqttChannelPsks } =
    await import('./meshtasticMqttSettingsStorage');
  await migrateLegacyMeshtasticMqttChannelPsks();
  await migrateMqttProfiles();
  await migrateCredentialSettings();
  await migrateBackupSlots(LEGACY_MESHCORE_BACKUP_PREFIX, 'meshcore');
  await migrateBackupSlots(LEGACY_MESHTASTIC_BACKUP_PREFIX, 'meshtastic');
  if (persistentStorageAvailable) {
    const { ensureMeshcoreKeyBackupIndex } = await import('./meshcoreKeyBackupStorage');
    const { ensureMeshtasticDmKeyBackupIndex } = await import('./meshtasticDmKeyBackupStorage');
    await ensureMeshcoreKeyBackupIndex();
    await ensureMeshtasticDmKeyBackupIndex();
  }
  initialized = true;
}

export async function initializeSecureSecretsFailClosed(
  preferences?: Readonly<Record<string, string>>,
): Promise<void> {
  try {
    await initializeSecureSecrets(preferences);
  } catch (error) {
    console.warn('[secureSecretStorage] initialization failed ' + errLikeToLogString(error));
    throw error;
  }
}

/** Test-only reset for module cache isolation. */
export function resetSecureSecretCacheForTests(): void {
  mutations.clear();
  resetRendererStorageForTests();
  cache.clear();
  protectedKeys.clear();
  deletedCredentials.clear();
  unavailableStartupCredentials.clear();
  persistentStorageAvailable = false;
  storageStatusKnown = false;
  initialized = false;
}
