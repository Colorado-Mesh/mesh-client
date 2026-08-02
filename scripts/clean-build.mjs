#!/usr/bin/env node
/**
 * Cross-platform build-artifact cleanup (linux / darwin / win32).
 *
 * `pnpm run clean:build`      — shallow: remove build dists, test output, and caches.
 * `pnpm run clean:build:full` — full: also remove node_modules + Reticulum sidecar build
 *                               output, then reinstall dependencies and rebuild the sidecar
 *                               so the developer environment is left in a working state.
 *
 * Both always prompt for confirmation (`[y/N]`, default No) before deleting anything.
 * Pass `-y` / `--yes` to skip the prompt (the planned removals are still printed).
 * If stdin is not a TTY (e.g. CI) and `-y` is not given, this aborts instead of hanging.
 *
 * Safety: only a fixed allowlist of paths is removed, always resolved under the repo root
 * and asserted to stay inside it. Symlinks are removed as links, never followed.
 */
import { lstatSync, rmSync } from 'fs';
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';
import { dirname, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tier 1 — build dists, test output, caches. Safe to remove with deps + sidecar intact. */
const TIER1_PATHS = [
  'dist',
  'dist-electron',
  'release',
  'coverage',
  '.vitest-reports',
  'test-results',
  'playwright-report',
  '.eslintcache',
].map((name) => ({ name, tier: 1 }));

/** Tier 2 — dependency install + sidecar build output (recreated by `--full`). */
const TIER2_PATHS = [
  'node_modules',
  'reticulum-sidecar/target',
  'resources/reticulum-sidecar/staged',
  'resources/reticulum-sidecar/mesh-client-reticulum',
  'resources/reticulum-sidecar/mesh-client-reticulum.exe',
].map((name) => ({ name, tier: 2 }));

const ALL_PATHS = [...TIER1_PATHS, ...TIER2_PATHS];

/**
 * True when `p` exists as a real file/dir or symlink (including a dangling link); false only
 * for ENOENT. Uses lstat so symlinks are never followed for the existence decision — this is
 * important both for cleanup checks (a left-over dangling symlink is still present and should
 * be removed) and for reinstall detection on tier-2 paths.
 * @param {string} p
 */
export function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch (err) {
    return !(err && err.code === 'ENOENT');
  }
}

/** @param {string} p @returns {boolean} */
function lstatIsSymbolicLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Resolve allowlist paths under rootDir, asserting each stays inside it. Throws on escape so
 * an allowlist mistake can never delete outside the repo. It also rejects any symbolic-link
 * *ancestor* between rootDir and the leaf: removing a path whose parent is a symlink would
 * follow that link and delete outside the repo, so such entries are refused up front. The
 * leaf itself may be a symlink, since `rm` removes a link without following it.
 * @param {string} rootDir
 * @param {Array<{name: string, tier: 1 | 2}>} entries
 * @returns {Array<{name: string, abs: string, tier: 1 | 2}>}
 */
export function resolvePaths(rootDir, entries) {
  const resolved = entries.map(({ name, tier }) => ({
    name,
    tier,
    abs: resolve(rootDir, ...name.split('/')),
  }));
  for (const entry of resolved) {
    const rel = relative(rootDir, entry.abs);
    const inside = rel === '' || (!rel.startsWith(`..${sep}`) && !rel.startsWith('..'));
    if (!inside) {
      throw new Error(
        `clean-build: refusing to touch '${entry.name}' (resolves to '${entry.abs}', outside repo root '${rootDir}')`,
      );
    }
    const parts = entry.name.split('/');
    let current = rootDir;
    for (let i = 0; i < parts.length - 1; i++) {
      current = resolve(current, parts[i]);
      if (lstatIsSymbolicLink(current)) {
        throw new Error(
          `clean-build: refusing to follow symlink ancestor '${current}' (entry '${entry.name}')`,
        );
      }
    }
  }
  return resolved;
}

/** @param {boolean} full @param {ReturnType<typeof resolvePaths>} resolved */
export function filterPaths(full, resolved) {
  return resolved.filter((e) => (full ? true : e.tier === 1));
}

/**
 * Decide whether `--full` should reinstall afterwards. Reinstall only runs when a tier-2
 * path was actually present (so an already-clean tree skips the slow rebuild).
 * @param {boolean} full @param {ReturnType<typeof resolvePaths>} resolved */
export function planReinstall(full, resolved) {
  const tier2Present = resolved.some((e) => e.tier === 2 && pathExists(e.abs));
  return { install: full && tier2Present, sidecar: full && tier2Present };
}

