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
const SEMVER_PATTERN = /(\d+\.\d+\.\d+)/;

/** Corepack `pnpm@VERSION[+sha512…]` — pre-release suffixes allowed; + integrity hash stripped. */
function pnpmVersionFromPackage(pkg) {
  if (!pkg) return null;
  const spec = pkg.packageManager;
  if (typeof spec !== 'string' || !spec.startsWith('pnpm@')) return null;
  const raw = spec.slice('pnpm@'.length);
  const version = raw.split('+', 1)[0];
  if (!/^\d+\.\d+\.\d+/.test(version)) return null;
  return version;
}

function loadPackageJson() {
  if (!fs.existsSync(PKG)) return null;
  try {
    return JSON.parse(fs.readFileSync(PKG, 'utf8'));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(
      `check-flatpak: Failed to parse package.json or missing version field (${detail})`,
    );
    process.exit(1);
  }
}

const PKG_JSON = loadPackageJson();

function checkMetainfoVersionMatchesPackage(pkg) {
  const violations = [];
  if (!fs.existsSync(METAINFO) || !pkg) return violations;

  const pkgVersion = pkg.version;
  if (typeof pkgVersion !== 'string' || !pkgVersion) {
    violations.push({
      file: path.relative(ROOT, PKG),
      message: 'package.json is missing a valid "version" field',
    });
    return violations;
  }
  const xml = fs.readFileSync(METAINFO, 'utf8');
  const rel = path.relative(ROOT, METAINFO);

  const m = xml.match(/<release\s+version="([^"]+)"/);
  if (!m) {
    violations.push({
      file: rel,
      message: '<releases> has no <release> entries — run `pnpm run release` or add one manually',
    });
    return violations;
  }

  if (m[1] !== pkgVersion) {
    violations.push({
      file: rel,
      message: `top <release version="${m[1]}"> does not match package.json version "${pkgVersion}" — re-run \`pnpm run release\` or update MetaInfo manually`,
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

function electronVersionFromPackage(pkg) {
  if (!pkg) return null;
  const spec = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  if (typeof spec !== 'string') return null;
  const m = spec.match(SEMVER_PATTERN);
  return m?.[1] ?? null;
}

function checkManifestPnpmVersion(pkg) {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) return violations;

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const rel = path.relative(ROOT, MANIFEST);
  const pnpmVersion = pnpmVersionFromPackage(pkg);

  if (!pnpmVersion) return violations;

  const releaseUrlPrefix = `pnpm/pnpm/releases/download/v${pnpmVersion}/`;
  if (!yaml.includes(releaseUrlPrefix)) {
    violations.push({
      file: rel,
      message: `manifest pnpm standalone URLs must match package.json packageManager (${pnpmVersion}); offline install fetches @pnpm/exe when versions differ`,
    });
  }

  return violations;
}

function checkManifestBranchAndElectronPayload(pkg) {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) return violations;

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const rel = path.relative(ROOT, MANIFEST);
  const electronVersion = electronVersionFromPackage(pkg);

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

  if (!yaml.includes('ELECTRON_OZONE_PLATFORM_HINT=auto')) {
    violations.push({
      file: rel,
      message: 'manifest finish-args must set ELECTRON_OZONE_PLATFORM_HINT=auto for Wayland/X11',
    });
  }

  return violations;
}

function checkManifestReticulumSidecarPayload() {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) return violations;

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const rel = path.relative(ROOT, MANIFEST);

  if (!yaml.includes('cp -a dist dist-electron node_modules resources /app/lib/mesh-client/')) {
    violations.push({
      file: rel,
      message:
        'manifest must copy resources/ into /app/lib/mesh-client/ (Reticulum sidecar under resources/reticulum-sidecar/)',
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
      message: `wrapper must reference ${EXPECTED_MAIN} (package.json "main") for preflight`,
    });
  }

  if (!sh.includes('mkdir -p "$TMPDIR"')) {
    violations.push({
      file: rel,
      message: 'wrapper must mkdir -p TMPDIR under XDG_RUNTIME_DIR/app/$FLATPAK_ID',
    });
  }

  if (!sh.includes('CHROME_WRAPPER=/app/bin/mesh-client')) {
    violations.push({
      file: rel,
      message: 'wrapper must set CHROME_WRAPPER=/app/bin/mesh-client for zypak re-exec',
    });
  }

  if (!sh.includes('--disable-setuid-sandbox')) {
    violations.push({
      file: rel,
      message: 'wrapper must pass --disable-setuid-sandbox (zypak owns Chromium sandboxing)',
    });
  }

  if (!sh.includes('XDG_SESSION_TYPE') || !sh.includes('--ozone-platform-hint=wayland')) {
    violations.push({
      file: rel,
      message: 'wrapper must pass --ozone-platform-hint=wayland when XDG_SESSION_TYPE is wayland',
    });
  }

  if (!/exec zypak-wrapper[^\n]* \. "\$@"/.test(sh)) {
    violations.push({
      file: rel,
      message: 'wrapper must launch via zypak-wrapper … . "$@" from APP_ROOT (package.json dir)',
    });
  }

  if (sh.includes('dist-electron/main/index.js "$@"')) {
    violations.push({
      file: rel,
      message:
        'wrapper must not pass dist-electron/main/index.js as argv; launch with "." from APP_ROOT',
    });
  }

  if (!sh.includes(EXPECTED_ELECTRON) && !sh.includes('${APP_ROOT}/electron/electron')) {
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
        'wrapper must set MESH_CLIENT_DISABLE_GPU for vmwgfx (virtualized) stacks where Mesa DRI is missing',
    });
  }

  if (!sh.includes('DRIVER=vmwgfx')) {
    violations.push({
      file: rel,
      message: 'wrapper must detect vmwgfx via /sys/class/drm card device uevent',
    });
  }

  if (!sh.includes('--disable-gpu')) {
    violations.push({
      file: rel,
      message:
        'wrapper must pass --disable-gpu to Electron when MESH_CLIENT_DISABLE_GPU=1 (Chromium startup flags)',
    });
  }

  if (!sh.includes('MESH_CLIENT_ENABLE_GPU')) {
    violations.push({
      file: rel,
      message: 'wrapper must allow MESH_CLIENT_ENABLE_GPU=1 to opt out of vmwgfx GPU disable',
    });
  }

  if (!sh.includes('MESH_CLIENT_DISABLE_GPU:-}" != "0"')) {
    violations.push({
      file: rel,
      message: 'wrapper must allow MESH_CLIENT_DISABLE_GPU=0 to opt out of vmwgfx auto-detection',
    });
  }

  if (sh.includes('uname -m') && (sh.includes('aarch64') || sh.includes('arm64'))) {
    violations.push({
      file: rel,
      message:
        'wrapper must not disable GPU by CPU arch only; aarch64 and x86_64 should use the same graphics defaults',
    });
  }

  return violations;
}

function checkDesktopStartupWMClass(pkg) {
  const violations = [];
  if (!fs.existsSync(DESKTOP) || !pkg) return violations;

  const pkgName = pkg.name;
  if (typeof pkgName !== 'string' || !pkgName) {
    violations.push({
      file: path.relative(ROOT, PKG),
      message: 'package.json is missing a valid "name" field',
    });
    return violations;
  }
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
    ...checkMetainfoVersionMatchesPackage(PKG_JSON),
    ...checkMetainfoAppId(),
    ...checkManifestAppId(),
    ...checkManifestPnpmVersion(PKG_JSON),
    ...checkManifestBranchAndElectronPayload(PKG_JSON),
    ...checkManifestReticulumSidecarPayload(),
    ...checkWrapperLaunchPaths(),
    ...checkDesktopStartupWMClass(PKG_JSON),
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
