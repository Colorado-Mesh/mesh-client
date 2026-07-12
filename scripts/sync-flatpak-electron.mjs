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
  const { version, changed } = await syncFlatpakElectron({ write: !checkOnly });

  if (checkOnly) {
    if (changed) {
      console.error(
        `sync-flatpak-electron: org.coloradomesh.MeshClient.yml is out of sync with electron ${version}`,
      );
      process.exit(1);
    }
    process.exit(0);
  }

  if (changed) {
    console.log(
      `sync-flatpak-electron: updated org.coloradomesh.MeshClient.yml for electron ${version}`,
    );
  } else {
    console.log(
      `sync-flatpak-electron: org.coloradomesh.MeshClient.yml already matches electron ${version}`,
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
