/** Drop one key from a string-keyed record without `delete` (eslint no-dynamic-delete). */
export function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k !== key) out[k] = v;
  }
  return out;
}
