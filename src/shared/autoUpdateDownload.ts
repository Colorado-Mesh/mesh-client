/**
 * App → Updates auto-download flag stored in SQLite `app_settings`.
 * A missing key stays on (first-run default). Any other value is off.
 * Database read errors are not a stored value; callers treat those as off.
 */
export function autoUpdateDownloadEnabledFromStored(value: string | null | undefined): boolean {
  if (value == null) return true;
  return value === '1';
}
