#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'org.coloradomesh.MeshClient.yml');
const PKG = path.join(ROOT, 'package.json');
const SEMVER_PATTERN = /(\d+\.\d+\.\d+)/;
const FETCH_TIMEOUT_MS = 30_000;
const ELECTRON_SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/** Electron release tags must be X.Y.Z — validated before any GitHub fetch (CodeQL file-access-to-http). */
export const SAFE_ELECTRON_SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** pnpm standalone tags must be X.Y.Z (pre-release suffixes are not vendored). */
export const SAFE_PNPM_SEMVER_RE = /^\d+\.\d+\.\d+$/;
const PNPM_SHA256_HEX_RE = /^[a-f0-9]{64}$/;

const PNPM_ARCHIVE_SOURCES_RE =
  / {6}- type: archive\n {8}url: https:\/\/github\.com\/pnpm\/pnpm\/releases\/download\/v[\d.]+\/pnpm-linux-x64\.tar\.gz\n {8}sha256: [a-f0-9]{64}\n {8}dest: pnpm-vendor\n {8}#[^\n]*\n {8}strip-components: 0\n {8}only-arches: \[x86_64\]\n {6}- type: archive\n {8}url: https:\/\/github\.com\/pnpm\/pnpm\/releases\/download\/v[\d.]+\/pnpm-linux-arm64\.tar\.gz\n {8}sha256: [a-f0-9]{64}\n {8}dest: pnpm-vendor\n {8}strip-components: 0\n {8}only-arches: \[aarch64\]/;

const ELECTRON_ARCHIVE_SOURCES_RE =
  / {6}- type: archive\n {8}url: https:\/\/github\.com\/electron\/electron\/releases\/download\/v[\d.]+\/electron-v[\d.]+-linux-x64\.zip\n {8}sha256: [a-f0-9]{64}\n {8}dest: electron-prebuilt\n {8}only-arches: \[x86_64\]\n {6}- type: archive\n {8}url: https:\/\/github\.com\/electron\/electron\/releases\/download\/v[\d.]+\/electron-v[\d.]+-linux-arm64\.zip\n {8}sha256: [a-f0-9]{64}\n {8}dest: electron-prebuilt\n {8}only-arches: \[aarch64\]/;

export function assertSafeElectronSemverVersion(version) {
  if (typeof version !== 'string' || !SAFE_ELECTRON_SEMVER_RE.test(version)) {
    throw new Error(`Electron version must match X.Y.Z (got ${JSON.stringify(version)})`);
  }
  return version;
}

export function electronVersionFromPackage(pkg) {
  if (!pkg) return null;
  const spec = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  if (typeof spec !== 'string') return null;
  const m = spec.match(SEMVER_PATTERN);
  return m?.[1] ?? null;
}

export function parseElectronSha256s(text, version) {
  const safeVersion = assertSafeElectronSemverVersion(version);
  const byZipArch = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-f0-9]{64}) \*electron-v([\d.]+)-linux-(x64|arm64)\.zip$/);
    if (!m || m[2] !== safeVersion) continue;
    byZipArch[m[3]] = m[1];
  }
  if (!byZipArch.x64 || !byZipArch.arm64) {
    throw new Error(
      `Electron v${safeVersion} SHASUMS256.txt missing linux-x64 or linux-arm64 archive checksum`,
    );
  }
  return byZipArch;
}

/** Re-validate checksum map from network parse before manifest write (CodeQL http-to-file-access). */
export function validateElectronSha256ByZipArch(sha256ByZipArch, version) {
  assertSafeElectronSemverVersion(version);
  if (!sha256ByZipArch || typeof sha256ByZipArch !== 'object') {
    throw new Error('Electron SHA256 map must be an object');
  }
  const x64 = sha256ByZipArch.x64;
  const arm64 = sha256ByZipArch.arm64;
  if (typeof x64 !== 'string' || !ELECTRON_SHA256_HEX_RE.test(x64)) {
    throw new Error('Electron linux-x64 checksum must be 64 lowercase hex chars');
  }
  if (typeof arm64 !== 'string' || !ELECTRON_SHA256_HEX_RE.test(arm64)) {
    throw new Error('Electron linux-arm64 checksum must be 64 lowercase hex chars');
  }
  return { x64, arm64 };
}

