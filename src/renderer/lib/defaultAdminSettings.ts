/**
 * Canonical defaults for keys stored in localStorage `mesh-client:adminSettings`.
 * Used by AppPanel and App startup pruning so behavior matches when keys are absent.
 */
export const DEFAULT_ADMIN_SETTINGS_SHARED = {
  autoPruneEnabled: true,
  autoPruneDays: 30,
  pruneEmptyNamesEnabled: true,
  nodeCapEnabled: true,
  nodeCapCount: 10000,
  distanceFilterEnabled: false,
  distanceFilterMax: 500,
  distanceUnit: 'miles' as const,
};
