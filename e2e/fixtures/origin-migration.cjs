// Test-only bootstrap: exercise the production packaged startup with an isolated profile.
const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = process.cwd();
const profile = process.env.MESH_E2E_USER_DATA;
const token = process.env.MESH_E2E_PROFILE_TOKEN;
if (
  !profile ||
  !path.isAbsolute(profile) ||
  !/^mesh-(?:origin-)?e2e-[a-zA-Z0-9]+$/.test(path.basename(profile)) ||
  fs.lstatSync(profile).isSymbolicLink() ||
  path.dirname(fs.realpathSync(profile)) !== fs.realpathSync(tmpdir()) ||
  !token ||
  fs.readFileSync(path.join(profile, '.mesh-e2e-profile'), 'utf8') !== token
) {
  throw new Error('E2E bootstrap requires an explicitly owned temporary profile');
}

// Override Chromium and crash paths before any session or production main module exists.
app.setPath('userData', profile);
app.setPath('sessionData', profile);
for (const name of ['crashDumps', 'logs']) {
  const directory = path.join(profile, name);
  fs.mkdirSync(directory, { recursive: true });
  if (name === 'logs') app.setAppLogsPath(directory);
  else app.setPath(name, directory);
}

// Production startup registers lxm: with the OS even in unpackaged mode. E2E must
// not change machine settings; these overrides exist only in this unshipped fixture.
app.setAsDefaultProtocolClient = () => false;
app.removeAsDefaultProtocolClient = () => false;
app.setLoginItemSettings = () => {};
app.getLoginItemSettings = () => ({ openAtLogin: false, wasOpenedAtLogin: false });
shell.openExternal = async (url) => {
  globalThis.__meshE2eOpenedUrls ??= [];
  globalThis.__meshE2eOpenedUrls.push(url);
};

if (process.env.MESH_E2E_SEED_LEGACY === '1') {
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(pathToFileURL(path.join(root, 'dist/renderer/migration.html')).href);
    const entries = fs
      .readFileSync(path.join(app.getPath('userData'), 'seed.json'))
      .toString('base64');
    await window.webContents.executeJavaScript(`(() => {
      const entries = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${entries}'), c => c.charCodeAt(0))));
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      return localStorage.length;
    })()`);
    window.webContents.session.flushStorageData();
    fs.writeFileSync(path.join(app.getPath('userData'), 'seed-complete'), 'ok');
  });
} else {
  // Electron was launched with this fixture, so retain the repository as the app root.
  app.getAppPath = () => root;
  app.getVersion = () => require(path.join(root, 'package.json')).version;
  // This modifies only the E2E process; production has no migration-test switch.
  if (process.env.MESH_E2E_PACKAGED !== '0') {
    Object.defineProperty(app, 'isPackaged', { value: true });
    // Packaged updater downloads can live outside userData; never download/install in smoke tests.
    const { autoUpdater } = require('electron-updater');
    autoUpdater.checkForUpdates = async () => null;
    autoUpdater.downloadUpdate = async () => [];
    autoUpdater.quitAndInstall = () => {};
  }
  require(path.join(root, 'dist-electron/main/index.js'));
}
