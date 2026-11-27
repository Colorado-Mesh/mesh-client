/**
 * Message protocol between the mobile UI thread (WebView window) and the mobile host worker.
 *
 * The host worker runs the unmodified Electron main-process code (`src/main/**`) on top of
 * Node/Electron shims. The UI thread runs the unmodified preload + renderer. The two talk over
 * `postMessage` using the envelopes below:
 *
 * - `invoke` / `result`: `ipcRenderer.invoke` ↔ `ipcMain.handle`
 * - `send`: `ipcRenderer.send` → `ipcMain.on`
 * - `event`: `webContents.send` → `ipcRenderer.on`
 * - `native` / `nativeResult`: the worker calls a Capacitor plugin method (plugins only exist on
 *   the UI thread)
 * - `nativeEvent`: a Capacitor plugin listener event forwarded to the worker
 */

export interface HostBootConfig {
  /** Mobile OS reported to the user-facing UI. */
  mobilePlatform: 'android' | 'ios' | 'web';
  /** `process.platform` value the shared main/renderer code sees (`linux` on Android, `darwin` on iOS). */
  nodePlatform: 'linux' | 'darwin';
  appVersion: string;
  /** Hex master key for the `safeStorage` shim (from Android Keystore / iOS Keychain). */
  safeStorageKeyHex: string;
  locale: string;
  /** Renderer URL used to satisfy `validateIpcSender` (custom renderer origin). */
  rendererUrl: string;
}

export interface InvokeMessage {
  t: 'invoke';
  id: number;
  channel: string;
  args: unknown[];
}

export interface SendMessage {
  t: 'send';
  channel: string;
  args: unknown[];
}

export interface ResultMessage {
  t: 'result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: SerializedError;
}

export interface EventMessage {
  t: 'event';
  channel: string;
  args: unknown[];
}

export interface NativeCallMessage {
  t: 'native';
  id: number;
  plugin: string;
  method: string;
  args: unknown[];
}

export interface NativeResultMessage {
  t: 'nativeResult';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: SerializedError;
}

export interface NativeEventMessage {
  t: 'nativeEvent';
  plugin: string;
  event: string;
  data: unknown;
}

export interface BootMessage {
  t: 'boot';
  config: HostBootConfig;
}

export interface ReadyMessage {
  t: 'ready';
}

export interface BootFailedMessage {
  t: 'bootFailed';
  error: SerializedError;
}

export interface HostLogMessage {
  t: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
}

/** App lifecycle signals from the UI thread (Capacitor `App` plugin). */
export interface LifecycleMessage {
  t: 'lifecycle';
  state: 'pause' | 'resume' | 'beforeQuit';
}

/** Main → UI request (dialogs, shell.openExternal, clipboard, notifications). */
export interface UiRequestMessage {
  t: 'ui';
  id: number;
  op: string;
  args: unknown[];
}

export interface UiResultMessage {
  t: 'uiResult';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: SerializedError;
}

export type UiToHostMessage =
  | BootMessage
  | InvokeMessage
  | SendMessage
  | NativeResultMessage
  | NativeEventMessage
  | LifecycleMessage
  | UiResultMessage;

export type HostToUiMessage =
  | ReadyMessage
  | BootFailedMessage
  | ResultMessage
  | EventMessage
  | NativeCallMessage
  | HostLogMessage
  | UiRequestMessage;

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return {
      name: err.name,
      message: err.message,
      code: typeof code === 'string' ? code : undefined,
      stack: err.stack,
    };
  }
  return { name: 'Error', message: String(err) };
}

export function deserializeError(e: SerializedError | undefined): Error {
  const err = new Error(e?.message ?? 'Unknown error');
  err.name = e?.name ?? 'Error';
  if (e?.code) (err as Error & { code?: string }).code = e.code;
  return err;
}
