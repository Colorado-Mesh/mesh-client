/**
 * `electron` module shim for the mobile host worker.
 *
 * The Electron main process (`src/main/**`) runs unmodified inside a Web Worker. This module
 * provides the subset of the Electron main-process API it uses, mapped onto the mobile host:
 * IPC goes to the WebView over `postMessage`, dialogs / notifications / shell actions become UI
 * requests, `safeStorage` uses a Keystore/Keychain-held key, and window/tray/menu APIs are inert.
 *
 * Unknown members resolve to inert no-ops (see `inert`) so desktop-only code paths (tray, dock,
 * menus, auto-update) degrade instead of crashing the host.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

import {
  addSendListener,
  emitToUi,
  getBootConfig,
  hasInvokeHandler,
  onLifecycle,
  registerInvokeHandler,
  removeAllSendListeners,
  removeInvokeHandler,
  removeSendListener,
  requestUi,
} from '../hostChannel';
import { mobileFetch } from './nativeFetch';
import { mkdirSync } from './node/fs';
import { EXPORTS_ROOT, MOBILE_PATHS } from './paths';

// ─── helpers ───────────────────────────────────────────────────────────────────

/**
 * The UI's save dialog answers with a fresh folder under `/exports` per save (the file goes to
 * the share sheet once written). On desktop the user picks a folder that already exists, so main
 * writes without creating one; create it here, before main writes, or the write fails with ENOENT
 * (chat export showed "Export failed" on Android).
 * @internal exported for tests
 */
export function prepareExportTarget<T extends { canceled: boolean; filePath?: string }>(
  result: T,
): T {
  const target = result.filePath;
  if (!result.canceled && target?.startsWith(`${EXPORTS_ROOT}/`)) {
    mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  }
  return result;
}

const NON_CALLABLE_KEYS = new Set<PropertyKey>(['then', 'catch', 'finally', 'toJSON']);

/** A callable, chainable no-op used for desktop-only APIs. Never thenable. */
function inert(label: string): unknown {
  const fn = function inertFn() {
    return undefined;
  };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => `[inert ${label}]`;
      if (typeof prop === 'symbol' || NON_CALLABLE_KEYS.has(prop)) return undefined;
      if (prop in target) return Reflect.get(target, prop) as unknown;
      return inert(`${label}.${prop}`);
    },
    apply() {
      return undefined;
    },
  });
}

/** Wrap a concrete object so missing members become inert no-ops instead of `undefined()` crashes. */
function withInertFallback<T extends object>(obj: T, label: string): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop === 'symbol' || NON_CALLABLE_KEYS.has(prop)) {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return inert(`${label}.${prop}`);
    },
  });
}

// ─── ipcMain ───────────────────────────────────────────────────────────────────

class IpcMainShim extends EventEmitter {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    registerInvokeHandler(channel, handler);
  }
  handleOnce(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    registerInvokeHandler(channel, (event, ...args) => {
      removeInvokeHandler(channel);
      return handler(event, ...args);
    });
  }
  removeHandler(channel: string): void {
    removeInvokeHandler(channel);
  }
  override on(channel: string | symbol, listener: (...args: unknown[]) => void): this {
    if (typeof channel === 'string') addSendListener(channel, listener);
    return this;
  }
  override addListener(channel: string | symbol, listener: (...args: unknown[]) => void): this {
    return this.on(channel, listener);
  }
  override once(channel: string | symbol, listener: (...args: unknown[]) => void): this {
    if (typeof channel !== 'string') return this;
    const wrapped = (...args: unknown[]) => {
      removeSendListener(channel, wrapped);
      listener(...args);
    };
    addSendListener(channel, wrapped);
    return this;
  }
  override removeListener(channel: string | symbol, listener: (...args: unknown[]) => void): this {
    if (typeof channel === 'string') removeSendListener(channel, listener);
    return this;
  }
  override off(channel: string | symbol, listener: (...args: unknown[]) => void): this {
    return this.removeListener(channel, listener);
  }
  override removeAllListeners(channel?: string | symbol): this {
    removeAllSendListeners(typeof channel === 'string' ? channel : undefined);
    return this;
  }
  /** @internal test hook */
  _hasHandler(channel: string): boolean {
    return hasInvokeHandler(channel);
  }
}

