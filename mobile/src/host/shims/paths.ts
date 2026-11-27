/**
 * Virtual filesystem layout for the mobile host worker. Electron `app.getPath()` names map here.
 * Everything under `PERSISTED_ROOT` is mirrored to durable storage (see `fsPersistence.ts`);
 * `/tmp` is memory-only; files written under `EXPORTS_ROOT` are handed to the OS share sheet.
 */
export const PERSISTED_ROOT = '/data';
export const EXPORTS_ROOT = '/exports';
export const IMPORTS_ROOT = '/imports';

export const MOBILE_PATHS = {
  app: '/app',
  appData: '/data',
  userData: '/data/user',
  sessionData: '/data/user',
  home: '/data/home',
  documents: '/data/documents',
  downloads: '/data/downloads',
  desktop: '/data/documents',
  music: '/data/documents',
  pictures: '/data/documents',
  videos: '/data/documents',
  recent: '/data/recent',
  temp: '/tmp',
  logs: '/data/user/logs',
  crashDumps: '/data/user/Crashpad',
  exe: '/app/mesh-client',
  module: '/app/mesh-client',
  userCache: '/tmp/cache',
} as const;

/** True for paths whose contents survive app restarts. */
export function isPersistedPath(p: string): boolean {
  return p === PERSISTED_ROOT || p.startsWith(`${PERSISTED_ROOT}/`);
}

/** SQLite database files live in the sqlite-wasm VFS, not in the memory filesystem. */
export function isSqliteManagedPath(p: string): boolean {
  return /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i.test(p);
}
