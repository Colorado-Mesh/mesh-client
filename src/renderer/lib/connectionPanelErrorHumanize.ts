import type { TFunction } from 'i18next';

import { MESHCORE_SETUP_ABORT_MESSAGE } from './bleConnectErrors';

export function hostFromAddressInput(address: string): string {
  const raw = address.trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    // catch-no-log-ok user-typed host/IP without scheme
    return raw.split('/')[0]?.split(':')[0]?.toLowerCase() ?? '';
  }
}

export function isMeshtasticLocalAddress(address: string): boolean {
  const host = hostFromAddressInput(address);
  return host === 'meshtastic.local' || host.endsWith('.meshtastic.local');
}

type RuntimePlatform = 'linux' | 'darwin' | 'win32' | 'unknown';

function runtimePlatform(): RuntimePlatform {
  if (typeof window !== 'undefined' && window.electronAPI?.getPlatform) {
    const platform = window.electronAPI.getPlatform();
    if (platform === 'linux' || platform === 'darwin' || platform === 'win32') {
      return platform;
    }
    return 'unknown';
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'win32';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('mac')) return 'darwin';
  return 'unknown';
}

export function humanizeSerialError(err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? err.message : String(err);
  const platform = runtimePlatform();
  if (/access denied|permission|not allowed/i.test(msg)) {
    const hint =
      platform === 'win32'
        ? t('connectionPanel.humanize.serial.accessDeniedWindowsHint')
        : platform === 'linux'
          ? t('connectionPanel.humanize.serial.accessDeniedLinuxHint')
          : t('connectionPanel.humanize.serial.disconnectedHint');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (/no port|not found|disconnected|device not found/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.disconnectedHint'),
    });
  }
  if (/timed out/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.timeoutHint'),
    });
  }
  if (/already open|locked stream|cannot cancel a locked/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.portStillOpenHint'),
    });
  }
  return msg;
}

export function humanizeHttpError(address: string, err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isMdns = isMeshtasticLocalAddress(address);
  const platform = runtimePlatform();
  const isWindows = platform === 'win32';
  if (/timed out|timeout|aborted/i.test(msg)) {
    const hint = isMdns
      ? isWindows
        ? t('connectionPanel.humanize.http.timeoutMdnsWindows')
        : t('connectionPanel.humanize.http.timeoutMdnsNonWindows')
      : t('connectionPanel.humanize.http.timeoutGeneric');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (/401|403|unauthorized/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.http.unauthorizedHint'),
    });
  }
  if (/econnrefused|connection refused|failed to fetch|network/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.http.econnrefusedHint'),
    });
  }
  if (isMdns) {
    const suffix = isWindows
      ? t('connectionPanel.humanize.http.suffixMdnsWindows')
      : t('connectionPanel.humanize.http.suffixMdnsNonWindows');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint: suffix });
  }
  return msg;
}

export function humanizeBleError(err: unknown, t: TFunction): string {
  if (
    err instanceof DOMException &&
    err.name === 'AbortError' &&
    err.message === MESHCORE_SETUP_ABORT_MESSAGE
  ) {
    return '';
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              // catch-no-log-ok stringify fallback for arbitrary renderer error shapes
              return String(err);
            }
          })();
  const platform = runtimePlatform();
  const isWindows = platform === 'win32';
  const isLinux = platform === 'linux';
  const isDarwin = platform === 'darwin';
  if (msg.includes('Bluetooth adapter not found') || msg.includes('adapter is not available')) {
    const hint = isWindows
      ? t('connectionPanel.humanize.ble.adapterWindowsHint')
      : isLinux
        ? t('connectionPanel.humanize.ble.adapterLinuxHint')
        : t('connectionPanel.humanize.ble.adapterGenericHint');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (msg.includes('SecurityError') || msg.includes('not allowed to access')) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.securityPermissionHint'),
    });
  }
  if (msg.includes('GATT Server is disconnected')) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.gattDisconnectedHint'),
    });
  }
  if (msg.includes('GATT Error: Not supported')) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.gattNotSupportedBase')}`;
    if (isLinux) {
      enhanced += t('connectionPanel.humanize.ble.gattNotSupportedLinuxPin');
    }
    return enhanced;
  }
  if (err instanceof DOMException) {
    if (err.name === 'SecurityError') {
      let enhanced = t('connectionPanel.humanize.ble.authFailedBase', { message: err.message });
      if (isLinux) {
        enhanced += t('connectionPanel.humanize.ble.authFailedLinuxPin');
      }
      return enhanced;
    }
    if (err.name === 'NetworkError') {
      let enhanced = t('connectionPanel.humanize.ble.networkFailedBase', { message: err.message });
      if (isLinux) {
        enhanced += t('connectionPanel.humanize.ble.networkFailedLinuxHint');
      } else {
        enhanced += t('connectionPanel.humanize.ble.networkFailedNonLinuxHint');
      }
      return enhanced;
    }
  }
  if (msg.includes('Connection Error: Connection attempt failed')) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.connectionAttemptFailedBase')}`;
    if (isLinux) {
      enhanced += t('connectionPanel.humanize.ble.connectionAttemptFailedLinuxHint');
    }
    return enhanced;
  }
  if (/Bluetooth connected but MeshCore protocol handshake did not complete/i.test(msg)) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.meshcoreHandshakeHint')}`;
    if (isWindows) {
      enhanced += t('connectionPanel.humanize.ble.meshcoreHandshakeWindowsExtra');
    }
    return enhanced;
  }
  if (/Bluetooth connection timed out while opening MeshCore over Noble IPC/i.test(msg)) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.meshcoreHandshakeHint')}`;
    if (isWindows) {
      enhanced += t('connectionPanel.humanize.ble.meshcoreHandshakeWindowsExtra');
    }
    return enhanced;
  }
  if (/already in progress/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.dualProtocolContentionHint'),
    });
  }
  if (
    isDarwin &&
    (/BLE connectAsync timed out/i.test(msg) ||
      /BLE peripheral not found/i.test(msg) ||
      /unknown peripheral/i.test(msg))
  ) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.macWakeRecoveryHint'),
    });
  }
  return msg;
}

export function humanizeReticulumSidecarError(err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('RETICULUM_CARGO_MISSING') || /cargo.*not found/i.test(msg)) {
    return t('connectionPanel.reticulumSidecarCargoMissing');
  }
  if (
    msg.includes('RETICULUM_SIDECAR') ||
    msg.includes('sidecar binary not found') ||
    msg.includes('RETICULUM_CARGO_BUILD_FAILED')
  ) {
    if (msg.includes('RETICULUM_CARGO_BUILD_FAILED')) {
      return t('connectionPanel.reticulumSidecarStartFailed', { message: msg });
    }
    return t('connectionPanel.reticulumSidecarMissing');
  }
  return t('connectionPanel.reticulumSidecarStartFailed', { message: msg });
}
