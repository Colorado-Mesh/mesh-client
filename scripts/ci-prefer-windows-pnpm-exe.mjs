#!/usr/bin/env node
/**
 * Prefer the real pnpm.exe on Windows PATH after pnpm/action-setup.
 *
 * Failure point: action-setup v6.1.0 native bootstrap (pnpm 12) sets PNPM_HOME to
 * `node_modules/.bin`. PowerShell resolves `pnpm` to npm's `pnpm.ps1` shim there,
 * which exits 0 with no stdout — so `pnpm install` / `pnpm run dist:win` become
 * silent no-ops and Windows packaging uploads only READ-ME-FIRST.
 *
 * After a packageManager bump, action-setup bootstraps an older native exe under
 * `node_modules/pnpm/pnpm.exe`, then self-updates into PNPM_HOME (and often
 * `global/v11/…`). Preferring the bootstrap sibling first leaves a stale exe on
 * PATH; that binary then fails with "the installed pnpm wrapper is missing" when
 * it tries to honor the newer packageManager pin via package-manager-store.
 *
 * Strategy: discover candidate pnpm.exe paths (PNPM_HOME, self-update global
 * store, then bootstrap), probe `--version` without shell, and prepend the
 * directory of the exe that matches package.json#packageManager (else the first
 * working probe).
 *
 * No-op on non-Windows. Requires PNPM_HOME + GITHUB_PATH (GitHub Actions).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePnpmVersionOutput, readPinnedPnpmVersion } from './ci-verify-pnpm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} pnpmHome
 * @returns {string[]}
 */
