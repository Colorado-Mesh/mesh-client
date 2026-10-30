// @vitest-environment node
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { BrowserWindowConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveMapView } from '../../shared/liveMapWindow';

const harness = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  validate: vi.fn(() => true),
  displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  let nextId = 1;
  class FakeContents extends Emitter {
    readonly id = nextId++;
    url = '';
    send = vi.fn();
    isDestroyed = vi.fn(() => false);
    getURL = vi.fn(() => this.url);
    openHandler: ((details: { url: string }) => { action: string }) | null = null;
    setWindowOpenHandler = vi.fn((handler: (details: { url: string }) => { action: string }) => {
      this.openHandler = handler;
    });
  }
  class FakeWindow extends Emitter {
    static created: FakeWindow[] = [];
    readonly webContents = new FakeContents();
    destroyed = false;
    constructor(readonly options: BrowserWindowConstructorOptions = {}) {
      super();
      FakeWindow.created.push(this);
    }
    loadURL = vi.fn().mockResolvedValue(undefined);
    isDestroyed = () => this.destroyed;
    isMinimized = vi.fn(() => false);
    restore = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    setAlwaysOnTop = vi.fn();
    getNormalBounds = vi.fn(() => ({ x: 40, y: 50, width: 900, height: 640 }));
    close = vi.fn(() => {
      if (this.destroyed) return;
      this.emit('close');
      this.destroyed = true;
      this.emit('closed');
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.emit('closed');
    });
  }
  return {
    BrowserWindow: FakeWindow,
    ipcMain: { handle: harness.handle, on: harness.on },
    screen: { getAllDisplays: () => harness.displays },
  };
});
vi.mock('../validate-ipc-sender', () => ({ validateIpcSender: harness.validate }));

import { BrowserWindow } from 'electron';

import {
  liveMapWindowUrl,
  readLiveMapWindowState,
  registerLiveMapWindows,
} from './live-map-handlers';

interface TestContents extends EventEmitter {
  id: number;
  url: string;
  send: ReturnType<typeof vi.fn>;
  openHandler: ((details: { url: string }) => { action: string }) | null;
}
interface TestWindow extends EventEmitter {
  options: BrowserWindowConstructorOptions;
  webContents: TestContents;
  loadURL: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  close: () => void;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
}
const FakeWindow = BrowserWindow as unknown as {
  new (options?: BrowserWindowConstructorOptions): TestWindow;
  created: TestWindow[];
};

function invoke(channel: string) {
  const entry = harness.handle.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Missing handle ${channel}`);
  return entry[1] as (event: { sender: TestContents }, ...args: unknown[]) => unknown;
}
function listener(channel: string) {
  const entry = harness.on.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Missing on ${channel}`);
  return entry[1] as (event: { sender: TestContents }, ...args: unknown[]) => void;
}

const view: LiveMapView = {
  center: [39.7, -105],
  zoom: 8,
  basemapId: 'dark',
  trafficSource: 'beacon',
  feed: { baseUrl: 'https://map.meshcore.coloradomesh.org', region: 'DEN' },
};

let dir: string;
let statePath: string;
let main: TestWindow;
const openExternal = vi.fn(() => true);

function register(allowDevServer = false) {
  registerLiveMapWindows({
    getMainWindow: () => main as unknown as Electron.BrowserWindow,
    preloadPath: '/app/preload/index.js',
    iconPath: '/app/icon.png',
    statePath,
    allowDevServer,
    openExternal,
  });
}

async function openPopOut(protocol = 'meshcore', withView: unknown = view): Promise<TestWindow> {
  await invoke('liveMap:open')({ sender: main.webContents }, protocol, withView);
  const popOut = FakeWindow.created.at(-1);
  if (!popOut || popOut === main) throw new Error('No pop-out window was created');
  return popOut;
}

