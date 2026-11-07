/**
 * electron-builder beforeBuild hook — remove Unix-only `usocket` before
 * @electron/rebuild runs. `allowBuilds.usocket: false` only skips pnpm install
 * builds; pack-time rebuild still finds binding.gyp and fails on win32
 * (missing sys/ioctl.h). mesh-client never needs usocket (path-based D-Bus only).
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Recursively find directories under `root` whose package.json name is `usocket`.
 * @param {string} root
 * @returns {string[]}
 */
export function findUsocketPackageDirs(root) {
  /** @type {string[]} */
  const found = [];
  if (!existsSync(root)) return found;

  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // catch-no-log-ok: race / permission while scanning node_modules
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'usocket') {
        const pkgPath = path.join(full, 'package.json');
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            if (pkg?.name === 'usocket') {
              found.push(full);
              continue;
            }
          } catch {
            // catch-no-log-ok: malformed package.json — keep walking children
          }
        }
      }
      // Skip huge / irrelevant trees under a package's own node_modules siblings.
      if (entry.name === '.cache' || entry.name === '.bin') continue;
      walk(full);
    }
  }

  walk(root);
  return found;
}

/**
 * Remove every usocket package directory under `nodeModulesRoot`.
 * @param {string} [nodeModulesRoot]
 * @returns {string[]} removed absolute paths
 */
export function stripUsocketPackages(nodeModulesRoot = path.join(projectRoot, 'node_modules')) {
  const dirs = findUsocketPackageDirs(nodeModulesRoot);
  for (const dir of dirs) {
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        rmSync(dir, { recursive: true, force: true });
        console.debug(`[beforeBuild] Removed usocket package: ${dir}`);
      }
    } catch (err) {
      console.warn(
        `[beforeBuild] Failed to remove usocket at ${dir}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return dirs;
}

/**
 * Must resolve to `true` so electron-builder continues pack-time native rebuild.
 * Returning void/undefined is treated as false and skips installOrRebuild entirely.
 *
 * @type {(context: import('app-builder-lib').BeforeBuildContext) => Promise<boolean>}
 */
export default async function beforeBuild() {
  const removed = stripUsocketPackages();
  if (removed.length === 0) {
    console.debug('[beforeBuild] No usocket packages found under node_modules');
  } else {
    console.debug(
      `[beforeBuild] Stripped ${removed.length} usocket package(s) before native rebuild`,
    );
  }
  return true;
}
