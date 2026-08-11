// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

// ─── BrowserWindow creation ───────────────────────────────────────────────────

describe('BrowserWindow creation', () => {
  it('creates a BrowserWindow with a preload script via path.join', () => {
    // The preload path must be constructed via path.join (not a string literal)
    // to ensure it resolves correctly in both dev and packaged builds.
    expect(INDEX_SOURCE).toContain("preload: path.join(__dirname, '../preload/index.js')");
  });

  it('sets minimum window dimensions', () => {
    // Desktop builds clamp to 900x600 minimums; headless locks min == fixed viewport.
    expect(INDEX_SOURCE).toContain('headlessConfig ? bounds.width : 900');
    expect(INDEX_SOURCE).toContain('headlessConfig ? bounds.height : 600');
  });
});

// ─── app lifecycle handlers ───────────────────────────────────────────────────

describe('app lifecycle handlers', () => {
  it("handles 'window-all-closed' to quit on non-darwin platforms", () => {
    const handlerIdx = INDEX_SOURCE.indexOf("app.on('window-all-closed'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1100);
    // Must check platform before quitting (darwin keeps the process alive)
    expect(body).toContain("process.platform !== 'darwin'");
    expect(body).toContain('app.quit()');
  });

  it("handles 'activate' to recreate the window when no windows exist", () => {
    const handlerIdx = INDEX_SOURCE.indexOf("app.on('activate'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(body).toContain('BrowserWindow.getAllWindows()');
  });

  it("handles 'before-quit' for graceful shutdown", () => {
    expect(INDEX_SOURCE).toContain("app.on('before-quit'");
  });

  it('skips db IPC handlers quietly when SQLite is already closed', () => {
    expect(INDEX_SOURCE).toContain("from './db-ipc-lifecycle'");
    expect(INDEX_SOURCE).toContain('getDbForIpc(');
    expect(INDEX_SOURCE).toContain('finishDbIpcHandler');
  });
});

// ─── Navigation security ──────────────────────────────────────────────────────

describe('navigation and window-open security', () => {
  it('registers a will-navigate handler', () => {
    expect(INDEX_SOURCE).toContain("on('will-navigate'");
  });

  it('calls event.preventDefault() in will-navigate when navigating externally', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("on('will-navigate'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 350);
    expect(body).toContain('event.preventDefault()');
  });

  it('uses setWindowOpenHandler to intercept all window.open calls', () => {
    expect(INDEX_SOURCE).toContain('setWindowOpenHandler');
  });
});

describe('Linux Web Bluetooth device selection', () => {
  it('imports and uses linuxWebBluetoothDeviceSelection for retain-first multi-fire', () => {
    expect(INDEX_SOURCE).toContain("from './linuxWebBluetoothDeviceSelection'");
    expect(INDEX_SOURCE).toContain('linuxWebBluetoothDeviceSelection.beginOrMergeDiscovery');
    expect(INDEX_SOURCE).toContain('linuxWebBluetoothDeviceSelection.resolveSelection');
    expect(INDEX_SOURCE).toContain('linuxWebBluetoothDeviceSelection.cancelSelection');
    expect(INDEX_SOURCE).toContain('linuxWebBluetoothDeviceSelection.armStaleTimeout');
    // Awaitable cancel before requestDevice() — fire-and-forget send raced the new chooser.
    expect(INDEX_SOURCE).toContain('registerLinuxWebBluetoothCancelIpcHandlers');
    expect(INDEX_SOURCE).toContain("from './linuxWebBluetoothCancelIpc'");
    // Must not overwrite pending callback on every select-bluetooth-device event
    const handlerIdx = INDEX_SOURCE.indexOf("on('select-bluetooth-device'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1200);
    expect(body).toContain('beginOrMergeDiscovery');
    expect(body).toContain('armStaleTimeout');
    expect(body).not.toMatch(/pendingBluetoothCallback\s*=\s*callback/);
  });

  it('enables WebBluetooth blink features on Linux', () => {
    expect(INDEX_SOURCE).toContain("'Serial,WebBluetooth'");
    expect(INDEX_SOURCE).toContain("appendSwitch('enable-features', 'WebBluetooth')");
  });
});

// ─── Session permission handlers ─────────────────────────────────────────────

describe('session permission handlers', () => {
  it('registers both setPermissionCheckHandler and setPermissionRequestHandler', () => {
    expect(INDEX_SOURCE).toContain('setPermissionCheckHandler');
    expect(INDEX_SOURCE).toContain('setPermissionRequestHandler');
  });

  it('does not call setPermissionCheckHandler with a blanket return true', () => {
    const checkIdx = INDEX_SOURCE.indexOf('setPermissionCheckHandler');
    expect(checkIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(checkIdx, checkIdx + 300);
    // Blanket 'return true' inside the handler would grant all permissions
    expect(body).not.toMatch(/setPermissionCheckHandler[^{]*\{[^}]*return true/s);
  });
});

// ─── did-fail-load error handling ────────────────────────────────────────────

describe('renderer load error handling', () => {
  it("handles 'did-fail-load' on webContents", () => {
    expect(INDEX_SOURCE).toContain("on('did-fail-load'");
  });
});

// ─── Headless server mode wiring ─────────────────────────────────────────────

describe('headless server mode lifecycle contracts', () => {
  it('disables GPU and skips tray/updater/menu/devtools in server mode', () => {
    expect(INDEX_SOURCE).toContain('IS_HEADLESS_SERVER_MODE');
    expect(INDEX_SOURCE).toContain('app.disableHardwareAcceleration()');
    expect(INDEX_SOURCE).toMatch(
      /if\s*\(\s*!IS_HEADLESS_SERVER_MODE\s*\)\s*\{\s*setupTray\(mainWindow\)/,
    );
    expect(INDEX_SOURCE).toMatch(/if\s*\(\s*!IS_HEADLESS_SERVER_MODE\s*\)\s*\{\s*setupAppMenu\(\)/);
    expect(INDEX_SOURCE).toContain('backgroundThrottling: false');
    expect(INDEX_SOURCE).toContain('useContentSize: Boolean(headlessConfig)');
    expect(INDEX_SOURCE).toContain('initUpdater(mainWindow)');
  });

  it('starts or rebinds the remote server after did-finish-load', () => {
    expect(INDEX_SOURCE).toContain("once('did-finish-load'");
    expect(INDEX_SOURCE).toContain('initHeadlessRemoteServer(win, headlessConfig)');
    expect(INDEX_SOURCE).toContain('setTargetWindow(win)');
    expect(INDEX_SOURCE).toContain('headlessRemoteServer = server');
  });

  it('stops the remote server during shutdown and recreates the window on close', () => {
    expect(INDEX_SOURCE).toContain('await headlessRemoteServer?.stop()');
    expect(INDEX_SOURCE).toContain('recreateHeadlessMainWindow()');
    const closedIdx = INDEX_SOURCE.indexOf("app.on('window-all-closed'");
    expect(closedIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(closedIdx, closedIdx + 900);
    expect(body).toContain('IS_HEADLESS_SERVER_MODE');
    expect(body).toContain('keeping app + remote server alive');
  });

  it('exits non-zero on headless load failure', () => {
    expect(INDEX_SOURCE).toContain(
      '[headless] renderer failed to load; exiting so the orchestrator can restart',
    );
    expect(INDEX_SOURCE).toContain('app.exit(1)');
  });
});
