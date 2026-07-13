const DISPLAY_NAME_JSON_KEYS = ['server_name', 'name', 'display_name', 'title'] as const;

const MAX_DISPLAY_NAME_LEN = 128;

function isPlausibleDisplayName(s: string): boolean {
  if (!s || s.length > MAX_DISPLAY_NAME_LEN) return false;
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code < 32 && c !== '\t') return false;
    if (code === 127) return false;
  }
  return true;
}

function displayNameFromJsonObject(obj: Record<string, unknown>): string | undefined {
  for (const key of DISPLAY_NAME_JSON_KEYS) {
    const value = obj[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/**
 * Normalize Reticulum announce / contact display names.
 * Extracts known JSON keys (e.g. Nomad BBS `server_name`); rejects RMAP/geo blobs.
 */
export function sanitizeReticulumDisplayName(raw?: string | null): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('{')) {
    return isPlausibleDisplayName(trimmed) ? trimmed : undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const name = displayNameFromJsonObject(parsed as Record<string, unknown>);
    if (!name || !isPlausibleDisplayName(name)) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

/** Sanitize before SQLite upsert; returns null when the value is not a usable display name. */
export function sanitizeReticulumDisplayNameForDb(raw?: string | null): string | null {
  return sanitizeReticulumDisplayName(raw) ?? null;
}
