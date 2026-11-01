import { getAppSettingsRaw } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';

const DEFAULT_MESSAGE_LOAD_LIMIT = 1000;
const DISABLED_MESSAGE_LOAD_LIMIT = 10000;

function sanitizeMessageLimitCount(count: unknown): number {
  if (count == null) return DEFAULT_MESSAGE_LOAD_LIMIT;
  if (typeof count !== 'number' || !Number.isFinite(count) || !Number.isInteger(count)) {
    return DEFAULT_MESSAGE_LOAD_LIMIT;
  }
  return Math.max(1, count);
}

/** Message cap for Meshtastic SQLite load (shared with identity store hydration). */
export function getMeshtasticMessageLoadLimit(): number {
  let raw: string | null;
  try {
    raw = getAppSettingsRaw();
  } catch {
    // catch-no-log-ok localStorage unavailable in node tests / restricted environments
    return DEFAULT_MESSAGE_LOAD_LIMIT;
  }
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(raw, 'meshtasticMessageLoadLimit');
  if (!s) return DEFAULT_MESSAGE_LOAD_LIMIT;
  if (s.messageLimitEnabled === false) return DISABLED_MESSAGE_LOAD_LIMIT;
  return sanitizeMessageLimitCount(s.messageLimitCount);
}
