import { getAppSettingsRaw } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';

/** Message cap for Meshtastic SQLite load (shared with identity store hydration). */
export function getMeshtasticMessageLoadLimit(): number {
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(getAppSettingsRaw(), 'meshtasticMessageLoadLimit');
  if (!s) return 1000;
  if (s.messageLimitEnabled === false) return 10000;
  return Math.max(1, s.messageLimitCount ?? 1000);
}
