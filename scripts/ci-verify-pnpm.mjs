#!/usr/bin/env node
/**
 * Fail closed if `pnpm --version` does not print a semver string.
 *
 * Failure point: broken Windows PowerShell shims can exit 0 with empty stdout,
 * so packaging jobs appear green while never installing or building.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** pnpm spawn target that works with shell:false on Windows (.cmd shim). */
export function pnpmExecutable() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/** corepack spawn target that works with shell:false on Windows (.cmd shim). */
export function corepackExecutable() {
  return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parsePnpmVersionOutput(text) {
  const line = String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  // Keep the pattern linear — eslint security/detect-unsafe-regex rejects nested quantifiers.
  const m = line.match(/^(\d+\.\d+\.\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * @param {string} [packageJsonPath]
 * @returns {string | null} major.minor.patch (no integrity)
 */
export function readPinnedPnpmVersion(packageJsonPath = path.join(ROOT, 'package.json')) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const raw = pkg.packageManager;
  if (typeof raw !== 'string' || !raw.startsWith('pnpm@')) return null;
  return raw.slice('pnpm@'.length).split('+', 1)[0] ?? null;
}

/**
 * @param {{
 *   spawnSyncFn?: typeof spawnSync
 *   packageJsonPath?: string
 *   log?: (msg: string) => void
 * }} [opts]
 * @returns {string} resolved pnpm version
 */
export function verifyPnpmVersion(opts = {}) {
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const log = opts.log ?? ((msg) => console.debug(msg));
  const pinned = readPinnedPnpmVersion(opts.packageJsonPath);
  const result = spawnSyncFn(pnpmExecutable(), ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    throw new Error(`[ci-verify-pnpm] failed to spawn pnpm: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const errText = String(result.stderr ?? result.stdout ?? '').trim();
    throw new Error(
      `[ci-verify-pnpm] pnpm --version exited ${String(result.status)}${
        errText ? `: ${errText}` : ''
      }`,
    );
  }
  const version = parsePnpmVersionOutput(String(result.stdout ?? ''));
  if (!version) {
    throw new Error(
      `[ci-verify-pnpm] pnpm --version did not return semver (got ${JSON.stringify(
        String(result.stdout ?? ''),
      )})`,
    );
  }
  if (pinned) {
    const pinnedMajor = pinned.split('.', 1)[0];
    const actualMajor = version.split('.', 1)[0];
    if (pinnedMajor !== actualMajor) {
      throw new Error(
        `[ci-verify-pnpm] pnpm major mismatch: PATH has ${version}, package.json pins ${pinned}`,
      );
    }
  }
  log(`[ci-verify-pnpm] pnpm ${version}${pinned ? ` (packageManager ${pinned})` : ''}`);
  return version;
}

function main() {
  verifyPnpmVersion();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
