/**
 * Parse persisted JSON (e.g. localStorage) with consistent debug/warn logging.
 * See CONTRIBUTING.md — Error boundaries and logging.
 */
export function parseStoredJson<T>(raw: string | null, context: string): T | null {
  if (raw == null || raw === '') return null;
  try {
    console.debug(`[parseStoredJson] ${context}`);
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[parseStoredJson] ${context} failed`, e);
    return null;
  }
}