export const ipcMain = new IpcMainShim();

// ─── app ───────────────────────────────────────────────────────────────────────

let appReadyResolve: () => void = () => {};
const appReady = new Promise<void>((r) => {
  appReadyResolve = r;
});
let appIsReady = false;

/** Called by the worker entry after the database / fs persistence layers are mounted. */
export function markAppReady(): void {
  appIsReady = true;
  appReadyResolve();
  appShim.emit('ready');
}

class AppShim extends EventEmitter {
  name = 'Mesh Client';
  isPackaged = true;
  commandLine = { appendSwitch: () => {}, hasSwitch: () => false, getSwitchValue: () => '' };
  dock = undefined;
  applicationMenu = null;
  userAgentFallback = '';
  runningUnderARM64Translation = false;

  whenReady(): Promise<void> {
    return appReady;
  }
  isReady(): boolean {
    return appIsReady;
  }
  getPath(name: string): string {
    const p = (MOBILE_PATHS as Record<string, string>)[name];
    if (!p) throw new Error(`Failed to get '${name}' path`);
    return p;
  }
  setPath(): void {}
  getAppPath(): string {
    return MOBILE_PATHS.app;
  }
  getVersion(): string {
    return getBootConfig().appVersion;
  }
  getName(): string {
    return this.name;
  }
  setName(n: string): void {
    this.name = n;
  }
  getLocale(): string {
    return getBootConfig().locale;
  }
  getSystemLocale(): string {
    return getBootConfig().locale;
  }
  getPreferredSystemLanguages(): string[] {
    return [getBootConfig().locale];
  }
  getLocaleCountryCode(): string {
    return getBootConfig().locale.split('-')[1] ?? '';
  }
  requestSingleInstanceLock(): boolean {
    return true;
  }
  hasSingleInstanceLock(): boolean {
    return true;
  }
  releaseSingleInstanceLock(): void {}
  setAsDefaultProtocolClient(): boolean {
    return false;
  }
  isDefaultProtocolClient(): boolean {
    return false;
  }
  removeAsDefaultProtocolClient(): boolean {
    return false;
  }
  getAppMetrics(): unknown[] {
    return [];
  }
  getGPUFeatureStatus(): Record<string, string> {
    return {};
  }
  setAppUserModelId(): void {}
  setBadgeCount(count?: number): boolean {
    void requestUi('badge', count ?? 0).catch(() => {});
    return true;
  }
  getBadgeCount(): number {
    return 0;
  }
  focus(): void {}
  hide(): void {}
  show(): void {}
  quit(): void {
    this.emit('before-quit', { preventDefault: () => {} });
    this.emit('will-quit', { preventDefault: () => {} });
    this.emit('quit');
    void requestUi('quit').catch(() => {});
  }
  exit(): void {
    void requestUi('quit').catch(() => {});
  }
  relaunch(): void {
    void requestUi('relaunch').catch(() => {});
  }
  enableSandbox(): void {}
  disableHardwareAcceleration(): void {}
  setLoginItemSettings(): void {}
  getLoginItemSettings(): { openAtLogin: boolean } {
    return { openAtLogin: false };
  }
  setAboutPanelOptions(): void {}
  showAboutPanel(): void {}
  addRecentDocument(): void {}
  clearRecentDocuments(): void {}
  isInApplicationsFolder(): boolean {
    return true;
  }
  moveToApplicationsFolder(): boolean {
    return false;
  }
  getFileIcon(): Promise<unknown> {
    return Promise.resolve(nativeImage.createEmpty());
  }
  isAccessibilitySupportEnabled(): boolean {
    return false;
  }
}

const appShim = new AppShim();
export const app = withInertFallback(appShim, 'app');

