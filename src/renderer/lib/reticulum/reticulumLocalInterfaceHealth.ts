export const RETICULUM_LOCAL_SERIAL_INTERFACE_TYPES = new Set(['rnode', 'rnode_multi', 'kiss']);

const ONLINE_STATUSES = new Set(['up', 'connected', 'online', 'running']);

export type ReticulumLocalInterfaceHealth =
  'online' | 'stale_port' | 'enabled_down' | 'disabled' | null;

export interface ReticulumLocalInterfaceInput {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  serial_port?: string | null;
}

export interface ReticulumLocalInterfaceAlert {
  iface: ReticulumLocalInterfaceInput;
  reason: 'stale_port' | 'enabled_down';
}

export interface ReticulumLocalInterfaceHealthOptions {
  /** When set and `now` is before this timestamp, enabled BLE RNodes show as connecting. */
  bleConnectGraceExpiresAt?: number;
  now?: number;
}

function isWithinBleConnectGrace(options?: ReticulumLocalInterfaceHealthOptions): boolean {
  const expiresAt = options?.bleConnectGraceExpiresAt;
  if (expiresAt == null || expiresAt <= 0) {
    return false;
  }
  const now = options?.now ?? Date.now();
  return now < expiresAt;
}

function isBleEnabledDownInGrace(
  iface: ReticulumLocalInterfaceInput,
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): boolean {
  if (!isWithinBleConnectGrace(options)) {
    return false;
  }
  if (classifyReticulumLocalInterface(iface, osSerialPorts) !== 'enabled_down') {
    return false;
  }
  return reticulumLocalOfflineDisplayKind(iface) === 'ble';
}

export function isReticulumLocalSerialInterface(type: string): boolean {
  return RETICULUM_LOCAL_SERIAL_INTERFACE_TYPES.has(type.toLowerCase());
}

export function isReticulumInterfaceOnlineStatus(status: string): boolean {
  return ONLINE_STATUSES.has(status.trim().toLowerCase());
}

/** RNode Bluetooth transport uses `ble://…` in `serial_port`, not an OS serial device path. */
export function isReticulumBleRnodeSerialPort(port: string | null | undefined): boolean {
  return typeof port === 'string' && port.trim().toLowerCase().startsWith('ble://');
}

export type ReticulumLocalOfflineDisplayKind = 'serial' | 'ble';

export function reticulumLocalOfflineDisplayKind(
  iface: Pick<ReticulumLocalInterfaceInput, 'serial_port'>,
): ReticulumLocalOfflineDisplayKind {
  return isReticulumBleRnodeSerialPort(iface.serial_port) ? 'ble' : 'serial';
}

export function classifyReticulumLocalInterface(
  iface: ReticulumLocalInterfaceInput,
  osSerialPorts: readonly string[],
): ReticulumLocalInterfaceHealth {
  if (!isReticulumLocalSerialInterface(iface.type)) {
    return null;
  }
  if (!iface.enabled) {
    return 'disabled';
  }
  const port = iface.serial_port?.trim();
  if (port && !isReticulumBleRnodeSerialPort(port) && !osSerialPorts.includes(port)) {
    return 'stale_port';
  }
  if (!isReticulumInterfaceOnlineStatus(iface.status)) {
    return 'enabled_down';
  }
  return 'online';
}

export function collectReticulumLocalInterfaceAlerts(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): ReticulumLocalInterfaceAlert[] {
  const alerts: ReticulumLocalInterfaceAlert[] = [];
  for (const iface of interfaces) {
    if (isBleEnabledDownInGrace(iface, osSerialPorts, options)) {
      continue;
    }
    const health = classifyReticulumLocalInterface(iface, osSerialPorts);
    if (health === 'stale_port') {
      alerts.push({ iface, reason: 'stale_port' });
    } else if (health === 'enabled_down') {
      alerts.push({ iface, reason: 'enabled_down' });
    }
  }
  return alerts;
}

/** Enabled BLE RNodes still linking after stack start (within grace window). */
export function collectReticulumLocalInterfaceConnecting(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): ReticulumLocalInterfaceInput[] {
  if (!isWithinBleConnectGrace(options)) {
    return [];
  }
  return interfaces.filter((iface) => isBleEnabledDownInGrace(iface, osSerialPorts, options));
}

export function reticulumLocalInterfaceTextClass(
  iface: ReticulumLocalInterfaceInput,
  osSerialPorts: readonly string[],
): string {
  const health = classifyReticulumLocalInterface(iface, osSerialPorts);
  if (health === 'online') {
    return 'text-green-400';
  }
  if (health === 'stale_port' || health === 'enabled_down') {
    return 'text-red-400';
  }
  return 'text-gray-200';
}
