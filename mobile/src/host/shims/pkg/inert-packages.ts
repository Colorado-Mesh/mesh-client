/**
 * Stand-ins for desktop-only packages in the mobile host bundle:
 * - `electron-updater`: app updates come from the App Store / Play Store.
 * - `systeminformation`: no host hardware inventory on mobile.
 * - `dbus-next`: Linux BlueZ only.
 * - `usocket`: Unix domain sockets.
 */
import { EventEmitter } from 'events';

class InertUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = false;
  channel = 'latest';
  logger: unknown = null;
  forceDevUpdateConfig = false;
  currentVersion = { version: '0.0.0' };
  checkForUpdates(): Promise<null> {
    return Promise.resolve(null);
  }
  checkForUpdatesAndNotify(): Promise<null> {
    return Promise.resolve(null);
  }
  downloadUpdate(): Promise<string[]> {
    return Promise.reject(new Error('Updates are delivered through the app store on mobile'));
  }
  quitAndInstall(): void {}
  setFeedURL(): void {}
}
export const autoUpdater = new InertUpdater();
export class CancellationToken {
  cancel(): void {}
}
export const AppUpdater = InertUpdater;
export const NsisUpdater = InertUpdater;
export const MacUpdater = InertUpdater;
export const AppImageUpdater = InertUpdater;

function empty<T>(v: T) {
  return (): Promise<T> => Promise.resolve(v);
}
const si = new Proxy(
  {},
  {
    get: (_t, prop) => (prop === 'then' ? undefined : empty({})),
  },
);
export const systeminformation = si;

export default si;
