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

const ELECTRON_ARCHIVE_SOURCES_RE =
  / {6}- type: archive\n {8}url: https:\/\/github\.com\/electron\/electron\/releases\/download\/v[\d.]+\/electron-v[\d.]+-linux-x64\.zip\n {8}sha256: [a-f0-9]{64}\n {8}dest: electron-prebuilt\n {8}only-arches: \[x86_64\]\n {6}- type: archive\n {8}url: https:\/\/github\.com\/electron\/electron\/releases\/download\/v[\d.]+\/electron-v[\d.]+-linux-arm64\.zip\n {8}sha256: [a-f0-9]{64}\n {8}dest: electron-prebuilt\n {8}only-arches: \[aarch64\]/;

export function electronVersionFromPackage(pkg) {
  if (!pkg) return null;
  const spec = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  if (typeof spec !== 'string') return null;
  const m = spec.match(SEMVER_PATTERN);
  return m?.[1] ?? null;
}

export function parseElectronSha256s(text, version) {
  const byZipArch = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-f0-9]{64}) \*electron-v([\d.]+)-linux-(x64|arm64)\.zip$/);
    if (!m || m[2] !== version) continue;
    byZipArch[m[3]] = m[1];
  }
  if (!byZipArch.x64 || !byZipArch.arm64) {
    throw new Error(
      `Electron v${version} SHASUMS256.txt missing linux-x64 or linux-arm64 archive checksum`,
    );
  }
  return byZipArch;
}

export function buildElectronArchiveSourcesYaml(version, sha256ByZipArch) {
  const blocks = [
    { zipArch: 'x64', onlyArch: 'x86_64' },
    { zipArch: 'arm64', onlyArch: 'aarch64' },
  ];
  return blocks
    .map(
      ({ zipArch, onlyArch }) => `      - type: archive
        url: https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-linux-${zipArch}.zip
        sha256: ${sha256ByZipArch[zipArch]}
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

export async function fetchElectronSha256s(version, fetchFn = fetch) {
  const url = `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return parseElectronSha256s(await res.text(), version);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out fetching Electron SHASUMS256.txt for v${version}`, {
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
  const version = electronVersionFromPackage(pkg);
  if (!version) {
    throw new Error('package.json is missing a semver electron devDependency');
  }

  const sha256ByZipArch = await fetchElectronSha256s(version, fetchFn);
  const yaml = fs.readFileSync(manifestPath, 'utf8');
  const nextYaml = syncFlatpakElectronManifest(yaml, version, sha256ByZipArch);
  const changed = nextYaml !== yaml;

  if (write && changed) {
    fs.writeFileSync(manifestPath, nextYaml, 'utf8');
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