// ─── BrowserWindow / webContents ───────────────────────────────────────────────

let nextWebContentsId = 1;
const primaryLoadListeners: (() => void)[] = [];

/** Fires once main has created its window and loaded the renderer (desktop: first paint). */
export function onPrimaryWindowLoaded(cb: () => void): void {
  primaryLoadListeners.push(cb);
}
const allWindows = new Set<BrowserWindowShim>();
let primaryWindow: BrowserWindowShim | null = null;
let uiVisible = true;

class SessionShim extends EventEmitter {
  webRequest = withInertFallback({}, 'session.webRequest');
  protocol = withInertFallback({}, 'session.protocol');
  setPermissionRequestHandler(): void {}
  setPermissionCheckHandler(): void {}
  setDevicePermissionHandler(): void {}
  setBluetoothPairingHandler(): void {}
  setSpellCheckerLanguages(): void {}
  getSpellCheckerLanguages(): string[] {
    return [];
  }
  setSpellCheckerEnabled(): void {}
  availableSpellCheckerLanguages: string[] = [];
  getStoragePath(): string {
    return MOBILE_PATHS.userData;
  }
  clearStorageData(): Promise<void> {
    return requestUi<void>('clearStorageData');
  }
  clearCache(): Promise<void> {
    return Promise.resolve();
  }
  clearCodeCaches(): Promise<void> {
    return Promise.resolve();
  }
  flushStorageData(): void {}
  setProxy(): Promise<void> {
    return Promise.resolve();
  }
  resolveProxy(): Promise<string> {
    return Promise.resolve('DIRECT');
  }
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    return mobileFetch(input, init);
  }
  getUserAgent(): string {
    return 'MeshClientMobile';
  }
}

const defaultSessionShim = withInertFallback(new SessionShim(), 'session');
export const session = withInertFallback(
  {
    defaultSession: defaultSessionShim,
    fromPartition: () => defaultSessionShim,
  },
  'session',
);