export function buildElectronArchiveSourcesYaml(version, sha256ByZipArch) {
  const safeVersion = assertSafeElectronSemverVersion(version);
  const validated = validateElectronSha256ByZipArch(sha256ByZipArch, safeVersion);
  const blocks = [
    { zipArch: 'x64', onlyArch: 'x86_64' },
    { zipArch: 'arm64', onlyArch: 'aarch64' },
  ];
  return blocks
    .map(
      ({ zipArch, onlyArch }) => `      - type: archive
        url: https://github.com/electron/electron/releases/download/v${safeVersion}/electron-v${safeVersion}-linux-${zipArch}.zip
        sha256: ${validated[zipArch]}
        dest: electron-prebuilt
        only-arches: [${onlyArch}]`,
    )
    .join('\n');
}

export function syncFlatpakElectronManifest(yaml, version, sha256ByZipArch) {
  if (!ELECTRON_ARCHIVE_SOURCES_RE.test(yaml)) {
    throw new Error(
      'Flatpak manifest missing expected Electron archive source blocks (x64 + arm64)',
    );
  }
  const replacement = buildElectronArchiveSourcesYaml(version, sha256ByZipArch);
  return yaml.replace(ELECTRON_ARCHIVE_SOURCES_RE, replacement);
}

/**
 * Strip dangerous control characters from manifest YAML before writeFileSync.
 * Remote SHASUMS256.txt content becomes file body; preserve TAB/LF/CR for YAML.
 *
 * @param {string} yaml
 * @param {string} version
 * @param {{ x64: string; arm64: string }} sha256ByZipArch
 * @returns {string}
 */
export function sanitizeFlatpakElectronManifestYamlForDisk(yaml, version, sha256ByZipArch) {
  const safeVersion = assertSafeElectronSemverVersion(version);
  const validated = validateElectronSha256ByZipArch(sha256ByZipArch, safeVersion);
  const expectedBlock = buildElectronArchiveSourcesYaml(safeVersion, validated);
  const noCtl = String(yaml).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u2028\u2029]/g, ''); // eslint-disable-line no-control-regex

  const x64Url = `https://github.com/electron/electron/releases/download/v${safeVersion}/electron-v${safeVersion}-linux-x64.zip`;
  const arm64Url = `https://github.com/electron/electron/releases/download/v${safeVersion}/electron-v${safeVersion}-linux-arm64.zip`;
  if (!noCtl.includes(x64Url) || !noCtl.includes(arm64Url)) {
    throw new Error('Flatpak manifest YAML missing expected Electron archive URLs for version');
  }
  if (!noCtl.includes(validated.x64) || !noCtl.includes(validated.arm64)) {
    throw new Error('Flatpak manifest YAML missing validated Electron archive checksums');
  }
  if (!noCtl.includes(expectedBlock)) {
    throw new Error(
      'Flatpak manifest YAML Electron archive block does not match validated checksums',
    );
  }
  return noCtl;
}

