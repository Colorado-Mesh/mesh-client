import fs from 'node:fs';

import {
  BrowserWindow,
  type Event,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  screen,
  type WebContents,
  type WebContentsDidStartNavigationEventParams,
} from 'electron';

import {
  isLiveMapProtocol,
  type LiveMapProtocol,
  type LiveMapView,
  type LiveMapWindowInit,
  type LiveMapWindowState,
  parseLiveMapView,
} from '../../shared/liveMapWindow';
import { RENDERER_HOST, RENDERER_SCHEME } from '../../shared/rendererOrigin';
import { sanitizeLogMessage } from '../sanitize-log-message';
import { validateIpcSender } from '../validate-ipc-sender';

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MAX_NODE_ID = 0xffff_ffff;
const DEV_SERVER_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface LiveMapWindowDeps {
  getMainWindow: () => BrowserWindow | null;
  preloadPath: string;
  iconPath?: string;
  /** JSON file holding each protocol's pop-out bounds and keep-on-top choice. */
  statePath: string;
  /** Development builds load the renderer from the Vite server on localhost. */
  allowDevServer: boolean;
  /** Route external http(s) links to the system browser; returns true when it did. */
  openExternal: (currentUrl: string, targetUrl: string) => boolean;
}

interface StoredWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
}

type StoredState = Partial<Record<LiveMapProtocol, StoredWindow>>;

interface PopOut {
  window: BrowserWindow;
  ready: boolean;
  view: LiveMapView | null;
  alwaysOnTop: boolean;
}

/**
 * The pop-out page sits beside the page the main window loaded: the custom renderer origin,
 * the packaged file fallback, or the Vite server in development. Anything else is refused.
 */
export function liveMapWindowUrl(
  rendererUrl: string,
  protocol: LiveMapProtocol,
  allowDevServer: boolean,
): string | null {
  let base: URL;
  try {
    base = new URL(rendererUrl);
  } catch {
    // catch-no-log-ok an unloaded or malformed main window URL means no pop-out is offered.
    return null;
  }
  if (base.username || base.password) return null;
  const customOrigin =
    base.protocol === `${RENDERER_SCHEME}:` && base.hostname === RENDERER_HOST && !base.port;
  const devServer =
    allowDevServer &&
    (base.protocol === 'http:' || base.protocol === 'https:') &&
    DEV_SERVER_HOSTS.has(base.hostname);
  if (!customOrigin && base.protocol !== 'file:' && !devServer) return null;
  const url = new URL('live-map.html', base);
  url.search = new URLSearchParams({ protocol }).toString();
  url.hash = '';
  return url.toString();
}

function isStoredWindow(value: unknown): value is StoredWindow {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof raw[key] === 'number' && Number.isFinite(raw[key]),
    ) && typeof raw.alwaysOnTop === 'boolean'
  );
}

export function readLiveMapWindowState(statePath: string): StoredState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const state: StoredState = {};
    for (const protocol of ['meshtastic', 'meshcore'] as const) {
      const entry = (raw as Record<string, unknown>)[protocol];
      if (isStoredWindow(entry)) state[protocol] = entry;
    }
    return state;
  } catch {
    // catch-no-log-ok a missing or unreadable file falls back to default size and position.
    return {};
  }
}

function writeLiveMapWindowState(statePath: string, state: StoredState): void {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf-8');
  } catch (e: unknown) {
    console.warn(
      '[live-map] window state save failed:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
}

function isOnScreen(bounds: StoredWindow): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    return (
      bounds.x < workArea.x + workArea.width &&
      bounds.x + bounds.width > workArea.x &&
      bounds.y < workArea.y + workArea.height &&
      bounds.y + bounds.height > workArea.y
    );
  });
}

function isNodeId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_NODE_ID;
}

/**
 * One pop-out window per protocol. The main window owns radio state and publishes packet
 * snapshots; main only relays them. IPC goes through main rather than BroadcastChannel because
 * the packaged file:// fallback gives each page its own opaque origin, so a channel between
 * index.html and live-map.html would be silent there.
 */
