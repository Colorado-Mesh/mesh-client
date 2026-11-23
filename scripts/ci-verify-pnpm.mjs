#!/usr/bin/env node
/**
 * Fail closed if `pnpm --version` does not print a semver string.
 *
 * Failure point: broken Windows PowerShell shims can exit 0 with empty stdout,
 * so packaging jobs appear green while never installing or building.
 *
 * Windows spawn note: Node 20.12+/22 reject `.cmd`/`.bat` with `shell: false`
 * (`spawnSync pnpm.cmd EINVAL`, CVE-2024-27980). Always prefer `pnpm.exe`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * pnpm spawn target that works with shell:false.
 * On Windows this is the native exe — never `pnpm.cmd` (Node EINVAL).
 */
export function pnpmExecutable() {
  return process.platform === 'win32' ? 'pnpm.exe' : 'pnpm';
}

/**
 * corepack spawn target that works with shell:false.
 * On Windows prefer the native exe when present; `.cmd` needs shell:true.
 */
export function corepackExecutable() {
  return process.platform === 'win32' ? 'corepack.exe' : 'corepack';
}

/**
 * Resolve a native pnpm.exe target from an action-setup / self-update .cmd shim.
 *
 * @param {string} cmdPath
 * @param {{
 *   existsSync?: (p: string) => boolean
 *   readFileSync?: (p: string, enc: BufferEncoding) => string
 * }} [opts]
 * @returns {string | null}
 */
export function resolvePnpmExeFromCmdShim(cmdPath, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  if (!existsSync(cmdPath)) return null;
  let text;
  try {
    text = readFileSync(cmdPath, 'utf8');
  } catch (err) {
    // catch-no-log-ok shim unreadable
    void err;
    return null;
  }
  // Typical self-update shim:
  //   @"%~dp0\..\global\v11\<hash>\node_modules\@pnpm\exe\pnpm" %*
  // or a quoted absolute path to pnpm.exe.
  const patterns = [
    /@?"(%~dp0[^"\r\n]*?pnpm(?:\.exe)?)"/i,
    /@?"([A-Za-z]:\\[^"\r\n]*?pnpm\.exe)"/i,
    /@([A-Za-z]:\\[^\r\n]*?pnpm\.exe)/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m?.[1]) continue;
    let target = m[1].replace(/%~dp0/gi, path.join(path.dirname(cmdPath), path.sep));
    // Cmd shims always use Windows separators; normalize for the host platform (unit tests on darwin/linux).
    target = path.normalize(target.replace(/\\/g, path.sep));
    const withExe = target.toLowerCase().endsWith('.exe') ? target : `${target}.exe`;
    if (existsSync(withExe)) return withExe;
    if (existsSync(target)) return target;
  }
  return null;
}

/**
 * Absolute pnpm.exe candidates under PNPM_HOME (and common self-update layouts).
 *
 * @param {string} pnpmHome
 * @param {{
 *   existsSync?: (p: string) => boolean
 *   readdirSync?: (p: string, opts: { withFileTypes: true }) => import('node:fs').Dirent[]
 * }} [opts]
 * @returns {string[]}
 */
export function windowsPnpmExeCandidatesUnderHome(pnpmHome, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const readdirSync = opts.readdirSync ?? fs.readdirSync;
  /** @type {string[]} */
  const found = [];
  const seen = new Set();
  /** @param {string} p */
  const push = (p) => {
    if (seen.has(p) || !existsSync(p)) return;
    seen.add(p);
    found.push(p);
  };

  push(path.join(pnpmHome, 'pnpm.exe'));
  push(path.join(pnpmHome, 'bin', 'pnpm.exe'));
  push(path.resolve(pnpmHome, '..', 'pnpm', 'pnpm.exe'));

  for (const cmdName of ['pnpm.cmd', 'pnpm.CMD']) {
    for (const dir of [pnpmHome, path.join(pnpmHome, 'bin')]) {
      const fromCmd = resolvePnpmExeFromCmdShim(path.join(dir, cmdName), {
        existsSync,
      });
      if (fromCmd) push(fromCmd);
    }
  }

  const globalV11 = path.join(pnpmHome, 'global', 'v11');
  if (existsSync(globalV11)) {
    let entries;
    try {
      entries = readdirSync(globalV11, { withFileTypes: true });
    } catch (err) {
      // catch-no-log-ok directory vanished between existsSync and readdir (CI race)
      void err;
      entries = [];
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const nm = path.join(globalV11, ent.name, 'node_modules');
      push(path.join(nm, 'pnpm', 'pnpm.exe'));
      push(path.join(nm, '@pnpm', 'exe', 'pnpm.exe'));
      push(path.join(nm, '@pnpm', 'exe.win32-x64', 'pnpm.exe'));
      push(path.join(nm, '@pnpm', 'win32-x64', 'pnpm.exe'));
    }
  }

  return found;
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
 * Pick a Windows pnpm spawn command that works with shell:false.
 *
 * @param {{
 *   platform?: NodeJS.Platform
 *   pnpmHome?: string
 *   existsSync?: (p: string) => boolean
 *   readdirSync?: (p: string, opts: { withFileTypes: true }) => import('node:fs').Dirent[]
 * }} [opts]
 * @returns {string}
 */
export function resolvePnpmSpawnCommand(opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return 'pnpm';

  const pnpmHome = opts.pnpmHome ?? process.env.PNPM_HOME;
  if (pnpmHome && String(pnpmHome).trim()) {
    const underHome = windowsPnpmExeCandidatesUnderHome(pnpmHome, {
      existsSync: opts.existsSync,
      readdirSync: opts.readdirSync,
    });
    if (underHome[0]) return underHome[0];
  }
  return 'pnpm.exe';
}

/**
 * @param {{
 *   spawnSyncFn?: typeof spawnSync
 *   packageJsonPath?: string
 *   platform?: NodeJS.Platform
 *   pnpmHome?: string
 *   existsSync?: (p: string) => boolean
 *   readdirSync?: (p: string, opts: { withFileTypes: true }) => import('node:fs').Dirent[]
 *   log?: (msg: string) => void
 * }} [opts]
 * @returns {string} resolved pnpm version
 */
export function verifyPnpmVersion(opts = {}) {
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const log = opts.log ?? ((msg) => console.debug(msg));
  const pinned = readPinnedPnpmVersion(opts.packageJsonPath);
  const command = resolvePnpmSpawnCommand({
    platform: opts.platform,
    pnpmHome: opts.pnpmHome,
    existsSync: opts.existsSync,
    readdirSync: opts.readdirSync,
  });
  const result = spawnSyncFn(command, ['--version'], {
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