export async function fetchElectronSha256s(version, fetchFn = fetch) {
  const safeVersion = assertSafeElectronSemverVersion(version);
  const url = `https://github.com/electron/electron/releases/download/v${safeVersion}/SHASUMS256.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const parsed = parseElectronSha256s(await res.text(), safeVersion);
    return validateElectronSha256ByZipArch(parsed, safeVersion);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out fetching Electron SHASUMS256.txt for v${safeVersion}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function assertSafePnpmSemverVersion(version) {
  if (typeof version !== 'string' || !SAFE_PNPM_SEMVER_RE.test(version)) {
    throw new Error(`pnpm version must match X.Y.Z (got ${JSON.stringify(version)})`);
  }
  return version;
}

/** Corepack `pnpm@VERSION[+sha512…]` — the integrity hash is not part of the release tag. */
export function pnpmVersionFromPackage(pkg) {
  const spec = pkg?.packageManager;
  if (typeof spec !== 'string' || !spec.startsWith('pnpm@')) return null;
  const m = spec.slice('pnpm@'.length).match(SEMVER_PATTERN);
  return m?.[1] ?? null;
}

/** Re-validate checksum map from network parse before manifest write (CodeQL http-to-file-access). */
export function validatePnpmSha256ByArch(sha256ByArch, version) {
  assertSafePnpmSemverVersion(version);
  if (!sha256ByArch || typeof sha256ByArch !== 'object') {
    throw new Error('pnpm SHA256 map must be an object');
  }
  const x64 = sha256ByArch.x64;
  const arm64 = sha256ByArch.arm64;
  if (typeof x64 !== 'string' || !PNPM_SHA256_HEX_RE.test(x64)) {
    throw new Error('pnpm linux-x64 checksum must be 64 lowercase hex chars');
  }
  if (typeof arm64 !== 'string' || !PNPM_SHA256_HEX_RE.test(arm64)) {
    throw new Error('pnpm linux-arm64 checksum must be 64 lowercase hex chars');
  }
  return { x64, arm64 };
}

/** GitHub release assets expose `digest: "sha256:<hex>"` for the standalone tarballs. */
export function parsePnpmSha256s(release, version) {
  const safeVersion = assertSafePnpmSemverVersion(version);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const byArch = {};
  for (const asset of assets) {
    const m = /^pnpm-linux-(x64|arm64)\.tar\.gz$/.exec(String(asset?.name ?? ''));
    if (!m) continue;
    const digest = /^sha256:([a-f0-9]{64})$/.exec(String(asset?.digest ?? ''));
    if (!digest) continue;
    byArch[m[1]] = digest[1];
  }
  if (!byArch.x64 || !byArch.arm64) {
    throw new Error(
      `pnpm v${safeVersion} release is missing a sha256 digest for pnpm-linux-x64.tar.gz or pnpm-linux-arm64.tar.gz`,
    );
  }
  return byArch;
}

export function buildPnpmArchiveSourcesYaml(version, sha256ByArch) {
  const safeVersion = assertSafePnpmSemverVersion(version);
  const validated = validatePnpmSha256ByArch(sha256ByArch, safeVersion);
  const url = (arch) =>
    `https://github.com/pnpm/pnpm/releases/download/v${safeVersion}/pnpm-linux-${arch}.tar.gz`;
  return `      - type: archive
        url: ${url('x64')}
        sha256: ${validated.x64}
        dest: pnpm-vendor
        # pnpm tarball has root-level \`pnpm\` + \`dist/\`; default strip-components:1 drops the binary.
        strip-components: 0
        only-arches: [x86_64]
      - type: archive
        url: ${url('arm64')}
        sha256: ${validated.arm64}
        dest: pnpm-vendor
        strip-components: 0
        only-arches: [aarch64]`;
}

export function syncFlatpakPnpmManifest(yaml, version, sha256ByArch) {
  if (!PNPM_ARCHIVE_SOURCES_RE.test(yaml)) {
    throw new Error('Flatpak manifest missing expected pnpm archive source blocks (x64 + arm64)');
  }
  return yaml.replace(PNPM_ARCHIVE_SOURCES_RE, buildPnpmArchiveSourcesYaml(version, sha256ByArch));
}

/**
 * Strip dangerous control characters from manifest YAML before writeFileSync.
 * Remote release metadata becomes file body; preserve TAB/LF/CR for YAML.
 *
 * @param {string} yaml
 * @param {string} version
 * @param {{ x64: string; arm64: string }} sha256ByArch
 * @returns {string}
 */
