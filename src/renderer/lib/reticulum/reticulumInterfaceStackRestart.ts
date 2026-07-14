/**
 * Interface types that RNS does not hot-apply on a live stack (config is written to
 * disk; bootstrap is required). Sidecar `apply_interfaces` only syncs `ble_peer`.
 */
const STACK_RESTART_INTERFACE_TYPES = new Set([
  'rnode',
  'rnode_multi',
  'kiss',
  'ble_peer',
  'tcp',
  'udp',
  'i2p',
  'auto',
  'pipe',
]);

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
    'mode' in patch
  );
}
