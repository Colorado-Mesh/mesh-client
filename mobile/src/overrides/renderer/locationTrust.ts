/**
 * Mobile override of `src/renderer/lib/locationTrust.ts`: the `browser` position source is the
 * phone's own GNSS fix on mobile (`gps:getFix` prefers the native fix, see
 * `src/host/overrides/gps.ts`), which is precise — so it is trusted. On desktop that source is
 * OS geolocation (Wi-Fi / IP based) and stays approximate. IP estimates stay approximate here too.
 */
import { getLocationTrust as getDesktopLocationTrust } from '@/renderer/lib/locationTrust';

export * from '@/renderer/lib/locationTrust';

export function getLocationTrust(
  ...args: Parameters<typeof getDesktopLocationTrust>
): ReturnType<typeof getDesktopLocationTrust> {
  const [position] = args;
  if (position?.source === 'browser') return 'trusted';
  return getDesktopLocationTrust(...args);
}
