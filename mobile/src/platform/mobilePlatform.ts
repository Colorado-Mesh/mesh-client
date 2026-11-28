/**
 * Mobile app detection for shared renderer code.
 *
 * The mobile bootstrap (`mobile/src/main.tsx`) sets `data-mesh-mobile` on `<html>` before the
 * renderer loads. The desktop renderer never sets it, so every mobile-only layout or behavior
 * gated on these helpers leaves the desktop app unchanged.
 */
export type MobileAppPlatform = 'android' | 'ios' | 'web';

const MOBILE_ATTR = 'meshMobile' as const;

function readAttr(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.dataset[MOBILE_ATTR];
}

/** The mobile app platform, or `null` in the desktop (Electron) app. */
export function getMobileAppPlatform(): MobileAppPlatform | null {
  const v = readAttr();
  return v === 'android' || v === 'ios' || v === 'web' ? v : null;
}

/** True only inside the Capacitor mobile app (or its browser harness). */
export function isMobileApp(): boolean {
  return getMobileAppPlatform() !== null;
}

/** @internal Set by the mobile bootstrap; tests use it to simulate the mobile app. */
export function setMobileAppPlatform(platform: MobileAppPlatform | null): void {
  if (typeof document === 'undefined') return;
  if (platform) document.documentElement.dataset[MOBILE_ATTR] = platform;
  else document.documentElement.removeAttribute('data-mesh-mobile');
}
