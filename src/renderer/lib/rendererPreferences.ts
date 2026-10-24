import { DURABLE_RENDERER_STORAGE_KEYS } from '@/shared/rendererOrigin';
import { isRendererPreferenceKey } from '@/shared/rendererPreferences';

export { isRendererPreferenceKey } from '@/shared/rendererPreferences';

import { createDurableRendererSetting } from './durableRendererSetting';

const STORAGE_KEY = 'mesh-client:rendererPreferences';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never create another plaintext recovery copy of legacy inline credentials. */
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/^(?:password|channelPsks|private_key|meshcore(?:Room|Repeater)Credential:.*)$/.test(
            key,
          ),
      )
      .map(([key, child]) => [key, withoutSecrets(child)]),
  );
}

const credentialBearingKey =
  /^mesh-client:(?:appSettings|adminSettings|mqttSettings(?::meshcore)?|mqttProfiles:meshtastic|meshcoreIdentity)$/;

function preferenceValue(key: string, raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (credentialBearingKey.test(key)) {
      const valid =
        key === 'mesh-client:mqttProfiles:meshtastic'
          ? Array.isArray(value) && value.every(record)
          : record(value);
      if (!valid) return null;
    }
    return JSON.stringify(withoutSecrets(value));
  } catch {
    // catch-no-log-ok plain strings (names, addresses, theme colours) are valid preferences
    return credentialBearingKey.test(key) ? null : raw;
  }
}

function retainLegacySecrets(value: unknown, previous: unknown): unknown {
  if (Array.isArray(value) && Array.isArray(previous)) {
    return value.map((entry, index) =>
      retainLegacySecrets(
        entry,
        record(entry) && typeof entry.id === 'string'
          ? previous.find((old) => record(old) && old.id === entry.id)
          : previous[index],
      ),
    );
  }
  if (!record(value) || !record(previous)) return value;
  const clean = withoutSecrets(previous) as Record<string, unknown>;
  const result = { ...value };
  for (const [key, child] of Object.entries(previous)) {
    if (!Object.hasOwn(clean, key)) result[key] = child;
    else if (Object.hasOwn(value, key)) result[key] = retainLegacySecrets(value[key], child);
  }
  return result;
}

function snapshot(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && isRendererPreferenceKey(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        const clean = preferenceValue(key, value);
        if (clean !== null) values[key] = clean;
      }
    }
  }
  return values;
}

/** Structured values let pending journals merge individual app fields, not entire JSON blobs. */
function encodeValues(values: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, raw]) => {
      try {
        const value: unknown = JSON.parse(raw);
        return [key, record(value) || Array.isArray(value) ? value : raw];
      } catch {
        // catch-no-log-ok plain string preferences retain their exact encoding
        return [key, raw];
      }
    }),
  );
}

function decodeValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (
        !isRendererPreferenceKey(key) ||
        !(typeof value === 'string' || record(value) || Array.isArray(value))
      ) {
        throw new Error('Invalid renderer preference map');
      }
      const raw = preferenceValue(key, typeof value === 'string' ? value : JSON.stringify(value));
      if (raw === null) throw new Error('Invalid structured renderer preference');
      return [key, raw];
    }),
  );
}

