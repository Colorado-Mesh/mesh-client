import { readdirSync } from 'fs';
import path from 'path';

/**
 * Recursively find the electron-builder NSIS app payload archive inside a 7z NSIS extract.
 * Prefers app*.7z or app*.zip under $PLUGINSDIR (electron-builder layout).
 *
 * @param {string} rootDir
 * @returns {string | null} absolute path to the chosen payload archive
 */
export function findAppArchive(rootDir) {
  /** @type {string[]} */
  const archives = [];

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.7z') || entry.name.endsWith('.zip')) {
        archives.push(full);
      }
    }
  }

  walk(rootDir);
  if (archives.length === 0) {
    return null;
  }

  const appArchives = archives.filter((p) => path.basename(p).startsWith('app'));
  const candidates = appArchives.length > 0 ? appArchives : archives;

  const inPluginsDir = candidates.filter((p) => p.includes('$PLUGINSDIR'));
  if (inPluginsDir.length > 0) {
    return inPluginsDir.sort()[0];
  }

  return candidates.sort()[0];
}
