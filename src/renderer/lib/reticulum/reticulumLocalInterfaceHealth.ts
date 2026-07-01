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

export function isReticulumLocalSerialInterface(type: string): boolean {
  return RETICULUM_LOCAL_SERIAL_INTERFACE_TYPES.has(type.toLowerCase());
}

export function isReticulumInterfaceOnlineStatus(status: string): boolean {
  return ONLINE_STATUSES.has(status.trim().toLowerCase());
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
  if (port && !osSerialPorts.includes(port)) {
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
): ReticulumLocalInterfaceAlert[] {
  const alerts: ReticulumLocalInterfaceAlert[] = [];
  for (const iface of interfaces) {
    const health = classifyReticulumLocalInterface(iface, osSerialPorts);
    if (health === 'stale_port') {
      alerts.push({ iface, reason: 'stale_port' });
    } else if (health === 'enabled_down') {
      alerts.push({ iface, reason: 'enabled_down' });
    }
  }
  return alerts;
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