class WebContentsShim extends EventEmitter {
  readonly id = nextWebContentsId++;
  session = defaultSessionShim;
  private url = '';
  constructor(private readonly owner: BrowserWindowShim) {
    super();
  }
  send(channel: string, ...args: unknown[]): void {
    // Only the primary window maps to the WebView; secondary windows (live map pop-out) are inert.
    if (this.owner === primaryWindow && !this.owner.destroyed) emitToUi(channel, args);
  }
  postMessage(channel: string, message: unknown): void {
    this.send(channel, message);
  }
  isDestroyed(): boolean {
    return this.owner.destroyed;
  }
  isLoading(): boolean {
    return false;
  }
  isCrashed(): boolean {
    return false;
  }
  getURL(): string {
    return this.url;
  }
  /** @internal */
  _setUrl(u: string): void {
    this.url = u;
  }
  getOSProcessId(): number {
    return 2;
  }
  getProcessId(): number {
    return 2;
  }
  get mainFrame(): Record<string, unknown> {
    return mainFrameShim();
  }
  executeJavaScript(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
  setWindowOpenHandler(): void {}
  openDevTools(): void {}
  closeDevTools(): void {}
  isDevToolsOpened(): boolean {
    return false;
  }
  reload(): void {
    void requestUi('reload').catch(() => {});
  }
  reloadIgnoringCache(): void {
    this.reload();
  }
  focus(): void {}
  setZoomFactor(): void {}
  getZoomFactor(): number {
    return 1;
  }
  setZoomLevel(): void {}
  getZoomLevel(): number {
    return 0;
  }
  setVisualZoomLevelLimits(): Promise<void> {
    return Promise.resolve();
  }
  setBackgroundThrottling(): void {}
  setAudioMuted(): void {}
  insertText(): Promise<void> {
    return Promise.resolve();
  }
  replaceMisspelling(): void {}
  getTitle(): string {
    return 'Mesh Client';
  }
  setUserAgent(): void {}
  getUserAgent(): string {
    return 'MeshClientMobile';
  }
  print(): void {}
  printToPDF(): Promise<Uint8Array> {
    return Promise.reject(new Error('printToPDF is not available on mobile'));
  }
  capturePage(): Promise<unknown> {
    return Promise.resolve(nativeImage.createEmpty());
  }
  forcefullyCrashRenderer(): void {}
}

function mainFrameShim(): Record<string, unknown> {
  return {
    url: getBootConfig().rendererUrl,
    origin: new URL(getBootConfig().rendererUrl).origin,
    processId: 2,
    routingId: 1,
    detached: false,
    frames: [],
    framesInSubtree: [],
    executeJavaScript: () => Promise.resolve(undefined),
    send: (channel: string, ...args: unknown[]) => {
      emitToUi(channel, args);
    },
  };
}

/** The first window main creates is the one the WebView shows. */
function claimPrimaryWindow(win: BrowserWindowShim): void {
  primaryWindow ??= win;
}

class BrowserWindowShim extends EventEmitter {
  readonly webContents: WebContentsShim;
  readonly id: number;
  destroyed = false;
  private bounds = { x: 0, y: 0, width: 400, height: 800 };
  constructor() {
    super();
    this.webContents = withInertFallback(new WebContentsShim(this), 'webContents');
    this.id = this.webContents.id;
    allWindows.add(this);
    claimPrimaryWindow(this);
  }
  static getAllWindows(): BrowserWindowShim[] {
    return [...allWindows].filter((w) => !w.destroyed);
  }
  static getFocusedWindow(): BrowserWindowShim | null {
    return primaryWindow && !primaryWindow.destroyed ? primaryWindow : null;
  }
  static fromWebContents(wc: unknown): BrowserWindowShim | null {
    for (const w of allWindows) if (w.webContents === wc) return w;
    return primaryWindow;
  }
  static fromId(id: number): BrowserWindowShim | null {
    for (const w of allWindows) if (w.id === id) return w;
    return null;
  }
  loadURL(url: string): Promise<void> {
    this.webContents._setUrl(url);
    // The WebView is already showing the renderer; announce the load lifecycle once.
    queueMicrotask(() => {
      if (this === primaryWindow) {
        for (const l of primaryLoadListeners.splice(0)) l();
      }
      this.webContents.emit('did-start-loading');
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
      this.emit('ready-to-show');
    });
    return Promise.resolve();
  }
  loadFile(file: string): Promise<void> {
    return this.loadURL(`file://${file}`);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    allWindows.delete(this);
    if (primaryWindow === this) primaryWindow = null;
    this.emit('closed');
  }
  close(): void {
    const evt = { defaultPrevented: false, preventDefault: () => (evt.defaultPrevented = true) };
    this.emit('close', evt);
    if (!evt.defaultPrevented) this.destroy();
  }
  show(): void {}
  showInactive(): void {}
  hide(): void {}
  focus(): void {}
  blur(): void {}
  restore(): void {}
  minimize(): void {}
  maximize(): void {}
  unmaximize(): void {}
  isVisible(): boolean {
    return uiVisible;
  }
  isMinimized(): boolean {
    return !uiVisible;
  }
  isMaximized(): boolean {
    return true;
  }
  isFullScreen(): boolean {
    return true;
  }
  isFocused(): boolean {
    return uiVisible;
  }
  isNormal(): boolean {
    return true;
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }
  getContentBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }
  getNormalBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }
  setBounds(b: Partial<{ x: number; y: number; width: number; height: number }>): void {
    this.bounds = { ...this.bounds, ...b };
  }
  getSize(): [number, number] {
    return [this.bounds.width, this.bounds.height];
  }
  getPosition(): [number, number] {
    return [0, 0];
  }
  setTitle(): void {}
  getTitle(): string {
    return 'Mesh Client';
  }
  setOverlayIcon(): void {}
  setProgressBar(): void {}
  flashFrame(): void {}
  setMenuBarVisibility(): void {}
  setAutoHideMenuBar(): void {}
  removeMenu(): void {}
  setMenu(): void {}
  setIcon(): void {}
  setAlwaysOnTop(): void {}
  isAlwaysOnTop(): boolean {
    return false;
  }
  setMinimumSize(): void {}
  setSkipTaskbar(): void {}
  setFullScreen(): void {}
  center(): void {}
  moveTop(): void {}
  setBackgroundColor(): void {}
  getNativeWindowHandle(): Uint8Array {
    return new Uint8Array(8);
  }
}