const oneZeroBooleans = new Set([
  'aiEnabled',
  'translationEnabled',
  'reticulumAutostart',
  'reticulumAutoResendOnAnnounce',
  'autoUpdateDownloadEnabled',
  'closeToTray',
  ...['meshtastic', 'meshcore', 'reticulum', 'rrc'].map(
    (protocol) => `${protocol}MessageRetentionEnabled`,
  ),
]);
const jsonBooleans = new Set([
  'reduceMotion',
  'use24HourTime',
  'storeForwardAutoFetchHistory',
  'alwaysShowMessageActions',
  'reticulumRmapDiscoveryEncrypt',
  'reticulumRmapPublishIfac',
]);
const numbers = new Set([
  'reticulumRmapAnnounceIntervalMin',
  'reticulumRmapHeightMeters',
  'reticulumRmapDiscoveryStampValue',
  'meshtasticConfigureTargetNodeNum',
  'meshtasticLastRfSelfNodeId',
  'meshcoreLastSelfNodeId',
  ...['meshtastic', 'meshcore', 'reticulum', 'rrc'].map(
    (protocol) => `${protocol}MessageRetentionCount`,
  ),
]);
const strings = new Set([
  'locale',
  'mapBasemapId',
  'storeForwardHistoryProfile',
  'reticulumLastSelfLxmfHash',
  'reticulumRmapReachableOn',
  'reticulumRmapDiscoveryLxmfAddress',
]);
const objects = new Set([
  'notificationSounds',
  'meshtasticOwnNodeNumsByPublicKey',
  'meshtasticRemoteAdminKeyByNode',
]);
const sqlitePreferences = new Set([
  'autoUpdateDownloadEnabled',
  'closeToTray',
  'aiEnabled',
  'translationEnabled',
  ...['meshtastic', 'meshcore', 'reticulum', 'rrc'].flatMap((protocol) => [
    `${protocol}MessageRetentionEnabled`,
    `${protocol}MessageRetentionCount`,
  ]),
]);

/** The older scalar SQLite records use several encodings, not one JSON codec. */
export function importLegacyPreferenceAliases(
  values: Partial<Record<string, string>>,
  settings: Partial<Record<string, string>>,
): void {
  const appKey = 'mesh-client:appSettings';
  let app: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(
      values[appKey] ?? values['mesh-client:adminSettings'] ?? '{}',
    );
    if (record(parsed)) app = parsed;
  } catch {
    // catch-no-log-ok preserve malformed legacy data in the origin export
  }
  const selfNode = values['mesh-client:meshcoreLastSelfNodeId'];
  if (selfNode?.trim() && Number.isFinite(Number(selfNode)))
    app.meshcoreLastSelfNodeId = Number(selfNode);
  const lxmf = values['mesh-client:reticulumLastSelfLxmfHash'];
  if (lxmf !== undefined) app.reticulumLastSelfLxmfHash = lxmf;
  for (const [key, raw] of Object.entries(settings)) {
    if (raw === undefined) continue;
    // Renderer-owned fields were historically read from this blob. Existing saved choices
    // beat stale scalar mirrors; SQLite-owned flags and retention retain their native authority.
    if (Object.hasOwn(app, key) && !sqlitePreferences.has(key)) continue;
    if (oneZeroBooleans.has(key) && (raw === '0' || raw === '1')) app[key] = raw === '1';
    else if (jsonBooleans.has(key) && (raw === 'true' || raw === 'false'))
      app[key] = raw === 'true';
    else if (numbers.has(key) && raw.trim() && Number.isFinite(Number(raw))) app[key] = Number(raw);
    else if (strings.has(key)) app[key] = raw;
    else if (objects.has(key)) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (record(parsed)) app[key] = parsed;
      } catch {
        // catch-no-log-ok invalid scalar aliases must not erase a valid browser preference
      }
    } else if (/^(?:meshtasticRemoteAdminKey|meshcoreRoomSync|meshcoreRoomLastPost):/.test(key)) {
      app[key] = raw;
    }
  }
  if (Object.keys(app).length) values[appKey] = JSON.stringify(withoutSecrets(app));
  // These consumers prefer their direct cache over the shared app blob.
  if (typeof app.meshcoreLastSelfNodeId === 'number')
    values['mesh-client:meshcoreLastSelfNodeId'] = String(app.meshcoreLastSelfNodeId);
  if (typeof app.reticulumLastSelfLxmfHash === 'string')
    values['mesh-client:reticulumLastSelfLxmfHash'] = app.reticulumLastSelfLxmfHash;
}