export function sanitizeFlatpakPnpmManifestYamlForDisk(yaml, version, sha256ByArch) {
  const safeVersion = assertSafePnpmSemverVersion(version);
  const validated = validatePnpmSha256ByArch(sha256ByArch, safeVersion);
  const expectedBlock = buildPnpmArchiveSourcesYaml(safeVersion, validated);
  const noCtl = String(yaml).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u2028\u2029]/g, ''); // eslint-disable-line no-control-regex

  if (!noCtl.includes(expectedBlock)) {
    throw new Error('Flatpak manifest YAML pnpm archive block does not match validated checksums');
  }
  return noCtl;
}

export async function fetchPnpmSha256s(version, fetchFn = fetch) {
  const safeVersion = assertSafePnpmSemverVersion(version);
  const url = `https://api.github.com/repos/pnpm/pnpm/releases/tags/v${safeVersion}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const parsed = parsePnpmSha256s(await res.json(), safeVersion);
    return validatePnpmSha256ByArch(parsed, safeVersion);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out fetching pnpm release metadata for v${safeVersion}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function syncFlatpakPnpm({
  manifestPath = MANIFEST,
  packagePath = PKG,
  fetchFn = fetch,
  write = true,
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const versionRaw = pnpmVersionFromPackage(pkg);
  if (!versionRaw) {
    throw new Error('package.json is missing a semver pnpm packageManager field');
  }
  const version = assertSafePnpmSemverVersion(versionRaw);

  const yaml = fs.readFileSync(manifestPath, 'utf8');
  // Avoid a network round-trip when the manifest already pins this release.
  if (yaml.includes(`pnpm/pnpm/releases/download/v${version}/`)) {
    return { version, changed: false, yaml };
  }

  const sha256ByArch = await fetchPnpmSha256s(version, fetchFn);
  const nextYaml = syncFlatpakPnpmManifest(yaml, version, sha256ByArch);
  const changed = nextYaml !== yaml;

  if (write && changed) {
    fs.writeFileSync(
      manifestPath,
      sanitizeFlatpakPnpmManifestYamlForDisk(nextYaml, version, sha256ByArch),
      'utf8',
    );
  }

  return { version, changed, yaml: nextYaml };
}

export async function syncFlatpakElectron({
  manifestPath = MANIFEST,
  packagePath = PKG,
  fetchFn = fetch,
  write = true,
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const versionRaw = electronVersionFromPackage(pkg);
  if (!versionRaw) {
    throw new Error('package.json is missing a semver electron devDependency');
  }
  const version = assertSafeElectronSemverVersion(versionRaw);

  const sha256ByZipArch = await fetchElectronSha256s(version, fetchFn);
  const yaml = fs.readFileSync(manifestPath, 'utf8');
  const nextYaml = syncFlatpakElectronManifest(yaml, version, sha256ByZipArch);
  const changed = nextYaml !== yaml;

  if (write && changed) {
    fs.writeFileSync(
      manifestPath,
      sanitizeFlatpakElectronManifestYamlForDisk(nextYaml, version, sha256ByZipArch),
      'utf8',
    );
  }

  return { version, changed, yaml: nextYaml };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const electron = await syncFlatpakElectron({ write: !checkOnly });
  const pnpm = await syncFlatpakPnpm({ write: !checkOnly });

  const results = [
    { label: 'electron', ...electron },
    { label: 'pnpm', ...pnpm },
  ];

  if (checkOnly) {
    const stale = results.filter((r) => r.changed);
    for (const { label, version } of stale) {
      console.error(
        `sync-flatpak-electron: org.coloradomesh.MeshClient.yml is out of sync with ${label} ${version}`,
      );
    }
    process.exit(stale.length > 0 ? 1 : 0);
  }

  for (const { label, version, changed } of results) {
    console.log(
      changed
        ? `sync-flatpak-electron: updated org.coloradomesh.MeshClient.yml for ${label} ${version}`
        : `sync-flatpak-electron: org.coloradomesh.MeshClient.yml already matches ${label} ${version}`,
    );
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`sync-flatpak-electron: ${detail}`);
    process.exit(1);
  });
}
