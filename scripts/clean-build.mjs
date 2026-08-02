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
import { existsSync, rmSync } from 'fs';
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
 * Resolve allowlist paths under rootDir, asserting each stays inside it. Throws on escape so
 * an allowlist mistake can never delete outside the repo.
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
  const tier2Present = resolved.some((e) => e.tier === 2 && existsSync(e.abs));
  return { install: full && tier2Present, sidecar: full && tier2Present };
}

/** @param {boolean} full @param {Array<{name: string}>} removals @param {{install: boolean; sidecar: boolean}} reinstall */
export function printPlan(full, removals, reinstall) {
  console.log(
    full
      ? 'This will remove:'
      : 'This will remove (node_modules and the Reticulum sidecar are kept):',
  );
  for (const r of removals) console.log(`  - ${r.name}`);
  if (reinstall.install) {
    console.log('After removal, a working environment will be restored:');
    if (reinstall.sidecar) console.log('  - pnpm install');
    if (reinstall.sidecar) console.log('  - pnpm run reticulum:sidecar:build');
  }
}

/** @param {string[]} argv */
export function parseFlags(argv = process.argv.slice(2)) {
  const flags = { full: false, yes: false };
  for (const arg of argv) {
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

/** @param {string[]} cmd @param {string} cwd */
export function runCmd(cmd, cwd) {
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', cwd, shell: false });
  return res.status ?? (res.error ? 1 : 0);
}

/** @param {Array<{name: string, abs: string, tier: 1 | 2}>} resolved */
export function existingPaths(resolved) {
  return resolved.filter((e) => existsSync(e.abs));
}

/**
 * @param {string} rootDir @param {string[]} argv
 * @param {{stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream; run?: (cmd: string[], cwd: string) => number}} io
 * @returns {Promise<{removed: string[], reinstalled: boolean}>}
 */
export async function runClean(rootDir = repoRoot, argv = process.argv.slice(2), io = {}) {
  const {
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    run = runCmd,
  } = io;
  const flags = parseFlags(argv);

  const paths = resolvePaths(rootDir, ALL_PATHS);
  const candidates = filterPaths(flags.full, paths);
  const existing = existingPaths(paths);
  const reinstall = planReinstall(flags.full, existing);

  printPlan(flags.full, candidates, reinstall);

  if (!(await confirmProceed(stdin, stdout, flags.yes))) {
    stdout.write('Aborted — nothing removed.\n');
    return { removed: [], reinstalled: false };
  }

  const removed = [];
  for (const entry of candidates) {
    if (!existsSync(entry.abs)) continue;
    rmSync(entry.abs, { recursive: true, force: true });
    removed.push(entry.name);
    stdout.write(`removed ${entry.name}\n`);
  }

  if (reinstall.install && removed.length > 0) {
    stdout.write('Restoring working environment…\n');
    const installOk = run(['pnpm', 'install'], rootDir) === 0;
    let sidecarOk = true;
    if (installOk && reinstall.sidecar) {
      sidecarOk = run(['pnpm', 'run', 'reticulum:sidecar:build'], rootDir) === 0;
    }
    if (!installOk) {
      stderr.write('clean-build: `pnpm install` failed — dependencies not restored.\n');
    } else if (!sidecarOk) {
      stderr.write(
        'clean-build: sidecar rebuild failed (is cargo installed?) — Reticulum may be unavailable.\n',
      );
    }
    return { removed, reinstalled: installOk && sidecarOk };
  }

  return { removed, reinstalled: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runClean().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
