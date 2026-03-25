/** Primary Linux dev entry for BLE + GUI from source (see package.json `linux`). */
export const LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT = 'npm run linux';

/** One-line manual command (copy-paste); same flow as `npm run linux`. */
export const LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET =
  'sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc "export DISPLAY=$DISPLAY; export XAUTHORITY=$XAUTHORITY; npm start -- -no-sandbox"';

export const LINUX_BLE_DEV_LAUNCH_SETCAP_ROLLBACK =
  'sudo setcap -r ./node_modules/electron/dist/electron';

export function linuxBleHumanizeCapabilityMissingMessage(): string {
  return `Linux BLE permissions are missing. Preferred: run ${LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT} from the repo root. Manual (same capability): ${LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET} If setcap was previously applied to local Electron, remove it with ${LINUX_BLE_DEV_LAUNCH_SETCAP_ROLLBACK}. For releases: run setcap on the extracted executable (AppImage must be extracted first), then restart the app.`;
}

export function linuxBleHumanizeCapabilityMaybeMessage(originalMsg: string): string {
  return `${originalMsg} — Linux BLE may be missing permissions. Preferred: ${LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT} from the repo root. Manual: ${LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET}`;
}

export function linuxBleCapabilityWarningBanner(): string {
  return `Bluetooth permissions missing on Linux (CAP_NET_RAW). Preferred: ${LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT} from the repo root. Manual: ${LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET}. For release binaries, run setcap on the installed/extracted executable (AppImage must be extracted first).`;
}

/** Body after the BLE_LINUX_CAPABILITY_MISSING prefix (used by main process). */
export function linuxBleNobleCapabilityErrorBody(): string {
  return `Preferred: run ${LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT} from the repo root. Manual (ambient capability): ${LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET} If you previously used file capabilities and hit startup issues, remove them with: ${LINUX_BLE_DEV_LAUNCH_SETCAP_ROLLBACK}. For release builds, run setcap on the extracted executable (not the .AppImage wrapper).`;
}
