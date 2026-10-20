/**
 * App → Window "close to tray" flag stored in SQLite `app_settings`.
 * A missing key stays on (first-run default). Any other value except '1' is off.
 * Database read errors are not a stored value; callers fall back to the default.
 */
/** `app_settings` key backing the App → Window "close to tray" toggle. */
export const CLOSE_TO_TRAY_SETTING_KEY = 'closeToTray';

export function closeToTrayEnabledFromStored(value: string | null | undefined): boolean {
  if (value == null) return true;
  return value === '1';
}

export type WindowCloseAction = 'allow' | 'hide' | 'minimize';

export interface WindowCloseDecisionInput {
  platform: NodeJS.Platform;
  isQuitting: boolean;
  hasConnection: boolean;
  closeToTrayEnabled: boolean;
}

/**
 * Decide what a BrowserWindow 'close' event should do.
 * - Quitting, or nothing keeping the app alive, lets the window close.
 * - With close-to-tray on, the window hides to the tray/menu bar on every platform.
 * - With the setting off, preserve legacy behaviour: hide on macOS, minimize elsewhere.
 */
export function resolveWindowCloseAction(input: WindowCloseDecisionInput): WindowCloseAction {
  if (input.isQuitting || !input.hasConnection) return 'allow';
  if (input.closeToTrayEnabled) return 'hide';
  return input.platform === 'darwin' ? 'hide' : 'minimize';
}
