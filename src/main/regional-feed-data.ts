import type { BeaconJsonObject, BeaconJsonValue } from '../shared/beacon';

export function isRegionalObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Only bounded JSON records may leave a public regional service and cross IPC. */
function isBoundedJson(value: unknown, depth = 0): value is BeaconJsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 65_536;
  if (Array.isArray(value)) {
    return value.length <= 5_000 && value.every((item) => isBoundedJson(item, depth + 1));
  }
  if (!isRegionalObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 128 &&
    entries.every(([key, item]) => key.length <= 128 && isBoundedJson(item, depth + 1))
  );
}

export function boundedRegionalRecord(value: unknown): BeaconJsonObject | null {
  return isRegionalObject(value) && isBoundedJson(value) ? value : null;
}

export function regionalDirectoryItems(
  value: unknown,
  max: number,
  key = 'items',
): BeaconJsonObject[] {
  const rows = Array.isArray(value) ? value : isRegionalObject(value) ? value[key] : null;
  if (!Array.isArray(rows)) throw new Error('The regional map returned an invalid directory.');
  return rows.slice(0, max).flatMap((row) => {
    const record = boundedRegionalRecord(row);
    return record ? [record] : [];
  });
}
