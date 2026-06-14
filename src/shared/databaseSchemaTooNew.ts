/** Stable IPC/log marker for schema newer than app (see DatabaseSchemaTooNewError). */
export const DB_SCHEMA_TOO_NEW_CODE = 'DB_SCHEMA_TOO_NEW' as const;

export const DB_SCHEMA_TOO_NEW_LOG_PATTERN =
  /\[db\] Database schema v(\d+) is newer than this app supports \(v(\d+)\)/;

export function parseDatabaseSchemaTooNewFromMessage(
  message: string,
): { dbVersion: number; appVersion: number } | null {
  const match = DB_SCHEMA_TOO_NEW_LOG_PATTERN.exec(message);
  if (!match) return null;
  const dbVersion = Number(match[1]);
  const appVersion = Number(match[2]);
  if (!Number.isFinite(dbVersion) || !Number.isFinite(appVersion)) return null;
  return { dbVersion, appVersion };
}
