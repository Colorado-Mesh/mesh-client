#!/usr/bin/env node
/**
 * Fail fast when the local pnpm is below engines.pnpm or the wrong major vs
 * package.json#packageManager. Used from preinstall and pnpm run dev so
 * contributors get an upgrade prompt instead of opaque install/runtime errors.
 *
 * Zero dependencies — safe to run before node_modules exists.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * @param {string} output
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseSemver(output) {
  const match = String(output).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {string | undefined} engine
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseEngineFloor(engine) {
  if (typeof engine !== 'string' || !engine.trim()) return null;
  return parseSemver(engine.replace(/^>=\s*/, ''));
}

/**
 * @param {string | undefined} packageManager
 * @returns {{ name: string, version: string, major: number, minor: number, patch: number } | null}
 */
export function parsePackageManagerField(packageManager) {
  if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) return null;
  const raw = packageManager.slice('pnpm@'.length).split('+', 1)[0];
  const parsed = parseSemver(raw);
  if (!parsed) return null;
  return { name: 'pnpm', version: raw, ...parsed };
}

/**
 * Prefer lifecycle user-agent (set while pnpm runs preinstall/dev) over PATH lookup.
 * Windows `spawnSync('pnpm')` without `shell: true` cannot resolve `.cmd` shims.
 * @param {string | undefined} userAgent
 * @returns {string | null}
 */
export function pnpmVersionFromUserAgent(userAgent) {
  if (typeof userAgent !== 'string' || !userAgent) return null;
  const match = userAgent.match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

/** @returns {boolean} */
export function hasCorepack() {
  const res = spawnSync('corepack', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    // Windows: corepack is a .cmd shim; spawn without shell cannot resolve it.
    shell: process.platform === 'win32',
  });
  return res.status === 0 && !res.error;
}

/**
 * Upgrade steps for wrong/missing pnpm. Node 25+ no longer ships Corepack.
 * @param {string} hintTarget
 * @param {{ corepackAvailable?: boolean }} [options]
 * @returns {string[]}
 */
export function buildPnpmUpgradeHintLines(hintTarget, options = {}) {
  const corepackAvailable =
    options.corepackAvailable !== undefined ? options.corepackAvailable : hasCorepack();
  if (corepackAvailable) {
    return [
      'corepack enable',
      `corepack prepare pnpm@${hintTarget} --activate`,
      'Then re-run your command (e.g. pnpm install or pnpm run dev).',
    ];
  }
  return [
    'npm install -g corepack@latest && corepack enable',
    `corepack prepare pnpm@${hintTarget} --activate`,
    `Or without Corepack: npm install -g pnpm@${hintTarget}`,
    'Then re-run your command (e.g. pnpm install or pnpm run dev).',
  ];
}

/**
 * One-line hint for check-environment (and similar).
 * @param {string} hintTarget
 * @param {{ corepackAvailable?: boolean }} [options]
 * @returns {string}
 */
export function formatPnpmPrepareHint(hintTarget, options = {}) {
  const corepackAvailable =
    options.corepackAvailable !== undefined ? options.corepackAvailable : hasCorepack();
  if (corepackAvailable) {
    return `corepack enable && corepack prepare pnpm@${hintTarget} --activate`;
  }
  return `npm install -g corepack@latest && corepack enable && corepack prepare pnpm@${hintTarget} --activate (or: npm install -g pnpm@${hintTarget})`;
}

/**
 * @param {string | null | undefined} foundVersion
 * @param {{ enginesPnpm?: string, packageManager?: string, corepackAvailable?: boolean }} spec
 * @returns {{ ok: true, found: string } | { ok: false, found: string | null, requiredLabel: string, pinnedVersion: string | null, hintLines: string[] }}
 */
export function evaluatePnpmRequirement(foundVersion, spec) {
  const pin = parsePackageManagerField(spec.packageManager);
  const floor = parseEngineFloor(spec.enginesPnpm) ?? (pin ? { ...pin } : null);
  const pinnedVersion = pin?.version ?? null;
  const requiredLabel = pin
    ? `pnpm ${pin.version} (engines ${spec.enginesPnpm ?? `>=${pin.major}.0.0`})`
    : spec.enginesPnpm
      ? `pnpm ${spec.enginesPnpm}`
      : 'pnpm (see package.json engines / packageManager)';

  const hintTarget =
    pinnedVersion ?? (floor ? `${floor.major}.${floor.minor}.${floor.patch}` : '11');
  const hintLines = buildPnpmUpgradeHintLines(hintTarget, {
    corepackAvailable: spec.corepackAvailable,
  });

  if (!foundVersion) {
    return {
      ok: false,
      found: null,
      requiredLabel,
      pinnedVersion,
      hintLines,
    };
  }

  const found = parseSemver(foundVersion);
  if (!found) {
    return {
      ok: false,
      found: String(foundVersion),
      requiredLabel,
      pinnedVersion,
      hintLines,
    };
  }

  if (floor) {
    const belowFloor =
      found.major < floor.major ||
      (found.major === floor.major && found.minor < floor.minor) ||
      (found.major === floor.major && found.minor === floor.minor && found.patch < floor.patch);
    if (belowFloor) {
      return {
        ok: false,
        found: `${found.major}.${found.minor}.${found.patch}`,
        requiredLabel,
        pinnedVersion,
        hintLines,
      };
    }
  }

  if (pin && found.major !== pin.major) {
    return {
      ok: false,
      found: `${found.major}.${found.minor}.${found.patch}`,
      requiredLabel,
      pinnedVersion,
      hintLines,
    };
  }

  return { ok: true, found: `${found.major}.${found.minor}.${found.patch}` };
}

/**
 * @param {{ ok: boolean, found?: string | null, requiredLabel?: string, hintLines?: string[] }} result
 * @returns {string}
 */
export function formatPnpmUpgradeMessage(result) {
  if (result.ok) return '';
  const lines = [
    '',
    '════════════════════════════════════════════════════════',
    '  pnpm upgrade required',
    '',
    `  This repo requires ${result.requiredLabel}.`,
    `  You have: ${result.found ?? 'not found'}`,
    '',
    '  Run:',
    ...(result.hintLines ?? []).map((line) => `    ${line}`),
    '════════════════════════════════════════════════════════',
    '',
  ];
  return lines.join('\n');
}

function readPackageJson(root = repoRoot) {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
}

function currentPnpmVersion() {
  const fromUa = pnpmVersionFromUserAgent(process.env.npm_config_user_agent);
  if (fromUa) return fromUa;

  const res = spawnSync('pnpm', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    // Windows: pnpm/action-setup and Corepack install .cmd shims; without shell,
    // spawnSync cannot find them and preinstall reports "You have: not found".
    shell: process.platform === 'win32',
  });
  if (res.error || res.status !== 0) return null;
  return String(res.stdout || '').trim() || null;
}

/**
 * @param {{ repoRoot?: string, foundVersion?: string | null }} [options]
 * @returns {number} process exit code
 */
export function assertPnpmMeetsRepoRequirement(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const pkg = readPackageJson(root);
  const foundVersion =
    options.foundVersion !== undefined ? options.foundVersion : currentPnpmVersion();
  const result = evaluatePnpmRequirement(foundVersion, {
    enginesPnpm: pkg.engines?.pnpm,
    packageManager: pkg.packageManager,
  });
  if (result.ok) return 0;
  process.stderr.write(formatPnpmUpgradeMessage(result));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(assertPnpmMeetsRepoRequirement());
}
