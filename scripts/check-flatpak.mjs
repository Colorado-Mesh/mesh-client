#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const METAINFO = path.join(ROOT, 'flatpak', 'org.coloradomesh.MeshClient.metainfo.xml');
const DESKTOP = path.join(ROOT, 'flatpak', 'org.coloradomesh.MeshClient.desktop');
const MANIFEST = path.join(ROOT, 'org.coloradomesh.MeshClient.yml');
const WRAPPER = path.join(ROOT, 'flatpak', 'mesh-client-wrapper.sh');
const PKG = path.join(ROOT, 'package.json');
const EXPECTED_APP_ID = 'org.coloradomesh.MeshClient';
const EXPECTED_MAIN = 'dist-electron/main/index.js';
const EXPECTED_ELECTRON = '/app/lib/mesh-client/electron/electron';

function checkMetainfoVersionMatchesPackage() {
  const violations = [];
  if (!fs.existsSync(METAINFO) || !fs.existsSync(PKG)) return violations;

  const pkgVersion = JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
  const xml = fs.readFileSync(METAINFO, 'utf8');
  const rel = path.relative(ROOT, METAINFO);

  const m = xml.match(/<release\s+version="([^"]+)"/);
  if (!m) {
    violations.push({
      file: rel,
      message: '<releases> has no <release> entries — run release.sh or add one manually',
    });
    return violations;
  }

  if (m[1] !== pkgVersion) {
    violations.push({
      file: rel,
      message: `top <release version="${m[1]}"> does not match package.json version "${pkgVersion}" — re-run release.sh or update MetaInfo manually`,
    });
  }
  return violations;
}

function checkMetainfoAppId() {
  const violations = [];
  if (!fs.existsSync(METAINFO)) return violations;

  const xml = fs.readFileSync(METAINFO, 'utf8');
  const m = xml.match(/<id>([^<]+)<\/id>/);
  if (!m) {
    violations.push({ file: path.relative(ROOT, METAINFO), message: 'missing <id> element' });
    return violations;
  }
  if (m[1] !== EXPECTED_APP_ID) {
    violations.push({
      file: path.relative(ROOT, METAINFO),
      message: `<id> is "${m[1]}", expected "${EXPECTED_APP_ID}"`,
    });
  }
  return violations;
}

function checkManifestAppId() {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) {
    violations.push({ file: 'org.coloradomesh.MeshClient.yml', message: 'manifest file missing' });
    return violations;
  }

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const m = yaml.match(/^app-id:\s*(.+)$/m);
  if (!m) {
    violations.push({ file: 'org.coloradomesh.MeshClient.yml', message: 'missing app-id field' });
    return violations;
  }
  if (m[1].trim() !== EXPECTED_APP_ID) {
    violations.push({
      file: 'org.coloradomesh.MeshClient.yml',
      message: `app-id is "${m[1].trim()}", expected "${EXPECTED_APP_ID}"`,
    });
  }
  return violations;
}

function electronVersionFromPackage() {
  if (!fs.existsSync(PKG)) return null;
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const spec = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  if (typeof spec !== 'string') return null;
  const m = spec.match(/(\d+\.\d+\.\d+)/);
  return m?.[1] ?? null;
}

function checkManifestBranchAndElectronPayload() {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) return violations;

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const rel = path.relative(ROOT, MANIFEST);
  const electronVersion = electronVersionFromPackage();

  if (!/^branch:\s*stable\s*$/m.test(yaml)) {
    violations.push({
      file: rel,
      message: 'expected branch: stable (CI bundles should not publish master refs)',
    });
  }

  if (!yaml.includes('electron-prebuilt /app/lib/mesh-client/electron')) {
    violations.push({
      file: rel,
      message: 'manifest must install electron-prebuilt into the app (zypak needs Chromium)',
    });
  }

  if (electronVersion) {
    const releaseUrlPrefix = `electron/electron/releases/download/v${electronVersion}/`;
    if (!yaml.includes(releaseUrlPrefix)) {
      violations.push({
        file: rel,
        message: `manifest electron archive URLs must match package.json electron version ${electronVersion}`,
      });
    }
    if (
      !yaml.includes(`electron-v${electronVersion}-linux-x64.zip`) ||
      !yaml.includes(`electron-v${electronVersion}-linux-arm64.zip`)
    ) {
      violations.push({
        file: rel,
        message: `manifest must vendor electron-v${electronVersion}-linux-{x64,arm64}.zip (offline; pnpm --ignore-scripts)`,
      });
    }
  }

  if (!yaml.includes('resources /app/lib/mesh-client/')) {
    violations.push({
      file: rel,
      message: 'manifest must install resources/ for runtime icon paths',
    });
  }

  return violations;
}

