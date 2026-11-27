/**
 * Mobile app entry (Capacitor WebView). Boot sequence:
 * 1. Mark `<html data-mesh-mobile>` so shared renderer code can gate mobile layout.
 * 2. Read the device key / app info from the native `MeshDevice` plugin.
 * 3. Start the host worker (the unmodified Electron main process on mobile shims) and wait until
 *    main has loaded its window — the same point at which Electron would load the renderer.
 * 4. Run the unmodified preload (builds `window.electronAPI` over the host channel).
 * 5. Load the unmodified renderer entry (`src/renderer/main.tsx`).
 */
import './mobileShell.css';

import { App as CapApp } from '@capacitor/app';

import i18n from '../renderer/lib/i18n';
import { ensureLocaleLoaded } from '../renderer/lib/localeResources';
import { setMobileAppPlatform } from '../renderer/lib/mobilePlatform';
import { RENDERER_INDEX_URL } from '../shared/rendererOrigin';
import { installCustomSchemeImages } from './bridge/customSchemes';
import { sendLifecycle, startHost } from './bridge/hostClient';
import { getPlugin, mobilePlatform } from './bridge/nativePlugins';
import { installMobileSerial } from './serial/installMobileSerial';
import { installMobileViewport } from './viewport/mobileViewport';

interface DeviceInfo {
  appVersion: string;
  sidecarAvailable: boolean;
  locale: string;
}

function renderBootScreen(message?: string, onRetry?: () => void): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const wrap = document.createElement('main');
  wrap.className = 'mobile-boot';
  const mark = document.createElement('div');
  mark.className = 'mobile-boot__mark';
  mark.setAttribute('aria-hidden', 'true');
  wrap.appendChild(mark);
  const status = document.createElement('p');
  status.setAttribute('role', message ? 'alert' : 'status');
  status.textContent = message ? i18n.t('mobile.startFailed') : i18n.t('mobile.starting');
  wrap.appendChild(status);
  if (message) {
    const detail = document.createElement('pre');
    detail.className = 'mobile-boot__error';
    detail.textContent = message;
    wrap.appendChild(detail);
  }
  if (onRetry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.default = 'true';
    b.textContent = i18n.t('mobile.tryAgain');
    b.setAttribute('aria-label', i18n.t('mobile.tryAgain'));
    b.addEventListener('click', onRetry);
    wrap.appendChild(b);
  }
  root.appendChild(wrap);
}

async function boot(): Promise<void> {
  const platform = mobilePlatform();
  setMobileAppPlatform(platform);
  installMobileViewport();
  await ensureLocaleLoaded(i18n, i18n.language).catch((e: unknown) => {
    console.debug('[mobile] boot locale load failed', e);
  });
  renderBootScreen();
  // OPFS is best-effort storage; ask the WebView to keep it (radio history, keys, settings).
  void navigator.storage?.persist?.().then(
    (persisted) => {
      console.debug(`[mobile] persistent storage ${persisted ? 'granted' : 'not granted'}`);
    },
    (e: unknown) => {
      console.debug('[mobile] persistent storage request failed', e);
    },
  );

  const device = getPlugin('MeshDevice') as unknown as {
    getSecureKey(): Promise<{ keyHex: string }>;
    getInfo(): Promise<DeviceInfo>;
  };
  const [{ keyHex }, info] = await Promise.all([device.getSecureKey(), device.getInfo()]);
  const nodePlatform = platform === 'ios' ? 'darwin' : 'linux';

  await startHost({
    workerUrl: new URL('./host/host-worker.js', document.baseURI).href,
    wasmUrl: new URL('./host/sqlite3.wasm', document.baseURI).href,
    sidecarAvailable: info.sidecarAvailable,
    config: {
      mobilePlatform: platform,
      nodePlatform,
      appVersion: info.appVersion,
      safeStorageKeyHex: keyHex,
      locale: info.locale || navigator.language || 'en-US',
      rendererUrl: RENDERER_INDEX_URL,
    },
  });

  void CapApp.addListener('pause', () => {
    sendLifecycle('pause');
  });
  void CapApp.addListener('resume', () => {
    sendLifecycle('resume');
  });
  window.addEventListener('pagehide', () => {
    sendLifecycle('beforeQuit');
  });

  await import('./preloadEntry.js');
  // The preload reports Node's process.platform; mobile maps Android→linux, iOS→darwin.
  (window.electronAPI as unknown as { getPlatform: () => string }).getPlatform = () => nodePlatform;
  installMobileSerial(platform);
  installCustomSchemeImages();

  await import('../renderer/main');
}

function start(): void {
  boot().catch((err: unknown) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`mcL1536 [mobile] boot failed: ${msg}`);
    renderBootScreen(err instanceof Error ? err.message : String(err), () => {
      location.reload();
    });
  });
}

start();
