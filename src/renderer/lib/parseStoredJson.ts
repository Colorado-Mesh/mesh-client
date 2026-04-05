/**
 * Parse persisted JSON (e.g. localStorage); warn on parse failure.
 * See CONTRIBUTING.md — Error boundaries and logging.
 */
// Generic is only for call-site inference (return is still `as T`); keep the ergonomic API.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is for caller inference only
export function parseStoredJson<T>(raw: string | null, context: string): T | null {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[parseStoredJson] ${context} failed`, e);
    return null;
  }
}