export function registerLiveMapWindows(deps: LiveMapWindowDeps): void {
  const popOuts = new Map<LiveMapProtocol, PopOut>();
  const watchedMainWindows = new WeakSet<BrowserWindow>();

  const mainContents = (): WebContents | null => {
    const main = deps.getMainWindow();
    return main && !main.isDestroyed() ? main.webContents : null;
  };
  const isFromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    validateIpcSender(event) && event.sender.id === mainContents()?.id;
  const popOutOf = (event: IpcMainEvent | IpcMainInvokeEvent): [LiveMapProtocol, PopOut] | null => {
    if (!validateIpcSender(event)) return null;
    for (const [protocol, entry] of popOuts) {
      if (!entry.window.isDestroyed() && entry.window.webContents.id === event.sender.id)
        return [protocol, entry];
    }
    return null;
  };
  const notifyMain = (state: LiveMapWindowState): void => {
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed() && !main.webContents.isDestroyed())
      main.webContents.send('liveMap:state', state);
  };
  const closeAll = (): void => {
    for (const { window } of popOuts.values()) if (!window.isDestroyed()) window.close();
  };
  const saveWindow = (protocol: LiveMapProtocol, entry: PopOut): void => {
    const state = readLiveMapWindowState(deps.statePath);
    // Normal bounds survive a maximized, minimized or full-screen close.
    state[protocol] = { ...entry.window.getNormalBounds(), alwaysOnTop: entry.alwaysOnTop };
    writeLiveMapWindowState(deps.statePath, state);
  };

  const watchMainWindow = (main: BrowserWindow): void => {
    if (watchedMainWindows.has(main)) return;
    watchedMainWindows.add(main);
    main.once('closed', closeAll);
    // A reloaded main renderer stops publishing, so close the pop-outs rather than freeze them.
    main.webContents.on(
      'did-start-navigation',
      (details: Event<WebContentsDidStartNavigationEventParams>) => {
        if (details.isMainFrame && !details.isSameDocument) closeAll();
      },
    );
  };

  const create = (main: BrowserWindow, protocol: LiveMapProtocol, view: LiveMapView | null) => {
    const url = liveMapWindowUrl(main.webContents.getURL(), protocol, deps.allowDevServer);
    if (!url) {
      console.warn('[live-map] pop-out is unavailable for this renderer origin');
      return;
    }
    const stored = readLiveMapWindowState(deps.statePath)[protocol];
    const bounds = stored && isOnScreen(stored) ? stored : null;
    const window = new BrowserWindow({
      width: bounds?.width ?? DEFAULT_WIDTH,
      height: bounds?.height ?? DEFAULT_HEIGHT,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 480,
      minHeight: 360,
      title: 'Mesh Client',
      icon: deps.iconPath,
      show: false,
      autoHideMenuBar: true,
      alwaysOnTop: stored?.alwaysOnTop ?? false,
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
      },
    });
    const entry: PopOut = {
      window,
      ready: false,
      view,
      alwaysOnTop: stored?.alwaysOnTop ?? false,
    };
    popOuts.set(protocol, entry);

    // The page never navigates. Map attribution links go to the system browser.
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      deps.openExternal(url, target);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, target) => {
      event.preventDefault();
      deps.openExternal(url, target);
    });
    window.webContents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
    });
    window.on('close', () => {
      saveWindow(protocol, entry);
    });
    window.on('closed', () => {
      if (popOuts.get(protocol)?.window !== window) return;
      popOuts.delete(protocol);
      notifyMain({ protocol, open: false, ready: false, view: entry.view });
    });

    notifyMain({ protocol, open: true, ready: false, view: null });
    window.loadURL(url).catch((e: unknown) => {
      console.error(
        '[live-map] pop-out load failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      if (!window.isDestroyed()) window.destroy();
    });
  };

  ipcMain.handle('liveMap:open', (event, protocol: unknown, view: unknown) => {
    if (!isFromMainWindow(event)) throw new Error('liveMap:open: unauthorized sender');
    if (!isLiveMapProtocol(protocol)) throw new Error('liveMap:open: invalid protocol');
    const main = deps.getMainWindow();
    if (!main || main.isDestroyed()) return;
    const existing = popOuts.get(protocol);
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }
    watchMainWindow(main);
    create(main, protocol, parseLiveMapView(view));
  });

  ipcMain.handle('liveMap:close', (event, protocol: unknown) => {
    if (!isFromMainWindow(event)) throw new Error('liveMap:close: unauthorized sender');
    if (!isLiveMapProtocol(protocol)) throw new Error('liveMap:close: invalid protocol');
    const entry = popOuts.get(protocol);
    if (entry && !entry.window.isDestroyed()) entry.window.close();
  });

  ipcMain.handle('liveMap:getOpen', (event) => {
    if (!isFromMainWindow(event)) throw new Error('liveMap:getOpen: unauthorized sender');
    return [...popOuts]
      .filter(([, entry]) => !entry.window.isDestroyed())
      .map(([protocol]) => protocol);
  });

  ipcMain.on('liveMap:publish', (event, protocol: unknown, snapshot: unknown) => {
    if (!isFromMainWindow(event)) {
      console.warn('[IPC] liveMap:publish: unauthorized sender');
      return;
    }
    if (!isLiveMapProtocol(protocol) || !snapshot || typeof snapshot !== 'object') return;
    const entry = popOuts.get(protocol);
    if (entry?.ready && !entry.window.isDestroyed())
      entry.window.webContents.send('liveMap:snapshot', snapshot);
  });

  ipcMain.handle('liveMap:init', (event): LiveMapWindowInit | null => {
    const found = popOutOf(event);
    if (!found) return null;
    const [protocol, entry] = found;
    entry.ready = true;
    notifyMain({ protocol, open: true, ready: true, view: null });
    return { protocol, view: entry.view, alwaysOnTop: entry.alwaysOnTop };
  });

  ipcMain.on('liveMap:reportView', (event, view: unknown) => {
    const found = popOutOf(event);
    if (!found) return;
    const parsed = parseLiveMapView(view);
    if (parsed) found[1].view = parsed;
  });

  ipcMain.on('liveMap:selectNode', (event, nodeId: unknown) => {
    const found = popOutOf(event);
    const main = deps.getMainWindow();
    if (!found || !isNodeId(nodeId) || !main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    main.webContents.send('liveMap:nodeSelected', { protocol: found[0], nodeId });
  });

  ipcMain.handle('liveMap:setAlwaysOnTop', (event, value: unknown) => {
    const found = popOutOf(event);
    if (!found) throw new Error('liveMap:setAlwaysOnTop: unauthorized sender');
    if (typeof value !== 'boolean') throw new Error('liveMap:setAlwaysOnTop: invalid value');
    const [protocol, entry] = found;
    entry.window.setAlwaysOnTop(value);
    entry.alwaysOnTop = value;
    saveWindow(protocol, entry);
    return value;
  });

  ipcMain.handle('liveMap:dock', (event) => {
    const found = popOutOf(event);
    if (!found) throw new Error('liveMap:dock: unauthorized sender');
    found[1].window.close();
  });
}
