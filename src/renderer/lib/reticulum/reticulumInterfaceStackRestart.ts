import { RETICULUM_INTERFACE_CATALOG } from '@/renderer/lib/reticulum/reticulumInterfaceCatalog';

/**
 * Interface types that RNS does not hot-apply on a live stack (config is written to
 * disk; bootstrap is required). Sidecar `apply_interfaces` only syncs `ble_peer`.
 * Driven by `requiresStackRestart` in the shared catalog: a new type that forgets
 * this flag would be written to disk and silently never come up.
 */
const STACK_RESTART_INTERFACE_TYPES = new Set(
  Object.entries(RETICULUM_INTERFACE_CATALOG)
    .filter(([, entry]) => entry.requiresStackRestart)
    .map(([type]) => type),
);

/** True when add/enable/edit of this interface needs a stack restart to take effect. */
export function reticulumInterfaceChangeRequiresStackRestart(
  ifaceType?: string,
  patch?: Record<string, unknown>,
): boolean {
  if (ifaceType && STACK_RESTART_INTERFACE_TYPES.has(ifaceType)) {
    return true;
  }
  if (!patch) {
    return false;
  }
  return (
    'serial_port' in patch ||
    'preset' in patch ||
    'callsign' in patch ||
    'seed_addresses' in patch ||
    'frequency' in patch ||
    'bandwidth' in patch ||
    'spreading_factor' in patch ||
    'coding_rate' in patch ||
    'txpower' in patch ||
    'host' in patch ||
    'port' in patch ||
    'command' in patch ||
    'mode' in patch ||
    'flow_control' in patch
  );
}
