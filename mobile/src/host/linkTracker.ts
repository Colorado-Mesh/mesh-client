/**
 * Counts live radio/network links in the host worker (TCP/TLS sockets, BLE GATT sessions, the
 * Reticulum sidecar) and tells the UI thread when the count goes between zero and non-zero, so
 * the app can hold the Android foreground service (`MeshDevice.setBackgroundMode`) only while a
 * link would otherwise be throttled in the background. Short-lived sockets (host-link RTT
 * probes) are smoothed out by the debounce.
 */
import { requestUi } from './hostChannel';

const DEBOUNCE_MS = 2_000;
const links = new Map<string, number>();
let reported = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function total(): number {
  let n = 0;
  for (const v of links.values()) n += v;
  return n;
}

function scheduleReport(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const active = total() > 0;
    if (active === reported) return;
    reported = active;
    void requestUi('backgroundLinks', {
      active,
      kinds: [...links.entries()].filter(([, v]) => v > 0).map(([k]) => k),
    }).catch((e: unknown) => {
      console.debug(`[mobile/links] report failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, DEBOUNCE_MS);
}

export function linkOpened(kind: string): void {
  links.set(kind, (links.get(kind) ?? 0) + 1);
  scheduleReport();
}

export function linkClosed(kind: string): void {
  const n = (links.get(kind) ?? 0) - 1;
  if (n <= 0) links.delete(kind);
  else links.set(kind, n);
  scheduleReport();
}

/** @internal test hook */
export function activeLinkCount(): number {
  return total();
}
