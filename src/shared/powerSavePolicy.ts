/**
 * App → Window "keep computer awake while connected" policy.
 *
 * Electron's `powerSaveBlocker.start('prevent-app-suspension')` is supposed to keep
 * the system awake while allowing display sleep. On Linux, Chromium implements that
 * via freedesktop PowerManagement.Inhibit, which XFCE/KDE-style managers also treat
 * as a display/DPMS inhibit. There is no Electron API for "suspend only". Prefer
 * holding the blocker less often (`rf` default) rather than adding a DBus subprocess.
 */

/** SQLite `app_settings` key for the App → Window "keep computer awake" setting. */
export const PREVENT_SLEEP_SETTING_KEY = 'preventSleepWhileConnected';

export const POWER_SAVE_MODES = ['off', 'rf', 'always'] as const;
export type PowerSaveMode = (typeof POWER_SAVE_MODES)[number];

/** Default for every platform: only local radio hardware holds the blocker. */
export const DEFAULT_POWER_SAVE_MODE: PowerSaveMode = 'rf';

/** Renderer ConnectionType values that can reach main (`ble | serial | tcp | http`). */
export type PowerSaveLinkType = 'ble' | 'serial' | 'tcp' | 'http';

const POWER_SAVE_LINK_TYPES = new Set<string>(['ble', 'serial', 'tcp', 'http']);

/** Unknown / malformed IPC payloads become null (never throw). */
export function normalizePowerSaveLinkType(value: unknown): PowerSaveLinkType | null {
  if (typeof value !== 'string') return null;
  if (!POWER_SAVE_LINK_TYPES.has(value)) return null;
  return value as PowerSaveLinkType;
}

/** Missing, empty or garbage stored values fall back to the default. */
export function powerSaveModeFromStored(value: string | null | undefined): PowerSaveMode {
  if (value == null || value === '') return DEFAULT_POWER_SAVE_MODE;
  if (value === 'off' || value === 'rf' || value === 'always') return value;
  return DEFAULT_POWER_SAVE_MODE;
}

export interface PowerSaveLinkState {
  connected: boolean;
  /** null when connected but the renderer has not classified the transport yet. */
  link: PowerSaveLinkType | null;
}

export interface PowerSaveConnectionSnapshot {
  meshtastic: PowerSaveLinkState;
  meshcore: PowerSaveLinkState;
  mqtt: boolean;
  reticulumSidecar: boolean;
  /**
   * Sidecar is running and the Reticulum config has an enabled local radio
   * (BLE RNode or serial RNode/KISS). Computed in main from the config dir.
   */
  reticulumLocalRadio: boolean;
}

function isLocalRadioLink(state: PowerSaveLinkState): boolean {
  // Treat unknown link as local while connected: Meshtastic temporarily nulls
  // connectionType during planned reboot / missing-params recovery.
  return (
    state.connected && (state.link === 'ble' || state.link === 'serial' || state.link === null)
  );
}

/**
 * Decide whether main should hold Electron's power-save blocker.
 * Platform- and protocol-agnostic — main supplies the snapshot.
 */
export function shouldHoldPowerSaveBlocker(
  mode: PowerSaveMode,
  snapshot: PowerSaveConnectionSnapshot,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') {
    return (
      snapshot.mqtt ||
      snapshot.reticulumSidecar ||
      snapshot.meshtastic.connected ||
      snapshot.meshcore.connected
    );
  }
  // mode === 'rf'
  return (
    isLocalRadioLink(snapshot.meshtastic) ||
    isLocalRadioLink(snapshot.meshcore) ||
    snapshot.reticulumLocalRadio
  );
}