export const BrowserWindow = BrowserWindowShim;

export const webContents = {
  getAllWebContents: () => [...allWindows].map((w) => w.webContents),
  getFocusedWebContents: () => primaryWindow?.webContents ?? null,
  fromId: (id: number) => [...allWindows].find((w) => w.id === id)?.webContents ?? null,
};

/** The IPC event object every invoke/send handler receives (one trusted renderer). */
export function createIpcEvent(): Record<string, unknown> {
  const sender = primaryWindow?.webContents;
  const frame = mainFrameShim();
  return {
    get sender() {
      return primaryWindow?.webContents ?? sender;
    },
    senderFrame: frame,
    frameId: 1,
    processId: 2,
    returnValue: undefined,
    reply: (channel: string, ...args: unknown[]) => {
      emitToUi(channel, args);
    },
    ports: [],
  };
}

// ─── lifecycle → powerMonitor ─────────────────────────────────────────────────

class PowerMonitorShim extends EventEmitter {
  onBatteryPower = false;
  getSystemIdleState(): string {
    return uiVisible ? 'active' : 'idle';
  }
  getSystemIdleTime(): number {
    return 0;
  }
  getCurrentThermalState(): string {
    return 'nominal';
  }
  isOnBatteryPower(): boolean {
    return this.onBatteryPower;
  }
}

export const powerMonitor = new PowerMonitorShim();

/**
 * App lifecycle → Electron window/power events.
 *
 * Switching apps is not system sleep: links stay up in the background (the UI enables the
 * Android foreground service while any link is live, see `linkTracker.ts`), so `pause` only hides
 * the window. `powerMonitor` suspend/resume fire when the OS actually froze this worker — detected
 * as a gap in a periodic timer — so main and the renderer run their wake recovery (MQTT and radio
 * reconnect) only after a real freeze.
 */
const FREEZE_TICK_MS = 5_000;
const FREEZE_GAP_MS = 30_000;
let lastTick = Date.now();

/** @internal exported for tests */
export function checkForFreeze(now: number = Date.now()): boolean {
  const gap = now - lastTick;
  lastTick = now;
  if (gap < FREEZE_GAP_MS) return false;
  console.debug(
    `[mobile/power] worker was frozen for ${Math.round(gap / 1000)}s; running wake recovery`,
  );
  powerMonitor.emit('suspend');
  powerMonitor.emit('resume');
  return true;
}

setInterval(() => {
  checkForFreeze();
}, FREEZE_TICK_MS);

onLifecycle((state) => {
  if (state === 'pause') {
    uiVisible = false;
    primaryWindow?.emit('hide');
    primaryWindow?.emit('blur');
  } else if (state === 'resume') {
    uiVisible = true;
    checkForFreeze();
    primaryWindow?.emit('show');
    primaryWindow?.emit('focus');
  } else {
    appShim.emit('before-quit', { preventDefault: () => {} });
  }
});

