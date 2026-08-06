#!/usr/bin/env node
/**
 * Rename test-build installer artifacts to include `-run{GITHUB_RUN_NUMBER}`.
 *
 * Gate: MESH_CLIENT_BUILD_CHANNEL=test (or buildInfo.channel=test) with a finite runNumber.
 * Official release / local builds: no-op.
 *
 * Pure helpers exported for unit tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** @type {ReadonlySet<string>} */
const INSTALLER_EXTENSIONS = new Set([
  '.AppImage',
  '.deb',
  '.rpm',
  '.dmg',
  '.zip',
  '.flatpak',
  '.exe',
]);

/**
 * @param {number} runNumber
 * @returns {string}
 */
export function buildRunStampSuffix(runNumber) {
  if (!Number.isFinite(runNumber) || runNumber < 0 || !Number.isInteger(runNumber)) {
    throw new Error(`Invalid runNumber for stamp: ${String(runNumber)}`);
  }
  return `-run${runNumber}`;
}

/**
 * @param {string} name basename
 * @returns {boolean}
 */
export function hasRunStamp(name) {
  return /-run\d+/.test(name);
}

/**
 * @param {string} name basename
 * @returns {boolean}
 */
export function shouldRenameInstaller(name) {
  if (!name || name.startsWith('.')) return false;
  if (name.startsWith('READ-ME-FIRST')) return false;
  if (name.includes('blockmap') || name.endsWith('.blockmap')) return false;
  if (name === 'Mesh-client.exe') return false;
  if (name.includes('__uninstaller')) return false;

  const ext = path.extname(name);
  if (!INSTALLER_EXTENSIONS.has(ext)) return false;

  if (ext === '.exe') {
    return name.startsWith('Mesh-client Setup ');
  }
  return true;
}

/**
 * Insert `-run{N}` before the extension, keeping known arch suffixes after the stamp.
 *
 * @param {string} name basename
 * @param {number} runNumber
 * @returns {string}
 */
export function stampedInstallerName(name, runNumber) {
  if (hasRunStamp(name)) return name;
  const stamp = buildRunStampSuffix(runNumber);

  /** @type {RegExp[]} */
  const archBeforeExt = [
    /^(.+)(-arm64)(\.[^.]+)$/i,
    /^(.+)(-aarch64)(\.[^.]+)$/i,
    /^(.+)(_amd64)(\.[^.]+)$/i,
    /^(.+)(_arm64)(\.[^.]+)$/i,
    /^(.+)(\.x86_64)(\.[^.]+)$/i,
    /^(.+)(\.aarch64)(\.[^.]+)$/i,
  ];
  for (const re of archBeforeExt) {
    const m = name.match(re);
    if (m) {
      return `${m[1]}${stamp}${m[2]}${m[3]}`;
    }
  }

  const ext = path.extname(name);
  if (!ext) {
    return `${name}${stamp}`;
  }
  const base = name.slice(0, -ext.length);
  return `${base}${stamp}${ext}`;
}

/**
 * @param {string | undefined} raw
 * @returns {{ channel?: string, runNumber?: number }}
 */