async function synchronizeScalarCaches(
  values: Partial<Record<string, string>>,
  settings: Partial<Record<string, string>>,
): Promise<void> {
  const raw = values['mesh-client:appSettings'];
  // A malformed legacy record must remain untouched for secure-startup recovery.
  if (raw === undefined && localStorage.getItem('mesh-client:appSettings') !== null) return;
  const app: unknown = JSON.parse(raw ?? '{}');
  if (!record(app)) return;
  const publicKeys = app.meshtasticRemoteAdminKeyByNode;
  if (record(publicKeys)) {
    for (const [node, value] of Object.entries(publicKeys)) {
      if (
        /^\d{1,10}$/.test(node) &&
        typeof value === 'string' &&
        !Object.hasOwn(app, `meshtasticRemoteAdminKey:${node}`)
      )
        app[`meshtasticRemoteAdminKey:${node}`] = value;
    }
  }
  for (const key of Object.keys(settings)) {
    if (
      !sqlitePreferences.has(key) &&
      !Object.hasOwn(app, key) &&
      (oneZeroBooleans.has(key) ||
        jsonBooleans.has(key) ||
        numbers.has(key) ||
        strings.has(key) ||
        objects.has(key) ||
        /^(?:meshtasticRemoteAdminKey|meshcoreRoomSync|meshcoreRoomLastPost):/.test(key))
    ) {
      // Late readers must not restore values intentionally omitted from the canonical map.
      await window.electronAPI.appSettings.remove(key);
    }
  }
  for (const [key, value] of Object.entries(app)) {
    if (sqlitePreferences.has(key) || key === 'meshtasticRemoteAdminKeyByNode') continue;
    let encoded: string | undefined;
    if (oneZeroBooleans.has(key) && typeof value === 'boolean') encoded = value ? '1' : '0';
    else if (jsonBooleans.has(key) && typeof value === 'boolean') encoded = String(value);
    else if (key === 'meshtasticConfigureTargetNodeNum' && value === '') encoded = '';
    else if (
      key.startsWith('meshcoreRoomLastPost:') &&
      typeof value === 'number' &&
      Number.isFinite(value)
    )
      encoded = String(value);
    else if (
      numbers.has(key) &&
      (typeof value === 'number' || (typeof value === 'string' && value.trim())) &&
      Number.isFinite(Number(value))
    )
      encoded = String(Number(value));
    else if (
      (strings.has(key) ||
        /^(?:meshtasticRemoteAdminKey|meshcoreRoomSync|meshcoreRoomLastPost):/.test(key)) &&
      typeof value === 'string'
    )
      encoded = value;
    else if (objects.has(key)) {
      try {
        const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
        if (record(parsed)) encoded = JSON.stringify(parsed);
      } catch {
        // catch-no-log-ok invalid legacy object aliases must not erase the source preference
      }
    }
    const limit =
      key === 'notificationSounds' || key === 'meshtasticOwnNodeNumsByPublicKey' ? 4096 : 256;
    if (encoded !== undefined && encoded.length <= limit && encoded !== settings[key])
      await window.electronAPI.appSettings.set(key, encoded);
  }
}

let adapter: ReturnType<typeof createDurableRendererSetting> | undefined;
let installed = false;
let applying = false;
let restored = false;
let uninstallPersistence: (() => void) | undefined;

function preferences() {
  adapter ??= createDurableRendererSetting(
    STORAGE_KEY,
    DURABLE_RENDERER_STORAGE_KEYS.preferences,
    JSON.stringify({ legacyAliasesImported: false, values: {} }),
  );
  return adapter;
}

function saveSnapshot(): void {
  if (!applying)
    preferences().write(
      JSON.stringify({ legacyAliasesImported: true, values: encodeValues(snapshot()) }),
    );
}