// ─── dialog ────────────────────────────────────────────────────────────────────

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export const dialog = withInertFallback(
  {
    showOpenDialog: (...args: unknown[]): Promise<OpenDialogResult> => {
      const opts = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
      return requestUi<OpenDialogResult>('dialog.open', opts ?? {});
    },
    showSaveDialog: async (
      ...args: unknown[]
    ): Promise<{ canceled: boolean; filePath?: string }> => {
      const opts = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
      const result = await requestUi<{ canceled: boolean; filePath?: string }>(
        'dialog.save',
        opts ?? {},
      );
      return prepareExportTarget(result);
    },
    showMessageBox: (
      ...args: unknown[]
    ): Promise<{ response: number; checkboxChecked: boolean }> => {
      const opts = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
      return requestUi('dialog.message', opts ?? {});
    },
    /**
     * Mobile cannot block the host thread on a UI prompt. Returns the cancel/default button
     * and shows the message non-blocking. Callers that need a real answer use the async form;
     * the schema-upgrade confirm is pre-accepted via MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE (mobile
     * installs are single-version and cannot be downgraded side by side).
     */
    showMessageBoxSync: (...args: unknown[]): number => {
      const opts = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
      void requestUi('dialog.message', opts ?? {}).catch(() => {});
      const cancelId = opts?.cancelId;
      const defaultId = opts?.defaultId;
      if (typeof cancelId === 'number') return cancelId;
      if (typeof defaultId === 'number') return defaultId;
      return 0;
    },
    showErrorBox: (title: string, content: string): void => {
      void requestUi('dialog.message', {
        type: 'error',
        title,
        message: title,
        detail: content,
      }).catch(() => {});
    },
    showCertificateTrustDialog: (): Promise<void> => Promise.resolve(),
  },
  'dialog',
);

// ─── shell / clipboard / notifications ────────────────────────────────────────

export const shell = withInertFallback(
  {
    openExternal: (url: string): Promise<void> => requestUi<void>('openExternal', url),
    openPath: (p: string): Promise<string> =>
      requestUi<void>('shareFile', p).then(
        () => '',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      ),
    showItemInFolder: (p: string): void => {
      void requestUi('shareFile', p).catch(() => {});
    },
    trashItem: (): Promise<void> => Promise.resolve(),
    beep: (): void => {},
  },
  'shell',
);

let clipboardText = '';
export const clipboard = withInertFallback(
  {
    readText: (): string => clipboardText,
    writeText: (text: string): void => {
      clipboardText = text;
      void requestUi('clipboard.write', text).catch(() => {});
    },
    clear: (): void => {
      clipboardText = '';
    },
    availableFormats: (): string[] => ['text/plain'],
    readImage: () => nativeImage.createEmpty(),
    writeImage: (): void => {},
  },
  'clipboard',
);

/** UI thread pushes its clipboard text when the app regains focus (best effort). */
export function setClipboardSnapshot(text: string): void {
  clipboardText = text;
}

let nextNotificationId = 1;
class NotificationShim extends EventEmitter {
  static isSupported(): boolean {
    return true;
  }
  readonly id = nextNotificationId++;
  constructor(private readonly opts: Record<string, unknown> = {}) {
    super();
  }
  show(): void {
    void requestUi<{ clicked?: boolean }>('notify', { ...this.opts, id: this.id })
      .then((r) => {
        this.emit('show');
        if (r?.clicked) this.emit('click');
      })
      .catch(() => {});
  }
  close(): void {
    void requestUi('notify.close', this.id).catch(() => {});
    this.emit('close');
  }
}
export const Notification = NotificationShim;

// ─── nativeImage ───────────────────────────────────────────────────────────────

class NativeImageShim {
  constructor(
    private readonly bytes: Uint8Array = new Uint8Array(0),
    private readonly dataUrl = '',
  ) {}
  isEmpty(): boolean {
    return this.bytes.length === 0 && this.dataUrl === '';
  }
  toPNG(): Buffer {
    return Buffer.from(this.bytes);
  }
  toJPEG(): Buffer {
    return Buffer.from(this.bytes);
  }
  toBitmap(): Buffer {
    return Buffer.alloc(0);
  }
  toDataURL(): string {
    if (this.dataUrl) return this.dataUrl;
    return `data:image/png;base64,${Buffer.from(this.bytes).toString('base64')}`;
  }
  getSize(): { width: number; height: number } {
    return { width: 0, height: 0 };
  }
  resize(): this {
    return this;
  }
  crop(): this {
    return this;
  }
  setTemplateImage(): void {}
  addRepresentation(): void {}
  getAspectRatio(): number {
    return 1;
  }
}

