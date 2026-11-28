// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (mobile/src/bridge/nativePlugins.ts)
/**
 * Browser stand-in for the native `MeshDevice` plugin (safeStorage key, app info, fold state).
 * The key is generated once per browser profile and kept in localStorage — test harness only;
 * native builds keep it in Android Keystore / iOS Keychain.
 */
import { WebPlugin } from '@capacitor/core';

import type { NativeFoldState } from '../../native/contracts';
import { bridgeClient } from './webBridgeClient';

const KEY = 'mesh-mobile:web-safe-storage-key';
/**
 * Browser harness only: fold and occlusion geometry a test sets before boot (localStorage JSON
 * `NativeFoldState`), standing in for Jetpack WindowManager / iOS reserved regions.
 */
const GEOMETRY_KEY = 'mesh-mobile:web-device-geometry';
/** Browser harness only: `window` event whose `detail` is a new `NativeFoldState`. */
export const WEB_GEOMETRY_EVENT = 'mesh-mobile:device-geometry';

function storedGeometry(): NativeFoldState {
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<NativeFoldState>) : {};
    return {
      folds: Array.isArray(parsed.folds) ? parsed.folds : [],
      ...(Array.isArray(parsed.occlusions) ? { occlusions: parsed.occlusions } : {}),
    };
  } catch (e) {
    console.debug('[mobile/web] no stored device geometry', e);
    return { folds: [] };
  }
}

export class WebMeshDevice extends WebPlugin {
  constructor() {
    super();
    window.addEventListener(WEB_GEOMETRY_EVENT, (event) => {
      const state = (event as CustomEvent<NativeFoldState>).detail;
      this.notifyListeners('foldChanged', state);
    });
  }

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
  async getInfo(): Promise<{ appVersion: string; sidecarAvailable: boolean; locale: string }> {
    let sidecarAvailable = false;
    try {
      sidecarAvailable =
        ((await bridgeClient.call('procInfo', {})) as { sidecarAvailable?: boolean })
          .sidecarAvailable === true;
    } catch (e) {
      console.debug('[mobile/web] no bridge; Reticulum sidecar unavailable', e);
    }
    return { appVersion: '0.0.0-web', sidecarAvailable, locale: navigator.language || 'en-US' };
  }
  getFoldState(): Promise<NativeFoldState> {
    return Promise.resolve(storedGeometry());
  }
  keepAwake(): Promise<void> {
    return Promise.resolve();
  }
  setBackgroundMode(): Promise<void> {
    return Promise.resolve();
  }
}