/** @param {NodeJS.WriteStream} out @param {boolean} full @param {Array<{name: string}>} removals @param {{install: boolean; sidecar: boolean}} reinstall */
export function printPlan(out, full, removals, reinstall) {
  out.write(
    full
      ? 'This will remove:\n'
      : 'This will remove (node_modules and the Reticulum sidecar are kept):\n',
  );
  for (const r of removals) out.write(`  - ${r.name}\n`);
  if (reinstall.install) {
    out.write('After removal, a working environment will be restored:\n');
    if (reinstall.sidecar) out.write('  - pnpm install\n');
    if (reinstall.sidecar) out.write('  - pnpm run reticulum:sidecar:build\n');
  }
}

/** @param {string[]} argv */
export function parseFlags(argv = process.argv.slice(2)) {
  const flags = { full: false, yes: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--full') flags.full = true;
    else if (arg === '-y' || arg === '--yes') flags.yes = true;
    else throw new Error(`clean-build: unknown argument '${arg}'`);
  }
  return flags;
}

/**
 * Prompt for confirmation; true only on an explicit `y`/`Y`. Returns false when stdin is not
 * a TTY and `yes` is false, so non-interactive runs never hang on a prompt.
 * @param {NodeJS.ReadStream} inStream @param {NodeJS.WriteStream} outStream @param {boolean} yes
 * @returns {Promise<boolean>}
 */
export function confirmProceed(inStream, outStream, yes) {
  if (yes) return Promise.resolve(true);
  const isTty = Boolean(inStream && typeof inStream.isTTY === 'boolean' && inStream.isTTY);
  if (!isTty) return Promise.resolve(false);
  const rl = createInterface({ input: inStream, output: outStream });
  return new Promise((resolvePromise) => {
    rl.question('Proceed? [y/N] ', (answer) => {
      rl.close();
      resolvePromise(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Run a command. On win32 the command is routed through the shell so `.cmd`/`.bat` shims such
 * as `pnpm.cmd` are resolvable (Node spawnSync with shell:false cannot execute them); all other
 * platforms use shell:false to avoid shell interpolation.
 * @param {string[]} cmd @param {string} cwd @param {string} platform @param {(cmd: string, args: string[], opts: object) => {status?: number|null; error?: Error}} spawnFn
 */
export function runCmd(cmd, cwd, platform = process.platform, spawnFn = spawnSync) {
  const res = spawnFn(cmd[0], cmd.slice(1), { stdio: 'inherit', cwd, shell: platform === 'win32' });
  return res.status ?? (res.error ? 1 : 0);
}

/** @param {Array<{name: string, abs: string, tier: 1 | 2}>} resolved */
export function existingPaths(resolved) {
  return resolved.filter((e) => pathExists(e.abs));
}

/**
 * @param {string} rootDir @param {string[]} argv
 * @param {{stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; run?: (cmd: string[], cwd: string) => number}} io
 * @returns {Promise<{removed: string[], reinstalled: boolean}>}
 */
export async function runClean(rootDir = repoRoot, argv = process.argv.slice(2), io = {}) {
  const { stdin = process.stdin, stdout = process.stdout, run = runCmd } = io;
  const flags = parseFlags(argv);

  const paths = resolvePaths(rootDir, ALL_PATHS);
  const candidates = filterPaths(flags.full, paths);
  const existing = existingPaths(paths);
  const reinstall = planReinstall(flags.full, existing);

  printPlan(stdout, flags.full, candidates, reinstall);

  if (!(await confirmProceed(stdin, stdout, flags.yes))) {
    stdout.write('Aborted — nothing removed.\n');
    return { removed: [], reinstalled: false };
  }

  const removed = [];
  for (const entry of candidates) {
    if (!pathExists(entry.abs)) continue;
    rmSync(entry.abs, { recursive: true, force: true });
    removed.push(entry.name);
    stdout.write(`removed ${entry.name}\n`);
  }

  if (reinstall.install && removed.length > 0) {
    stdout.write('Restoring working environment…\n');
    const installOk = run(['pnpm', 'install'], rootDir) === 0;
    if (!installOk) {
      throw restorationError(
        'clean-build: `pnpm install` failed — dependencies not restored.',
        removed,
      );
    }
    let sidecarOk = true;
    if (reinstall.sidecar) {
      sidecarOk = run(['pnpm', 'run', 'reticulum:sidecar:build'], rootDir) === 0;
      if (!sidecarOk) {
        throw restorationError(
          'clean-build: sidecar rebuild failed (is cargo installed?) — Reticulum may be unavailable.',
          removed,
        );
      }
    }
    return { removed, reinstalled: sidecarOk };
  }

  return { removed, reinstalled: false };
}

/**
 * Build the error thrown when a `--full` restoration fails. Carries the already-removed paths
 * so a caller can report what was cleaned even though the restore did not complete.
 * @param {string} message @param {string[]} removed @returns {Error & {code: string, removed: string[]}}
 */
export function restorationError(message, removed) {
  const err = new Error(message);
  err.code = 'RESTORE_FAILED';
  err.removed = removed;
  return err;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runClean().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