/** Existing helpers and Zustand persist all use Storage methods, including removals/clear. */
export function installRendererPreferencePersistence(): () => void {
  if (installed) return uninstallPersistence!;
  installed = true;
  const prototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSet = prototype.setItem;
  const originalRemove = prototype.removeItem;
  const originalClear = prototype.clear;
  prototype.setItem = function (key: unknown, value: unknown): void {
    Reflect.apply(originalSet, this, [key, value]);
    if (this === localStorage && isRendererPreferenceKey(String(key))) saveSnapshot();
  };
  prototype.removeItem = function (key: unknown): void {
    Reflect.apply(originalRemove, this, [key]);
    if (this === localStorage && isRendererPreferenceKey(String(key))) saveSnapshot();
  };
  prototype.clear = function (): void {
    originalClear.call(this);
    if (this === localStorage) saveSnapshot();
  };
  uninstallPersistence = () => {
    prototype.setItem = originalSet;
    prototype.removeItem = originalRemove;
    prototype.clear = originalClear;
    installed = false;
    uninstallPersistence = undefined;
  };
  return uninstallPersistence;
}

/** Finish before App/lazy panels and protocol startup effects read their synchronous caches. */
export async function hydrateRendererPreferences(
  settings: Partial<Record<string, string>>,
): Promise<void> {
  if (restored) return preferences().flush();
  // A SQLite ACK is not proof that every synchronous browser cache was restored.
  // Repeat failed applications from the fresh database snapshot and retained journal.
  if (adapter?.isHydrated()) adapter = undefined;
  const durable = preferences();
  const current = snapshot();
  const canonical = settings[DURABLE_RENDERER_STORAGE_KEYS.preferences];
  if (canonical !== undefined) {
    const parsed: unknown = JSON.parse(canonical);
    if (!record(parsed) || !record(parsed.values)) {
      throw new Error('Invalid renderer preference map');
    }
    settings = {
      ...settings,
      [DURABLE_RENDERER_STORAGE_KEYS.preferences]: JSON.stringify({
        ...parsed,
        values: encodeValues(decodeValues(parsed.values)),
      }),
    };
  }
  if (settings[DURABLE_RENDERER_STORAGE_KEYS.preferences] === undefined) {
    importLegacyPreferenceAliases(current, settings);
    durable.hydrateLocal(() => {
      durable.write(JSON.stringify({ legacyAliasesImported: true, values: encodeValues(current) }));
    });
  }
  await durable.hydrate(settings);
  const saved: unknown = JSON.parse(durable.read() ?? '{}');
  if (!record(saved) || !record(saved.values)) throw new Error('Invalid renderer preference map');
  const values = decodeValues(saved.values);
  if (saved.legacyAliasesImported !== true) {
    importLegacyPreferenceAliases(values, settings);
  }
  applying = true;
  try {
    // Absence in an established canonical map is an intentional removal, not a missing cache.
    for (const key of Object.keys(current)) {
      if (!Object.hasOwn(values, key)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(values)) {
      if (!isRendererPreferenceKey(key) || typeof value !== 'string') continue;
      // Retain legacy inline secrets until the verified secure migration has consumed them.
      let next = preferenceValue(key, value);
      if (next === null) throw new Error('Invalid structured renderer preference');
      const raw = localStorage.getItem(key);
      if (raw !== null && preferenceValue(key, raw) === null) continue;
      if (raw !== null) {
        try {
          const old: unknown = JSON.parse(raw);
          const parsed: unknown = JSON.parse(next);
          if (record(old) && record(parsed)) {
            next = JSON.stringify(retainLegacySecrets(parsed, old));
          } else if (Array.isArray(old) && Array.isArray(parsed))
            next = JSON.stringify(retainLegacySecrets(parsed, old));
        } catch {
          // catch-no-log-ok non-JSON preferences have no inline credential fields
        }
      }
      localStorage.setItem(key, next);
    }
  } finally {
    applying = false;
  }
  saveSnapshot();
  await durable.flush();
  await synchronizeScalarCaches(snapshot(), settings);
  restored = true;
}

export function flushRendererPreferences(): Promise<void> {
  return preferences().flush();
}
