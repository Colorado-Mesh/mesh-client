import { getAppSettingsRaw } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';

/** Message cap for Meshtastic SQLite load (shared with identity store hydration). */
export function getMeshtasticMessageLoadLimit(): number {
  let raw: string | null;
  try {
    raw = getAppSettingsRaw();
  } catch {
    // catch-no-log-ok localStorage unavailable in node tests / restricted environments
    return 1000;
  }
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(raw, 'meshtasticMessageLoadLimit');
  if (!s) return 1000;
  if (s.messageLimitEnabled === false) return 10000;
  return Math.max(1, s.messageLimitCount ?? 1000);
}
