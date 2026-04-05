/**
 * Canonical defaults for keys stored in localStorage `mesh-client:appSettings`.
 * Used by AppPanel and App startup pruning so behavior matches when keys are absent.
 */
export const DEFAULT_APP_SETTINGS_SHARED = {
  autoPruneEnabled: true,
  autoPruneDays: 30,
  pruneEmptyNamesEnabled: true,
  nodeCapEnabled: true,
  nodeCapCount: 10000,
  positionHistoryPruneEnabled: true,
  positionHistoryPruneDays: 30,
  meshcoreAutoPruneEnabled: true,
  meshcoreAutoPruneDays: 30,
  meshcoreContactCapEnabled: true,
  meshcoreContactCapCount: 5000,
  meshcoreDeleteNeverAdvertised: true,
  distanceFilterEnabled: false,
  distanceFilterMax: 500,
  distanceUnit: 'miles' as const,
  coordinateFormat: 'decimal' as const,
  autoFloodAdvertIntervalHours: 12,
};
