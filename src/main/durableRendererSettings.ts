import {
  DURABLE_RENDERER_SETTING_MAX_LENGTH,
  DURABLE_RENDERER_STORAGE_KEYS,
  DURABLE_RENDERER_STORAGE_MIGRATIONS,
} from '../shared/rendererOrigin';
import type { NodeSqliteDB } from './db-compat';

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
    for (const [legacyKey, databaseKey] of DURABLE_RENDERER_STORAGE_MIGRATIONS) {
      const value =
        databaseKey === DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshtastic
          ? initialMeshtasticLastRead(entries)
          : entries[legacyKey];
      if (value === undefined) continue;
      if (value.length > DURABLE_RENDERER_SETTING_MAX_LENGTH) {
        throw new Error(`Renderer migration setting exceeds storage limit: ${databaseKey}`);
      }
      insert.run(databaseKey, value);
    }
  })();
}
