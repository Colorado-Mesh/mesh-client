// @vitest-environment node
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';

import { readFileSync } from 'fs';
import { join } from 'path';
import { transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { isAllowedRendererNavigation } from './rendererNavigationPolicy';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

// ─── BrowserWindow creation ───────────────────────────────────────────────────

describe('BrowserWindow creation', () => {
  it('creates a BrowserWindow with a preload script via path.join', () => {
    // The preload path must be constructed via path.join (not a string literal)
    // to ensure it resolves correctly in both dev and packaged builds.
    expect(INDEX_SOURCE).toContain("preload: path.join(__dirname, '../preload/index.js')");
  });

  it('sets minimum window dimensions', () => {
    expect(INDEX_SOURCE).toContain('minWidth: 900');
    expect(INDEX_SOURCE).toContain('minHeight: 600');
  });
});

// ─── app lifecycle handlers ───────────────────────────────────────────────────

describe('app lifecycle handlers', () => {
  it("handles 'window-all-closed' to quit on non-darwin platforms", () => {
    const handlerIdx = INDEX_SOURCE.indexOf("app.on('window-all-closed'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 700);
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

describe('window close-to-tray behaviour', () => {
  const closeHandlerBody = () => {
    const start = INDEX_SOURCE.indexOf("win.on('close', (event)");
    expect(start).toBeGreaterThan(-1);
    return INDEX_SOURCE.slice(start, start + 900);
  };

  it('routes the close decision through resolveWindowCloseAction', () => {
    const body = closeHandlerBody();
    expect(body).toContain('resolveWindowCloseAction({');
    expect(body).toContain('closeToTrayEnabled: readCloseToTrayEnabled()');
    expect(body).toContain('trayAvailable: tray !== null');
    expect(body).toContain('hasConnection: isConnected || isAnyMqttConnected()');
  });

  it('hides to tray and keeps the minimize fallback', () => {
    const body = closeHandlerBody();
    expect(body).toContain("if (action === 'allow') return;");
    expect(body).toContain('event.preventDefault();');
    expect(body).toContain('win.hide();');
    expect(body).toContain('win.minimize();');
  });

  it('reads the closeToTray flag from SQLite app_settings', () => {
    const start = INDEX_SOURCE.indexOf('function readCloseToTrayEnabled()');
    expect(start).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(start, start + 700);
    expect(body).toContain('SELECT value FROM app_settings WHERE key = ?');
    expect(body).toContain('closeToTrayEnabledFromStored(row?.value)');
    expect(body).toContain('return true;');
  });

  it("allow-lists the 'closeToTray' app_settings key", () => {
    expect(INDEX_SOURCE).toContain("'closeToTray',");
  });
});

describe('Web Serial window ownership', () => {
  function serialSelectionHarness(platform: string) {
    const session = new EventEmitter();
    const state = {
      process: { platform },
      trustedRendererUrl: 'mesh-client://renderer/index.html',
      isAllowedRendererNavigation,
      pendingSerialCallback: null as ((portId: string) => void) | null,
      pendingSerialSelectionTimer: null,
      lastSerialPortIds: new Set<string>(),
      clearPendingSerialSelectionTimer: vi.fn(),
      SERIAL_PORT_SELECTION_TIMEOUT_MS: 120_000,
      setTimeout: vi.fn(() => 1),
      console: { debug: vi.fn(), warn: vi.fn() },
    };
    const createWindow = () =>
      Object.assign(new EventEmitter(), {
        webContents: {
          session,
          mainFrame: { url: state.trustedRendererUrl },
          send: vi.fn(),
        },
      });
    const start = INDEX_SOURCE.indexOf('// ─── Web Serial: Port Selection');
    const end = INDEX_SOURCE.indexOf('// ─── Web Bluetooth: Device Selection', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Execute the actual registration block without booting Electron's main process.
    const source = `(function (win) {
      const mainWindow = win;
      ${INDEX_SOURCE.slice(start, end)}
    })`;
    const register = runInNewContext(transpileModule(source, {}).outputText, state) as (
      window: ReturnType<typeof createWindow>,
    ) => void;
    return { session, state, createWindow, register };
  }

  it.each(['linux', 'darwin', 'win32'])(
    'only lets the reopened window own its chooser callback on %s',
    (platform) => {
      const { session, state, createWindow, register } = serialSelectionHarness(platform);
      const unrelatedListener = vi.fn();
      session.on('select-serial-port', unrelatedListener);
      const original = createWindow();
      const originalContents = original.webContents;
      register(original);
      expect(session.listenerCount('select-serial-port')).toBe(2);
      Object.defineProperty(original, 'webContents', {
        get: () => {
          throw new Error('Window has been destroyed');
        },
      });
      original.emit('closed');
      expect(session.listeners('select-serial-port')).toEqual([unrelatedListener]);

      const reopened = createWindow();
      register(reopened);
      const callback = vi.fn();
      const event = { preventDefault: vi.fn() };
      session.emit(
        'select-serial-port',
        event,
        [{ portId: 'new-window-port', portName: 'USB radio' }],
        reopened.webContents,
        callback,
      );
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(callback).not.toHaveBeenCalled();
      expect(state.pendingSerialCallback).toBe(callback);
      state.pendingSerialCallback?.('new-window-port');
      expect(callback).toHaveBeenCalledExactlyOnceWith('new-window-port');
      expect(originalContents.send).not.toHaveBeenCalled();
      expect(reopened.webContents.send).toHaveBeenCalledOnce();
      expect(unrelatedListener).toHaveBeenCalledOnce();
      reopened.emit('closed');
      expect(session.listeners('select-serial-port')).toEqual([unrelatedListener]);
    },
  );

  it('keeps selection working when a close request only hides the window to the tray', () => {
    const { session, state, createWindow, register } = serialSelectionHarness('darwin');
    const window = createWindow();
    register(window);
    window.emit('close', { preventDefault: vi.fn() });
    expect(session.listenerCount('select-serial-port')).toBe(1);
    const callback = vi.fn();
    session.emit(
      'select-serial-port',
      { preventDefault: vi.fn() },
      [],
      window.webContents,
      callback,
    );
    expect(state.pendingSerialCallback).toBe(callback);
    expect(callback).not.toHaveBeenCalled();
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
  it('cancels Chromium select-bluetooth-device (LoRa BLE uses sidecar GATT)', () => {
    expect(INDEX_SOURCE).not.toContain("from './linuxWebBluetoothDeviceSelection'");
    expect(INDEX_SOURCE).not.toContain("from './linuxWebBluetoothCancelIpc'");
    expect(INDEX_SOURCE).not.toContain('linuxWebBluetoothDeviceSelection');
    expect(INDEX_SOURCE).not.toContain('beginOrMergeDiscovery');
    expect(INDEX_SOURCE).not.toContain('armStaleTimeout');
    expect(INDEX_SOURCE).not.toContain("ipcMain.on('bluetooth-device-selected'");
    expect(INDEX_SOURCE).not.toContain("ipcMain.handle('bluetooth-device-cancel'");
    expect(INDEX_SOURCE).not.toContain('bluetooth-devices-discovered');
    const handlerIdx = INDEX_SOURCE.indexOf("on('select-bluetooth-device'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 500);
    expect(body).toContain("callback('')");
    expect(body).toContain('Web BT LoRa removed');
  });

  it('enables Web Serial blink features without WebBluetooth', () => {
    expect(INDEX_SOURCE).toContain("appendSwitch('enable-blink-features', 'Serial')");
    expect(INDEX_SOURCE).not.toContain("'Serial,WebBluetooth'");
    expect(INDEX_SOURCE).not.toContain("appendSwitch('enable-features', 'WebBluetooth')");
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
