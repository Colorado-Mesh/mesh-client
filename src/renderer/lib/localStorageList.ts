/**
 * Shared localStorage helpers for canonical string-list prefs (RRC hubs/rooms).
 * Failure point: quota / private mode. Fallback: empty list / no-op write.
 */

export function readRawStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

export function writeStringList(key: string, items: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

/** Load a list, canonicalize, and rewrite storage when the on-disk form drifted. */
export function loadCanonicalStringList(
  key: string,
  canonicalize: (items: string[]) => string[],
): string[] {
  const items = canonicalize(readRawStringList(key));
  try {
    const raw = localStorage.getItem(key);
    if (raw !== JSON.stringify(items)) {
      writeStringList(key, items);
    }
  } catch {
    // catch-no-log-ok
  }
  return items;
}
