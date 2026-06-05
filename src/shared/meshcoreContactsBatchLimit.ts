/** Max MeshCore contacts per SQLite upsert slice (IPC payload guard). */
export const MESHCORE_CONTACTS_BATCH_MAX = 500;

/** Number of batch slices required to persist `total` contacts. */
export function meshcoreContactsBatchSliceCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / MESHCORE_CONTACTS_BATCH_MAX);
}