export function windowsPnpmExeCandidates(pnpmHome) {
  return [
    path.join(pnpmHome, 'pnpm.exe'),
    path.join(pnpmHome, 'bin', 'pnpm.exe'),
    // Bootstrap sibling is often stale after action-setup self-update — keep last.
    path.resolve(pnpmHome, '..', 'pnpm', 'pnpm.exe'),
  ];
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
 * @param {string} pnpmHome
 * @param {{
 *   existsSync?: (p: string) => boolean
 *   readdirSync?: (p: string, opts: { withFileTypes: true }) => import('node:fs').Dirent[]
 *   readFileSync?: (p: string, enc: BufferEncoding) => string
 * }} [opts]
 * @returns {string[]}
 */
export function discoverWindowsPnpmExes(pnpmHome, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const readdirSync = opts.readdirSync ?? fs.readdirSync;
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  /** @type {string[]} */
  const found = [];
  const seen = new Set();

  /** @param {string} p */
  const push = (p) => {
    if (seen.has(p) || !existsSync(p)) return;
    seen.add(p);
    found.push(p);
  };

  for (const candidate of windowsPnpmExeCandidates(pnpmHome)) {
    push(candidate);
  }

  for (const cmdName of ['pnpm.cmd', 'pnpm.CMD']) {
    for (const dir of [pnpmHome, path.join(pnpmHome, 'bin')]) {
      const fromCmd = resolvePnpmExeFromCmdShim(path.join(dir, cmdName), {
        existsSync,
        readFileSync,
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
      // Platform optional deps used by @pnpm/exe on Windows.
      push(path.join(nm, '@pnpm', 'exe.win32-x64', 'pnpm.exe'));
      push(path.join(nm, '@pnpm', 'win32-x64', 'pnpm.exe'));
    }
  }

  return found;
}

/**
 * @param {string} exe
 * @param {typeof spawnSync} spawnSyncFn
 * @param {{ shell?: boolean }} [opts]
 * @returns {string | null}
 */
export function probePnpmExeVersion(exe, spawnSyncFn = spawnSync, opts = {}) {
  // Probe outside the repo so a stale bootstrap does not attempt packageManager
  // engine install into package-manager-store (the CI failure mode on Windows).
  // Windows .cmd shims need shell:true; native .exe probes stay shell:false.
  const result = spawnSyncFn(exe, ['--version'], {
    encoding: 'utf8',
    shell: opts.shell ?? false,
    cwd: os.tmpdir(),
  });
  if (result.error || result.status !== 0) return null;
  return parsePnpmVersionOutput(String(result.stdout ?? ''));
}

/**
 * Find a refreshed PNPM_HOME (.cmd) shim that reports the packageManager pin.
 * Prefer PNPM_HOME/bin, then PNPM_HOME (action-setup may place shims in either).
 *
 * @param {string} pnpmHome
 * @param {string} pinned
 * @param {{
 *   existsSync?: (p: string) => boolean
 *   spawnSyncFn?: typeof spawnSync
 * }} [opts]
 * @returns {{ shim: string, dir: string, version: string } | null}
 */
export function findPinnedPnpmHomeShim(pnpmHome, pinned, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  for (const dir of [path.join(pnpmHome, 'bin'), pnpmHome]) {
    for (const name of ['pnpm.cmd', 'pnpm.CMD']) {
      const shim = path.join(dir, name);
      if (!existsSync(shim)) continue;
      const version = probePnpmExeVersion(shim, spawnSyncFn, { shell: true });
      if (version === pinned) {
        return { shim, dir, version };
      }
    }
  }
  return null;
}

/**
 * @param {string[]} exes
 * @param {string | null} pinned
 * @param {typeof spawnSync} spawnSyncFn
 * @returns {{ exe: string, version: string } | null}
 */
export function selectWindowsPnpmExe(exes, pinned, spawnSyncFn = spawnSync) {
  /** @type {{ exe: string, version: string } | null} */
  let fallback = null;
  for (const exe of exes) {
    const version = probePnpmExeVersion(exe, spawnSyncFn);
    if (!version) continue;
    if (pinned && version === pinned) {
      return { exe, version };
    }
    if (!fallback) fallback = { exe, version };
  }
  return fallback;
}

/**
 * @param {string} pnpmHome
 * @param {{
 *   existsSync?: (p: string) => boolean
 *   unlinkSync?: (p: string) => void
 *   log?: (msg: string) => void
 * }} [opts]
 */
export function neutralizeBrokenPowershellShims(pnpmHome, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const unlinkSync = opts.unlinkSync ?? fs.unlinkSync;
  const log = opts.log ?? ((msg) => console.debug(msg));
  for (const dir of [pnpmHome, path.join(pnpmHome, 'bin')]) {
    for (const name of ['pnpm.ps1', 'pnpx.ps1']) {
      const shim = path.join(dir, name);
      if (!existsSync(shim)) continue;
      try {
        unlinkSync(shim);
        log(`[ci-prefer-windows-pnpm-exe] removed broken PowerShell shim ${shim}`);
      } catch (err) {
        // catch-no-log-ok best-effort cleanup on ephemeral CI runners
        void err;
      }
    }
  }
}

/**
 * @param {{
 *   platform?: NodeJS.Platform
 *   pnpmHome?: string
 *   githubPath?: string
 *   packageJsonPath?: string
 *   existsSync?: (p: string) => boolean
 *   readdirSync?: (p: string, opts: { withFileTypes: true }) => import('node:fs').Dirent[]
 *   readFileSync?: (p: string, enc: BufferEncoding) => string
 *   unlinkSync?: (p: string) => void
 *   appendFileSync?: (p: string, data: string) => void
 *   spawnSyncFn?: typeof spawnSync
 *   log?: (msg: string) => void
 * }} [opts]
 * @returns {{ skipped: boolean, exeDir?: string, exe?: string, version?: string, reason?: string }}
 */
export function preferWindowsPnpmExe(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const log = opts.log ?? ((msg) => console.debug(msg));
  if (platform !== 'win32') {
    return { skipped: true, reason: 'not-win32' };
  }

  const pnpmHome = opts.pnpmHome ?? process.env.PNPM_HOME;
  if (!pnpmHome || !String(pnpmHome).trim()) {
    throw new Error('[ci-prefer-windows-pnpm-exe] PNPM_HOME is unset');
  }

  const githubPath = opts.githubPath ?? process.env.GITHUB_PATH;
  if (!githubPath || !String(githubPath).trim()) {
    throw new Error(
      '[ci-prefer-windows-pnpm-exe] GITHUB_PATH is unset (expected on GitHub Actions runners)',
    );
  }

  const existsSync = opts.existsSync ?? fs.existsSync;
  const readdirSync = opts.readdirSync ?? fs.readdirSync;
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  const unlinkSync = opts.unlinkSync ?? fs.unlinkSync;
  const appendFileSync = opts.appendFileSync ?? fs.appendFileSync;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const pinned = readPinnedPnpmVersion(opts.packageJsonPath ?? path.join(ROOT, 'package.json'));
  const exes = discoverWindowsPnpmExes(pnpmHome, { existsSync, readdirSync, readFileSync });
  if (exes.length === 0) {
    throw new Error(
      `[ci-prefer-windows-pnpm-exe] pnpm.exe not found. Tried:\n${windowsPnpmExeCandidates(pnpmHome)
        .map((c) => `  ${c}`)
        .join(
          '\n',
        )}\n  ${path.join(pnpmHome, 'global', 'v11', '*', 'node_modules', 'pnpm', 'pnpm.exe')}\n  ${path.join(pnpmHome, 'global', 'v11', '*', 'node_modules', '@pnpm', 'exe', 'pnpm.exe')}`,
    );
  }

  const selected = selectWindowsPnpmExe(exes, pinned, spawnSyncFn);
  // Always drop the silent-exit PowerShell shims so PATH can fall through to .cmd.
  neutralizeBrokenPowershellShims(pnpmHome, { existsSync, unlinkSync, log });

  if (selected && (!pinned || selected.version === pinned)) {
    const exeDir = path.dirname(selected.exe);
    appendFileSync(githubPath, `${exeDir}\n`);
    log(
      `[ci-prefer-windows-pnpm-exe] prepended ${exeDir} (${selected.exe}, pnpm ${selected.version})`,
    );
    return { skipped: false, exeDir, exe: selected.exe, version: selected.version };
  }

  // action-setup self-update refreshes PNPM_HOME .cmd shims to the packageManager
  // pin, but leaves the bootstrap node_modules/pnpm/pnpm.exe stale. Preferring that
  // exe caused "installed pnpm wrapper is missing". With .ps1 removed, PowerShell
  // uses the refreshed .cmd — but only prepend PNPM_HOME (and bin/) after a shim
  // there actually reports the pin via --version.
  if (pinned && selected && selected.version !== pinned) {
    const verified = findPinnedPnpmHomeShim(pnpmHome, pinned, { existsSync, spawnSyncFn });
    if (!verified) {
      throw new Error(
        `[ci-prefer-windows-pnpm-exe] stale pnpm.exe ${selected.version} at ${selected.exe}; no PNPM_HOME/.cmd shim matches packageManager ${pinned}`,
      );
    }
    appendFileSync(githubPath, `${pnpmHome}\n`);
    const binDir = path.join(pnpmHome, 'bin');
    if (existsSync(binDir)) {
      appendFileSync(githubPath, `${binDir}\n`);
    }
    log(
      `[ci-prefer-windows-pnpm-exe] skipped stale pnpm.exe ${selected.version} at ${selected.exe}; prepended PNPM_HOME for packageManager ${pinned} (verified ${verified.shim})`,
    );
    return {
      skipped: false,
      exeDir: pnpmHome,
      reason: 'stale-bootstrap-skipped',
      version: pinned,
    };
  }

  if (!selected) {
    throw new Error(
      `[ci-prefer-windows-pnpm-exe] no working pnpm.exe (probed ${exes.length} path(s)${
        pinned ? `; packageManager ${pinned}` : ''
      }):\n${exes.map((c) => `  ${c}`).join('\n')}`,
    );
  }

  throw new Error(
    '[ci-prefer-windows-pnpm-exe] unexpected pnpm.exe selection state (internal error)',
  );
}

function main() {
  const result = preferWindowsPnpmExe();
  if (result.skipped) {
    console.debug(`[ci-prefer-windows-pnpm-exe] skip (${result.reason ?? 'unknown'})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
