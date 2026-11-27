// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (src/mobile/bridge/nativePlugins.ts)
/**
 * Browser stand-in for the native `MeshDevice` plugin (safeStorage key, app info, fold state).
 * The key is generated once per browser profile and kept in localStorage — test harness only;
 * native builds keep it in Android Keystore / iOS Keychain.
 */
import { WebPlugin } from '@capacitor/core';

const KEY = 'mesh-mobile:web-safe-storage-key';

export class WebMeshDevice extends WebPlugin {
  getSecureKey(): Promise<{ keyHex: string }> {
    let hex: string;
    try {
      hex = localStorage.getItem(KEY) ?? '';
    } catch {
      hex = ''; // catch-no-log-ok storage blocked; generate an ephemeral key
    }
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      try {
        localStorage.setItem(KEY, hex);
      } catch {
        // catch-no-log-ok ephemeral key for this session
      }
    }
    return Promise.resolve({ keyHex: hex });
  }
  getInfo(): Promise<{ appVersion: string; sidecarAvailable: boolean; locale: string }> {
    return Promise.resolve({
      appVersion: '0.0.0-web',
      sidecarAvailable: false,
      locale: navigator.language || 'en-US',
    });
  }
  getFoldState(): Promise<{ folds: never[] }> {
    return Promise.resolve({ folds: [] });
  }
  keepAwake(): Promise<void> {
    return Promise.resolve();
  }
  setBackgroundMode(): Promise<void> {
    return Promise.resolve();
  }
}
