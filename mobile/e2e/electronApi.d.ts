/** `window.electronAPI` as installed by the preload in the mobile app's WebView. */
import type { ElectronAPI } from '../../src/shared/electron-api.types';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
