/**
 * MeshCore SQLite hydration windows.
 *
 * A global-only newest-N load lets busy Public traffic crowd quiet group channels
 * (e.g. `#emergency`) out of the in-memory store. Hydration keeps the global
 * recent window and also takes a recent window per logical channel (group / DM /
 * room), then merges by row id.
 */

/** Newest rows across all logical channels (insert-order `id`). */
export const MESHCORE_DB_MESSAGE_LOAD_LIMIT = 500;

/** Extra room BBS rows (logical channel -2) beyond the per-channel floor. */
export const MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT = 200;

/** Recent rows kept per non-room logical channel (group slot or DM -1). */
export const MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT = 100;