function checkWrapperLaunchPaths() {
  const violations = [];
  if (!fs.existsSync(WRAPPER)) {
    violations.push({ file: path.relative(ROOT, WRAPPER), message: 'wrapper script missing' });
    return violations;
  }

  const sh = fs.readFileSync(WRAPPER, 'utf8');
  const rel = path.relative(ROOT, WRAPPER);

  if (!sh.includes(EXPECTED_MAIN)) {
    violations.push({
      file: rel,
      message: `wrapper must launch ${EXPECTED_MAIN} (package.json "main")`,
    });
  }

  if (!sh.includes(EXPECTED_ELECTRON)) {
    violations.push({
      file: rel,
      message: `wrapper must invoke bundled Chromium at ${EXPECTED_ELECTRON}`,
    });
  }

  if (sh.includes('dist-electron/main.js')) {
    violations.push({
      file: rel,
      message: 'wrapper must not reference dist-electron/main.js (file does not exist)',
    });
  }

  if (sh.includes('/app/electron/electron')) {
    violations.push({
      file: rel,
      message:
        'wrapper must not reference /app/electron/electron (Electron is under lib/mesh-client)',
    });
  }

  if (!sh.includes('MESH_CLIENT_DISABLE_GPU')) {
    violations.push({
      file: rel,
      message:
        'wrapper must set MESH_CLIENT_DISABLE_GPU for vmwgfx (VMware) stacks where Mesa DRI is missing',
    });
  }

  if (!sh.includes('DRIVER=vmwgfx')) {
    violations.push({
      file: rel,
      message: 'wrapper must detect vmwgfx via /sys/class/drm card device uevent',
    });
  }

  if (!sh.includes('MESH_CLIENT_ENABLE_GPU')) {
    violations.push({
      file: rel,
      message: 'wrapper must allow MESH_CLIENT_ENABLE_GPU=1 to opt out of vmwgfx GPU disable',
    });
  }

  return violations;
}

function checkDesktopStartupWMClass() {
  const violations = [];
  if (!fs.existsSync(DESKTOP) || !fs.existsSync(PKG)) return violations;

  const pkgName = JSON.parse(fs.readFileSync(PKG, 'utf8')).name;
  const desktop = fs.readFileSync(DESKTOP, 'utf8');
  const rel = path.relative(ROOT, DESKTOP);

  const m = desktop.match(/^StartupWMClass=(.+)$/m);
  if (!m) {
    violations.push({ file: rel, message: 'missing StartupWMClass entry' });
    return violations;
  }
  if (m[1].trim() !== pkgName) {
    violations.push({
      file: rel,
      message: `StartupWMClass is "${m[1].trim()}", expected "${pkgName}" (package.json name — the WM_CLASS Electron emits under Flatpak/zypak)`,
    });
  }
  return violations;
}

function main() {
  const violations = [
    ...checkMetainfoVersionMatchesPackage(),
    ...checkMetainfoAppId(),
    ...checkManifestAppId(),
    ...checkManifestBranchAndElectronPayload(),
    ...checkWrapperLaunchPaths(),
    ...checkDesktopStartupWMClass(),
  ];

  if (violations.length === 0) {
    process.exit(0);
  }

  console.error('check-flatpak:\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.message}`);
    console.error('');
  }
  process.exit(1);
}

main();
