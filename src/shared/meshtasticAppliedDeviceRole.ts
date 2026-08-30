/** Parse device.role from a Meshtastic Config device slice. */
export function meshtasticDeviceRoleFromConfigSlice(deviceSlice: unknown): number | null {
  if (deviceSlice == null || typeof deviceSlice !== 'object') return null;
  const role = (deviceSlice as { role?: unknown }).role;
  return typeof role === 'number' && Number.isFinite(role) ? role : null;
}

/**
 * Canonical applied Meshtastic device role for location-sharing gates.
 * Prefer the device config slice (radio truth) over NodeDB role (may lag after apply).
 */
export function resolveAppliedMeshtasticDeviceRole(
  deviceConfigRole: number | null | undefined,
  nodeDbRole: number | null | undefined,
): number | null {
  if (typeof deviceConfigRole === 'number' && Number.isFinite(deviceConfigRole)) {
    return deviceConfigRole;
  }
  if (typeof nodeDbRole === 'number' && Number.isFinite(nodeDbRole)) {
    return nodeDbRole;
  }
  return null;
}
