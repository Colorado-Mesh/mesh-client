/**
 * `electron` module for the preload when it runs in the mobile WebView (aliased by
 * `mobile/vite.config.mts`). The unmodified `src/preload/index.ts` builds the same
 * `window.electronAPI`; its `ipcRenderer` calls travel to the mobile host worker.
 */
import { hostInvoke, hostOff, hostOn, hostSend } from './hostClient';

export type Listener = (event: unknown, ...args: unknown[]) => void;

export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => hostInvoke(channel, args),
  send: (channel: string, ...args: unknown[]): void => {
    hostSend(channel, args);
  },
  sendSync: (channel: string): never => {
    throw new Error(`ipcRenderer.sendSync('${channel}') is not supported on mobile`);
  },
  on(channel: string, listener: Listener) {
    hostOn(channel, listener);
    return ipcRenderer;
  },
  addListener(channel: string, listener: Listener) {
    return ipcRenderer.on(channel, listener);
  },
  once(channel: string, listener: Listener) {
    const wrapped: Listener = (event, ...args) => {
      hostOff(channel, wrapped);
      listener(event, ...args);
    };
    hostOn(channel, wrapped);
    return ipcRenderer;
  },
  removeListener(channel: string, listener: Listener) {
    hostOff(channel, listener);
    return ipcRenderer;
  },
  off(channel: string, listener: Listener) {
    return ipcRenderer.removeListener(channel, listener);
  },
  removeAllListeners(channel?: string) {
    hostOff(channel ?? null, null);
    return ipcRenderer;
  },
  postMessage: (channel: string, message: unknown): void => {
    hostSend(channel, [message]);
  },
};

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown): void {
    Object.defineProperty(window, key, {
      value: api,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  },
  exposeInIsolatedWorld(_worldId: number, key: string, api: unknown): void {
    contextBridge.exposeInMainWorld(key, api);
  },
};

export const webUtils = {
  getPathForFile: (file: File): string => (file as File & { path?: string }).path ?? '',
};

export const webFrame = {
  setZoomFactor: (): void => {},
  getZoomFactor: (): number => 1,
  setVisualZoomLevelLimits: (): Promise<void> => Promise.resolve(),
};

export default { ipcRenderer, contextBridge, webUtils, webFrame };
