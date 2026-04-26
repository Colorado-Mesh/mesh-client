/** Max rows returned by `getAllMeshcorePathHistory` (startup / full hydrate) to avoid OOM. */
export const MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT = 10_000;

/** Max rows per node from `getMeshcorePathHistory` (per-contact load). */
export const MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT = 500;
