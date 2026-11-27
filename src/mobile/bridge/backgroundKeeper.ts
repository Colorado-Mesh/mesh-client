/**
 * Holds the Android foreground service (`MeshDevice.setBackgroundMode`) while any radio or network
 * link is live, so Android does not throttle the WebView and host worker in the background:
 * links in the host worker (TCP, BLE, Reticulum sidecar — reported via the `backgroundLinks` UI
 * request) plus USB serial ports opened by the `navigator.serial` polyfill on this thread.
 * iOS implements `setBackgroundMode` as a no-op (BLE uses the bluetooth-central background mode).
 */
import i18n from '../../renderer/lib/i18n';
import { getPlugin } from './nativePlugins';

let workerLinksActive = false;
let serialPortsOpen = 0;
let enabled = false;
let pending: Promise<void> = Promise.resolve();

function notificationText(): { title: string; text: string } {
  return { title: i18n.t('mobile.backgroundTitle'), text: i18n.t('mobile.backgroundText') };
}

function apply(): void {
  const want = workerLinksActive || serialPortsOpen > 0;
  if (want === enabled) return;
  enabled = want;
  pending = pending.then(async () => {
    const device = getPlugin('MeshDevice') as unknown as {
      setBackgroundMode?: (o: { enabled: boolean; title?: string; text?: string }) => Promise<void>;
    };
    if (typeof device.setBackgroundMode !== 'function') return;
    try {
      await device.setBackgroundMode(
        want ? { enabled: true, ...notificationText() } : { enabled: false },
      );
    } catch (e) {
      console.warn(
        `mcL1526 [mobile] background mode ${want ? 'enable' : 'disable'} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}

export function setWorkerLinksActive(active: boolean): void {
  workerLinksActive = active;
  apply();
}

export function serialPortOpened(): void {
  serialPortsOpen += 1;
  apply();
}

export function serialPortClosed(): void {
  serialPortsOpen = Math.max(0, serialPortsOpen - 1);
  apply();
}

/** @internal test hook */
export function isBackgroundModeEnabled(): boolean {
  return enabled;
}
