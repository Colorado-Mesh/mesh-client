/**
 * Remove stale @jsr/_tmp_* directories left by pnpm install races.
 *
 * Failure point: pnpm renames @jsr/_tmp_* → package dir; concurrent work can
 * leave ENOENT/ENOTEMPTY on retry (Windows packaging, Flatpak offline install).
 */
import { existsSync, readdirSync, rmSync } from 'fs';
import path from 'path';

/** @param {string} rootDir */
export function cleanJsrTempDirs(rootDir) {
  if (!existsSync(rootDir)) return;

  for (const ent of readdirSync(rootDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const full = path.join(rootDir, ent.name);
    if (ent.name === '@jsr') {
      for (const child of readdirSync(full, { withFileTypes: true })) {
        if (child.isDirectory() && child.name.startsWith('_tmp_')) {
          rmSync(path.join(full, child.name), { recursive: true, force: true });
        }
      }
    }
    if (ent.name === 'node_modules' || ent.name.startsWith('@')) {
      cleanJsrTempDirs(full);
    }
  }
}
