import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { isValidConnectHost, stripConnectHostBrackets } from '../../shared/connectHost';
import type { TAKRemoteSettings } from '../../shared/tak-types';
import { TCP_PORT_MAX, TCP_PORT_MIN } from '../../shared/tcpPort';

export const DEFAULT_TAK_REMOTE_PORT = 8089;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'tak-remote-settings.json');
}

export function validateTakRemoteSettings(
  settings: unknown,
): asserts settings is TAKRemoteSettings {
  if (!settings || typeof settings !== 'object') {
    throw new Error('tak:remoteStart: settings must be an object');
  }
  const s = settings as Record<string, unknown>;
  if (typeof s.host !== 'string' || !isValidConnectHost(s.host)) {
    throw new Error('tak:remoteStart: host must be a hostname or IP address');
  }
  if (
    typeof s.port !== 'number' ||
    !Number.isInteger(s.port) ||
    s.port < TCP_PORT_MIN ||
    s.port > TCP_PORT_MAX
  ) {
    throw new Error(`tak:remoteStart: port must be an integer ${TCP_PORT_MIN}-${TCP_PORT_MAX}`);
  }
  if (typeof s.verifyServer !== 'boolean') {
    throw new Error('tak:remoteStart: verifyServer must be boolean');
  }
  if (typeof s.autoConnect !== 'boolean') {
    throw new Error('tak:remoteStart: autoConnect must be boolean');
  }
}

/** Host as `tls.connect` expects it: trimmed, IPv6 literals without brackets. */
export function tlsConnectHost(host: string): string {
  return stripConnectHostBrackets(host);
}

/** Saved relay settings, or null when none were saved. Throws when the file is corrupt. */
export function loadTakRemoteSettings(): TAKRemoteSettings | null {
  const file = settingsPath();
  if (!fs.existsSync(file)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
  validateTakRemoteSettings(raw);
  return raw;
}

/**
 * Persist only the known fields, through a temp file so a crash mid-write cannot leave a
 * truncated settings file that would block auto-connect on the next launch.
 */
export function saveTakRemoteSettings(settings: TAKRemoteSettings): void {
  const data: TAKRemoteSettings = {
    host: settings.host.trim(),
    port: settings.port,
    verifyServer: settings.verifyServer,
    autoConnect: settings.autoConnect,
  };
  const file = settingsPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