export function parseBuildInfoEnv(raw) {
  if (raw == null || String(raw).trim() === '') return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('MESH_CLIENT_BUILD_INFO must be a JSON object');
    }
    /** @type {{ channel?: string, runNumber?: number }} */
    const out = {};
    if (typeof parsed.channel === 'string') out.channel = parsed.channel;
    if (typeof parsed.runNumber === 'number' && Number.isFinite(parsed.runNumber)) {
      out.runNumber = Math.floor(parsed.runNumber);
    } else if (parsed.runNumber != null && parsed.runNumber !== '') {
      const n = Number(parsed.runNumber);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid runNumber in MESH_CLIENT_BUILD_INFO: ${String(parsed.runNumber)}`);
      }
      out.runNumber = Math.floor(n);
    }
    return out;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Invalid MESH_CLIENT_BUILD_INFO JSON: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

/**
 * @param {{
 *   channel?: string
 *   runNumber?: number
 *   buildInfoRaw?: string
 * }} opts
 * @returns {{ channel: string, runNumber: number } | null}
 */
export function resolveTestRenameStamp(opts) {
  const fromEnv = parseBuildInfoEnv(opts.buildInfoRaw);
  const channel = (opts.channel ?? fromEnv.channel ?? '').trim();
  if (channel !== 'test') {
    return null;
  }
  const runNumber = opts.runNumber ?? fromEnv.runNumber;
  if (runNumber == null || !Number.isFinite(runNumber)) {
    throw new Error(
      'MESH_CLIENT_BUILD_CHANNEL=test requires a finite runNumber (MESH_CLIENT_BUILD_INFO.runNumber)',
    );
  }
  return { channel: 'test', runNumber: Math.floor(runNumber) };
}

/**
 * @param {string} dir
 * @param {{ recursive?: boolean }} [opts]
 * @returns {string[]} absolute file paths
 */
export function listInstallerFiles(dir, opts = {}) {
  const recursive = opts.recursive !== false;
  if (!fs.existsSync(dir)) return [];

  /** @type {string[]} */
  const out = [];

  /**
   * @param {string} current
   */
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldRenameInstaller(entry.name)) {
        out.push(full);
      }
    }
  }

  walk(dir);
  return out.sort();
}

/**
 * @param {{
 *   rootDir: string
 *   channel?: string
 *   runNumber?: number
 *   buildInfoRaw?: string
 *   recursive?: boolean
 *   dryRun?: boolean
 * }} opts
 * @returns {{ renamed: Array<{ from: string, to: string }>, skipped: boolean, reason?: string }}
 */
export function renameTestBuildArtifacts(opts) {
  const stamp = resolveTestRenameStamp({
    channel: opts.channel,
    runNumber: opts.runNumber,
    buildInfoRaw: opts.buildInfoRaw,
  });
  if (!stamp) {
    return { renamed: [], skipped: true, reason: 'channel-not-test' };
  }

  const files = listInstallerFiles(opts.rootDir, { recursive: opts.recursive });
  /** @type {Array<{ from: string, to: string }>} */
  const renamed = [];

  for (const from of files) {
    const base = path.basename(from);
    const next = stampedInstallerName(base, stamp.runNumber);
    if (next === base) continue;
    const to = path.join(path.dirname(from), next);
    if (fs.existsSync(to)) {
      throw new Error(`Refusing to overwrite existing file: ${to}`);
    }
    if (!opts.dryRun) {
      fs.renameSync(from, to);
    }
    renamed.push({ from, to });
  }

  return { renamed, skipped: false };
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseRenameCliArgs(argv, env = process.env) {
  /** @type {{ rootDir: string, recursive: boolean, dryRun: boolean, flatpakCwd: boolean, help: boolean }} */
  const out = {
    rootDir: path.join(ROOT, 'release'),
    recursive: true,
    dryRun: false,
    flatpakCwd: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const next = argv[++i];
      if (!next) throw new Error('--root requires a directory');
      out.rootDir = path.resolve(next);
    } else if (arg === '--flatpak') {
      out.flatpakCwd = true;
      const maybeDir = argv[i + 1];
      if (maybeDir && !maybeDir.startsWith('-')) {
        out.rootDir = path.resolve(maybeDir);
        i++;
      } else {
        out.rootDir = path.resolve(process.cwd());
      }
      out.recursive = false;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    ...out,
    channel: env.MESH_CLIENT_BUILD_CHANNEL,
    buildInfoRaw: env.MESH_CLIENT_BUILD_INFO,
  };
}

function main() {
  const parsed = parseRenameCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(
      'Usage: node scripts/rename-test-build-artifacts.mjs [--root dir] [--flatpak [dir]] [--dry-run]\n',
    );
    return;
  }

  if (parsed.flatpakCwd) {
    // Only touch Flatpak bundles in the given directory (non-recursive).
    const files = fs
      .readdirSync(parsed.rootDir)
      .filter((n) => n.endsWith('.flatpak') && shouldRenameInstaller(n));
    const stamp = resolveTestRenameStamp({
      channel: parsed.channel,
      buildInfoRaw: parsed.buildInfoRaw,
    });
    if (!stamp) {
      console.debug('[rename-test-build-artifacts] skip (channel-not-test)');
      return;
    }
    /** @type {Array<{ from: string, to: string }>} */
    const renamed = [];
    for (const name of files) {
      const from = path.join(parsed.rootDir, name);
      const next = stampedInstallerName(name, stamp.runNumber);
      if (next === name) continue;
      const to = path.join(parsed.rootDir, next);
      if (fs.existsSync(to)) {
        throw new Error(`Refusing to overwrite existing file: ${to}`);
      }
      if (!parsed.dryRun) fs.renameSync(from, to);
      renamed.push({ from, to });
    }
    console.debug(
      `[rename-test-build-artifacts] flatpak renamed ${renamed.length} file(s) run=${stamp.runNumber}`,
    );
    for (const r of renamed) {
      console.debug(`  ${path.basename(r.from)} → ${path.basename(r.to)}`);
    }
    return;
  }

  const result = renameTestBuildArtifacts({
    rootDir: parsed.rootDir,
    channel: parsed.channel,
    buildInfoRaw: parsed.buildInfoRaw,
    recursive: parsed.recursive,
    dryRun: parsed.dryRun,
  });
  if (result.skipped) {
    console.debug(`[rename-test-build-artifacts] skip (${result.reason ?? 'unknown'})`);
    return;
  }
  console.debug(`[rename-test-build-artifacts] renamed ${result.renamed.length} file(s)`);
  for (const r of result.renamed) {
    console.debug(`  ${path.relative(ROOT, r.from)} → ${path.relative(ROOT, r.to)}`);
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