beforeEach(() => {
  harness.handle.mockReset();
  harness.on.mockReset();
  harness.validate.mockReset();
  harness.validate.mockReturnValue(true);
  openExternal.mockClear();
  FakeWindow.created.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-live-map-'));
  statePath = path.join(dir, 'live-map-window-state.json');
  main = new FakeWindow();
  main.webContents.url = 'mesh-client://renderer/index.html';
  register();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('liveMapWindowUrl', () => {
  it.each([
    ['mesh-client://renderer/index.html', 'mesh-client://renderer/live-map.html?protocol=meshcore'],
    [
      'file:///Applications/Mesh%20Client.app/Contents/Resources/app/dist/renderer/index.html',
      'file:///Applications/Mesh%20Client.app/Contents/Resources/app/dist/renderer/live-map.html?protocol=meshcore',
    ],
  ])('places the pop-out page beside %s', (rendererUrl, expected) => {
    expect(liveMapWindowUrl(rendererUrl, 'meshcore', false)).toBe(expected);
  });

  it('uses the Vite server only in development', () => {
    expect(liveMapWindowUrl('http://localhost:5173/', 'meshtastic', true)).toBe(
      'http://localhost:5173/live-map.html?protocol=meshtastic',
    );
    expect(liveMapWindowUrl('http://localhost:5173/', 'meshtastic', false)).toBeNull();
  });

  it.each([
    'https://example.com/index.html',
    'mesh-client://elsewhere/index.html',
    'mesh-client://renderer:8080/index.html',
    'http://user:pass@localhost:5173/',
    'about:blank',
    '',
  ])('refuses %s', (rendererUrl) => {
    expect(liveMapWindowUrl(rendererUrl, 'meshcore', true)).toBeNull();
  });
});

describe('opening a pop-out', () => {
  it('creates a sandboxed window on the renderer origin and tells the main window', async () => {
    const popOut = await openPopOut();
    expect(popOut.options.webPreferences).toMatchObject({
      preload: '/app/preload/index.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    });
    expect(popOut.options).toMatchObject({ show: false, alwaysOnTop: false, width: 1100 });
    expect(popOut.loadURL).toHaveBeenCalledWith(
      'mesh-client://renderer/live-map.html?protocol=meshcore',
    );
    expect(main.webContents.send).toHaveBeenCalledWith('liveMap:state', {
      protocol: 'meshcore',
      open: true,
      ready: false,
      view: null,
    });
  });

  it('focuses the open window instead of creating another', async () => {
    const popOut = await openPopOut();
    await invoke('liveMap:open')({ sender: main.webContents }, 'meshcore', null);
    expect(FakeWindow.created.filter((window) => window !== main)).toEqual([popOut]);
    expect(popOut.focus).toHaveBeenCalled();
  });

  it('keeps one window per protocol', async () => {
    const meshcore = await openPopOut('meshcore');
    const meshtastic = await openPopOut('meshtastic');
    expect(meshtastic).not.toBe(meshcore);
    expect(await invoke('liveMap:getOpen')({ sender: main.webContents })).toEqual([
      'meshcore',
      'meshtastic',
    ]);
  });

  it('accepts open, close and listing only from the main window', async () => {
    const popOut = await openPopOut();
    for (const channel of ['liveMap:open', 'liveMap:close', 'liveMap:getOpen']) {
      expect(() => invoke(channel)({ sender: popOut.webContents }, 'meshcore')).toThrow(
        'unauthorized',
      );
    }
    harness.validate.mockReturnValue(false);
    expect(() => invoke('liveMap:open')({ sender: main.webContents }, 'meshtastic')).toThrow(
      'unauthorized',
    );
  });

  it('rejects protocols without a live traffic view', () => {
    expect(() => invoke('liveMap:open')({ sender: main.webContents }, 'reticulum')).toThrow(
      'invalid protocol',
    );
  });

  it('opens nothing when the main window was not loaded from a renderer origin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    main.webContents.url = 'https://example.com/';
    await invoke('liveMap:open')({ sender: main.webContents }, 'meshcore', null);
    expect(FakeWindow.created).toEqual([main]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('relaying traffic', () => {
  it('forwards snapshots only after the pop-out page is listening', async () => {
    const popOut = await openPopOut();
    const publish = listener('liveMap:publish');
    publish({ sender: main.webContents }, 'meshcore', { myNodeNum: 1 });
    expect(popOut.webContents.send).not.toHaveBeenCalled();

    const init = await invoke('liveMap:init')({ sender: popOut.webContents });
    expect(init).toEqual({ protocol: 'meshcore', view, alwaysOnTop: false });
    expect(main.webContents.send).toHaveBeenLastCalledWith('liveMap:state', {
      protocol: 'meshcore',
      open: true,
      ready: true,
      view: null,
    });

    publish({ sender: main.webContents }, 'meshcore', { myNodeNum: 2 });
    expect(popOut.webContents.send).toHaveBeenCalledWith('liveMap:snapshot', { myNodeNum: 2 });
  });

  it('ignores snapshots from anywhere but the main window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const popOut = await openPopOut();
    await invoke('liveMap:init')({ sender: popOut.webContents });
    listener('liveMap:publish')({ sender: popOut.webContents }, 'meshcore', { myNodeNum: 3 });
    listener('liveMap:publish')({ sender: main.webContents }, 'meshtastic', { myNodeNum: 3 });
    listener('liveMap:publish')({ sender: main.webContents }, 'meshcore', null);
    expect(popOut.webContents.send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('answers init only for its own pop-out windows', async () => {
    expect(await invoke('liveMap:init')({ sender: main.webContents })).toBeNull();
  });
});

describe('node selection', () => {
  it('brings the main window forward and passes the node to it', async () => {
    const popOut = await openPopOut();
    listener('liveMap:selectNode')({ sender: popOut.webContents }, 0xdead_beef);
    expect(main.focus).toHaveBeenCalled();
    expect(main.webContents.send).toHaveBeenCalledWith('liveMap:nodeSelected', {
      protocol: 'meshcore',
      nodeId: 0xdead_beef,
    });
  });

  it.each([0, -1, 1.5, 2 ** 33, Number.NaN, '12'])('ignores node id %s', async (nodeId) => {
    const popOut = await openPopOut();
    listener('liveMap:selectNode')({ sender: popOut.webContents }, nodeId);
    expect(main.webContents.send).not.toHaveBeenCalledWith(
      'liveMap:nodeSelected',
      expect.anything(),
    );
  });

  it('ignores selections that do not come from a pop-out', () => {
    listener('liveMap:selectNode')({ sender: main.webContents }, 7);
    expect(main.webContents.send).not.toHaveBeenCalledWith(
      'liveMap:nodeSelected',
      expect.anything(),
    );
  });
});

describe('closing and returning', () => {
  it('hands the last reported view back to the main window', async () => {
    const popOut = await openPopOut();
    const moved: LiveMapView = { ...view, center: [45.5, -122.6], zoom: 10 };
    listener('liveMap:reportView')({ sender: popOut.webContents }, moved);
    listener('liveMap:reportView')({ sender: popOut.webContents }, { center: 'bad' });
    await invoke('liveMap:dock')({ sender: popOut.webContents });
    expect(popOut.isDestroyed()).toBe(true);
    expect(main.webContents.send).toHaveBeenLastCalledWith('liveMap:state', {
      protocol: 'meshcore',
      open: false,
      ready: false,
      view: moved,
    });
    expect(await invoke('liveMap:getOpen')({ sender: main.webContents })).toEqual([]);
  });

  it('closes from the main window', async () => {
    const popOut = await openPopOut();
    await invoke('liveMap:close')({ sender: main.webContents }, 'meshcore');
    expect(popOut.isDestroyed()).toBe(true);
  });

  it('remembers bounds and keep-on-top for the next window', async () => {
    const popOut = await openPopOut();
    expect(await invoke('liveMap:setAlwaysOnTop')({ sender: popOut.webContents }, true)).toBe(true);
    expect(popOut.setAlwaysOnTop).toHaveBeenCalledWith(true);
    popOut.close();
    expect(readLiveMapWindowState(statePath)).toEqual({
      meshcore: { x: 40, y: 50, width: 900, height: 640, alwaysOnTop: true },
    });

    const reopened = await openPopOut();
    expect(reopened.options).toMatchObject({
      x: 40,
      y: 50,
      width: 900,
      height: 640,
      alwaysOnTop: true,
    });
    expect(await invoke('liveMap:init')({ sender: reopened.webContents })).toMatchObject({
      alwaysOnTop: true,
    });
  });

  it('opens at the default place when saved bounds are off every display', async () => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        meshcore: { x: 5000, y: 5000, width: 800, height: 600, alwaysOnTop: false },
      }),
    );
    const popOut = await openPopOut();
    expect(popOut.options).toMatchObject({ x: undefined, y: undefined, width: 1100 });
  });

  it('rejects a keep-on-top value that is not a boolean', async () => {
    const popOut = await openPopOut();
    expect(() => invoke('liveMap:setAlwaysOnTop')({ sender: popOut.webContents }, 'yes')).toThrow(
      'invalid value',
    );
  });

  it('closes pop-outs with the main window', async () => {
    const popOut = await openPopOut();
    main.emit('closed');
    expect(popOut.isDestroyed()).toBe(true);
  });

  it('closes pop-outs when the main renderer reloads, not on in-page navigation', async () => {
    const popOut = await openPopOut();
    main.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(popOut.isDestroyed()).toBe(false);
    main.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(popOut.isDestroyed()).toBe(true);
  });
});

describe('navigation', () => {
  it('keeps the pop-out on its page and sends links to the system browser', async () => {
    const popOut = await openPopOut();
    const event = { preventDefault: vi.fn() };
    popOut.webContents.emit('will-navigate', event, 'https://www.openstreetmap.org/copyright');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(
      'mesh-client://renderer/live-map.html?protocol=meshcore',
      'https://www.openstreetmap.org/copyright',
    );
    expect(popOut.webContents.openHandler?.({ url: 'https://leafletjs.com/' })).toEqual({
      action: 'deny',
    });
    expect(openExternal).toHaveBeenLastCalledWith(
      'mesh-client://renderer/live-map.html?protocol=meshcore',
      'https://leafletjs.com/',
    );
  });
});
