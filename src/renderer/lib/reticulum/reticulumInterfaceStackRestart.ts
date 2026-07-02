const LOCAL_INTERFACE_TYPES = new Set(['rnode', 'rnode_multi', 'kiss', 'ble_peer']);

/** RNS loads serial/BLE RNode interfaces at stack bootstrap — config edits need a restart. */
export function reticulumInterfaceChangeRequiresStackRestart(
  ifaceType?: string,
  patch?: Record<string, unknown>,
): boolean {
  if (ifaceType && LOCAL_INTERFACE_TYPES.has(ifaceType)) {
    return true;
  }
  if (!patch) {
    return false;
  }
  return (
    'serial_port' in patch || 'preset' in patch || 'callsign' in patch || 'seed_addresses' in patch
  );
}
