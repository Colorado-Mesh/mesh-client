/** Shared Reticulum config.ini field parsers for interface block scanners. */

export function parseReticulumIniEnabledValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

export function parseReticulumIniInterfaceField(
  line: string,
): { key: string; value: string } | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim().toLowerCase();
  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}
