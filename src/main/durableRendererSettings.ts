import {
  DURABLE_RENDERER_SETTING_MAX_LENGTH,
  DURABLE_RENDERER_STORAGE_KEYS,
  DURABLE_RENDERER_STORAGE_MIGRATIONS,
  RENDERER_STORAGE_DELETION_SETTING_PREFIX,
} from '../shared/rendererOrigin';
import { hasEstablishedRendererPreferenceValues } from '../shared/rendererPreferences';
import type { NodeSqliteDB } from './db-compat';
import { withFullSqliteSync } from './sqliteDurability';

function parseLastRead(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    // catch-no-log-ok malformed legacy data stays in the untouched origin export for recovery
    return null;
  }
}

/** Before protocol-specific storage, Meshtastic owned the unsuffixed map. */
function initialMeshtasticLastRead(entries: Record<string, string>): string | undefined {
  const legacyRaw = entries['mesh-client:lastRead'] as string | undefined;
  const specificRaw = entries['mesh-client:lastRead:meshtastic'] as string | undefined;
  if (legacyRaw === undefined) return specificRaw;
  if (legacyRaw.length > DURABLE_RENDERER_SETTING_MAX_LENGTH) {
    throw new Error('Renderer migration setting exceeds storage limit: legacy lastRead');
  }
  const legacy = parseLastRead(legacyRaw);
  const specific = parseLastRead(specificRaw);
  if (!legacy) return specificRaw;
  if (!specific) return legacyRaw;
  const merged = new Map(Object.entries(specific));
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const current = merged.get(key);
    if (typeof current !== 'number' || !Number.isFinite(current) || value > current) {
      merged.set(key, value);
    }
  }
  return JSON.stringify(Object.fromEntries(merged));
}

/** Seed once: a restored legacy export must never replace newer SQLite settings. */
export function seedDurableRendererSettings(
  db: NodeSqliteDB,
  entries: Record<string, string>,
): void {
  db.transaction(() => {
    const insert = db.prepareOnce('INSERT OR IGNORE INTO app_settings(key, value) VALUES (?, ?)');
    // Main consumes these flags before the lazy App panel ever mounts.
    const appPreferences = parseLastRead(
      entries['mesh-client:appSettings'] ?? entries['mesh-client:adminSettings'],
    );
    for (const key of [
      'autoUpdateDownloadEnabled',
      'closeToTray',
      'aiEnabled',
      'translationEnabled',
    ]) {
      if (typeof appPreferences?.[key] === 'boolean')
        insert.run(key, appPreferences[key] ? '1' : '0');
    }
    for (const [legacyKey, databaseKey] of DURABLE_RENDERER_STORAGE_MIGRATIONS) {
      const value =
        databaseKey === DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshtastic
          ? initialMeshtasticLastRead(entries)
          : entries[legacyKey];
      if (value === undefined) continue;
      if (value.length > DURABLE_RENDERER_SETTING_MAX_LENGTH) {
        throw new Error(`Renderer migration setting exceeds storage limit: ${databaseKey}`);
      }
      // An empty preference map (clear write-through) must not block repair from replacing it.
      if (databaseKey === DURABLE_RENDERER_STORAGE_KEYS.preferences) {
        const existing = db
          .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
          .get(databaseKey) as { value: string } | undefined;
        if (
          hasEstablishedRendererPreferenceValues(value) &&
          !hasEstablishedRendererPreferenceValues(existing?.value)
        ) {
          db.prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run(
            databaseKey,
            value,
          );
          continue;
        }
      }
      insert.run(databaseKey, value);
    }
  })();
}

/**
 * Explicit user reset of the domains moved out of Chromium storage. Keep canonical empty
 * records so replaying a preserved origin export cannot seed the deleted data again. The
 * caller fences renderer writes and clears its cache/journals before allowing another load.
 */
export function resetDurableRendererData(db: NodeSqliteDB): void {
  const keys = DURABLE_RENDERER_STORAGE_KEYS;
  const emptySettings = [
    [keys.preferences, JSON.stringify({ legacyAliasesImported: true, values: {} })],
    [keys.chatLastRead.meshtastic, '{}'],
    [keys.chatLastRead.meshcore, '{}'],
    [keys.chatLastRead.reticulum, '{}'],
    [keys.roomsLastRead, '{}'],
    [keys.rrcLastRead, '{}'],
    [keys.mecpBlockedSenders, JSON.stringify({ state: { blocked: {} }, version: 1 })],
    [
      keys.takRelayPrefs,
      JSON.stringify({ state: { byIdentity: {}, retiredRooms: null }, version: 3 }),
    ],
  ];
  // The reset completion file is fsynced. WAL NORMAL does not sync each commit, so the reset
  // must commit under FULL before that file can durably declare the operation complete.
  withFullSqliteSync(db, () => {
    db.transaction(() => {
      const write = db.prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)');
      for (const [key, value] of emptySettings) write.run(key, value);
      db.prepareOnce('DELETE FROM app_settings WHERE key LIKE ?').run(
        `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}%`,
      );
      db.prepareOnce('DELETE FROM emergency_incidents').run();
      db.prepareOnce('DELETE FROM emergency_incident_tombstones').run();
      db.prepareOnce(
        'INSERT OR REPLACE INTO emergency_incident_storage (id, initialized) VALUES (1, 1)',
      ).run();
    })();
  });
}
