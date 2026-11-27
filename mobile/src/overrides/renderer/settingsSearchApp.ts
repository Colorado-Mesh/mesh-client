/**
 * Mobile override of `src/renderer/lib/settingsSearchEntries/app.ts`.
 *
 * Two App settings do nothing in the mobile apps: "Close to tray" (phones have no tray and the
 * system owns the app's lifecycle) and automatic update downloads (the app stores install
 * updates; the mobile host's autoUpdater is inert). mobileShell.css hides their rows, and the
 * launcher search stops listing them here, so a search never jumps to a hidden control.
 * "Prevent sleep while connected" stays: on mobile it keeps the screen awake (keepAwake).
 */
import type { SettingsSearchSurface } from '@/renderer/lib/settingsSearch';
import { appSurface as desktopAppSurface } from '@/renderer/lib/settingsSearchEntries/app';

/** Setting anchors (`data-setting-anchor`) that have no effect on a phone or tablet. */
export const MOBILE_HIDDEN_APP_SETTINGS: ReadonlySet<string> = new Set([
  'app.window.closeToTray',
  'app.updates.autoDownload',
]);

export const appSurface: SettingsSearchSurface = {
  ...desktopAppSurface,
  entries: desktopAppSurface.entries.map((entry) =>
    MOBILE_HIDDEN_APP_SETTINGS.has(entry.id) ? { ...entry, visible: () => false } : entry,
  ),
};