export const nativeImage = {
  createEmpty: () => new NativeImageShim(),
  createFromPath: () => new NativeImageShim(),
  createFromBuffer: (b: Uint8Array) => new NativeImageShim(b),
  createFromBitmap: () => new NativeImageShim(),
  createFromDataURL: (u: string) => new NativeImageShim(new Uint8Array(0), u),
};

// ─── safeStorage (Keystore / Keychain master key + AES-256-GCM) ───────────────

function masterKey(): Uint8Array {
  const hex = getBootConfig().safeStorageKeyHex;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('safeStorage master key unavailable');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

const SAFE_STORAGE_MAGIC = Buffer.from('mcm1');

function encryptStringSync(plain: string): Buffer {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = gcm(masterKey(), iv).encrypt(new TextEncoder().encode(plain));
  return Buffer.concat([SAFE_STORAGE_MAGIC, Buffer.from(iv), Buffer.from(ct)]);
}

function decryptStringSync(buf: Uint8Array): string {
  const b = Buffer.from(buf);
  if (b.length < 4 + 12 + 16 || !b.subarray(0, 4).equals(SAFE_STORAGE_MAGIC)) {
    throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
  }
  const iv = b.subarray(4, 16);
  const pt = gcm(masterKey(), Uint8Array.from(iv)).decrypt(Uint8Array.from(b.subarray(16)));
  return new TextDecoder().decode(pt);
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => /^[0-9a-f]{64}$/i.test(getBootConfig().safeStorageKeyHex),
  isAsyncEncryptionAvailable: (): Promise<boolean> =>
    Promise.resolve(/^[0-9a-f]{64}$/i.test(getBootConfig().safeStorageKeyHex)),
  getSelectedStorageBackend: (): string => 'mobile_keystore',
  encryptString: encryptStringSync,
  decryptString: decryptStringSync,
  encryptStringAsync: (plain: string): Promise<Buffer> =>
    Promise.resolve().then(() => encryptStringSync(plain)),
  decryptStringAsync: (buf: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }> =>
    Promise.resolve().then(() => ({ result: decryptStringSync(buf), shouldReEncrypt: false })),
  setUsePlainTextEncryption: (): void => {},
};

// ─── net ───────────────────────────────────────────────────────────────────────

export const net = withInertFallback(
  {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      mobileFetch(input, init),
    isOnline: (): boolean => (typeof navigator !== 'undefined' ? navigator.onLine : true),
    get online(): boolean {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    },
  },
  'net',
);

// ─── protocol ──────────────────────────────────────────────────────────────────

type ProtocolHandler = (req: Request) => Response | Promise<Response>;
const protocolHandlers = new Map<string, ProtocolHandler>();

export const protocol = withInertFallback(
  {
    registerSchemesAsPrivileged: (): void => {},
    handle: (scheme: string, handler: ProtocolHandler): void => {
      protocolHandlers.set(scheme, handler);
    },
    unhandle: (scheme: string): void => {
      protocolHandlers.delete(scheme);
    },
    isProtocolHandled: (scheme: string): boolean => protocolHandlers.has(scheme),
  },
  'protocol',
);

/** Resolve a custom-scheme request (e.g. `mesh-tiles:`) through the handler main registered. */
export async function handleProtocolRequest(url: string): Promise<Response | null> {
  const scheme = url.slice(0, url.indexOf(':'));
  const handler = protocolHandlers.get(scheme);
  if (!handler) return null;
  return await handler(new Request(url));
}

// ─── screen / theme / misc ─────────────────────────────────────────────────────

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1024, height: 1366 },
  workArea: { x: 0, y: 0, width: 1024, height: 1366 },
  workAreaSize: { width: 1024, height: 1366 },
  size: { width: 1024, height: 1366 },
  scaleFactor: 3,
  rotation: 0,
  internal: true,
  touchSupport: 'available',
};

export const screen = withInertFallback(
  Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => display,
    getAllDisplays: () => [display],
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  }),
  'screen',
);

export const nativeTheme = withInertFallback(
  Object.assign(new EventEmitter(), {
    shouldUseDarkColors: true,
    shouldUseHighContrastColors: false,
    themeSource: 'system',
  }),
  'nativeTheme',
);

export const systemPreferences = withInertFallback(
  Object.assign(new EventEmitter(), {
    getMediaAccessStatus: (): string => 'granted',
    askForMediaAccess: (): Promise<boolean> => Promise.resolve(true),
    isTrustedAccessibilityClient: (): boolean => false,
    getAccentColor: (): string => '38bdf8ff',
    getAnimationSettings: () => ({
      shouldRenderRichAnimation: true,
      scrollAnimationsEnabledBySystem: true,
      prefersReducedMotion: false,
    }),
  }),
  'systemPreferences',
);

let nextBlockerId = 1;
const blockers = new Set<number>();
export const powerSaveBlocker = {
  start: (): number => {
    const id = nextBlockerId++;
    blockers.add(id);
    void requestUi('keepAwake', true).catch(() => {});
    return id;
  },
  stop: (id: number): void => {
    blockers.delete(id);
    if (blockers.size === 0) void requestUi('keepAwake', false).catch(() => {});
  },
  isStarted: (id: number): boolean => blockers.has(id),
};

export const crashReporter = withInertFallback(
  {
    start: (): void => {},
    getUploadedReports: (): unknown[] => [],
    getLastCrashReport: (): null => null,
    getUploadToServer: (): boolean => false,
    setUploadToServer: (): void => {},
    addExtraParameter: (): void => {},
    removeExtraParameter: (): void => {},
    getParameters: (): Record<string, string> => ({}),
  },
  'crashReporter',
);

class MenuShim {
  items: unknown[] = [];
  static buildFromTemplate(): MenuShim {
    return new MenuShim();
  }
  static setApplicationMenu(): void {}
  static getApplicationMenu(): null {
    return null;
  }
  static sendActionToFirstResponder(): void {}
  popup(): void {}
  closePopup(): void {}
  append(): void {}
  insert(): void {}
  getMenuItemById(): null {
    return null;
  }
}
export const Menu = MenuShim;
export class MenuItem {
  constructor(public opts: unknown) {}
}

class TrayShim extends EventEmitter {
  setToolTip(): void {}
  setImage(): void {}
  setContextMenu(): void {}
  setTitle(): void {}
  destroy(): void {}
  isDestroyed(): boolean {
    return false;
  }
  displayBalloon(): void {}
  setIgnoreDoubleClickEvents(): void {}
}
export const Tray = TrayShim;

export const globalShortcut = withInertFallback(
  {
    register: () => false,
    unregister: () => {},
    unregisterAll: () => {},
    isRegistered: () => false,
  },
  'globalShortcut',
);
export const utilityProcess = withInertFallback(
  {
    fork: (): never => {
      throw new Error('utilityProcess is not available on mobile');
    },
  },
  'utilityProcess',
);
export const desktopCapturer = withInertFallback(
  { getSources: () => Promise.resolve([]) },
  'desktopCapturer',
);
export const contentTracing = inert('contentTracing');
export const autoUpdater = withInertFallback(new EventEmitter(), 'autoUpdater');
export const inAppPurchase = inert('inAppPurchase');
export const pushNotifications = inert('pushNotifications');
export const TouchBar = inert('TouchBar');
export const MessageChannelMain = inert('MessageChannelMain');
export const ShareMenu = inert('ShareMenu');

// The main process imports the default export in a few places (`import electron from 'electron'`).
const electronDefault = {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  contentTracing,
  crashReporter,
  desktopCapturer,
  dialog,
  globalShortcut,
  inAppPurchase,
  ipcMain,
  Menu,
  MenuItem,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  pushNotifications,
  safeStorage,
  screen,
  session,
  shell,
  ShareMenu,
  systemPreferences,
  TouchBar,
  Tray,
  utilityProcess,
  webContents,
};
export default electronDefault;
