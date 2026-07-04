import { isLocalConnectHost, parseConnectHostPort, stripConnectHostBrackets } from './connectHost';

/** Reticulum serial interface types that can attach locally (USB, BLE, local TCP). */
export const RETICULUM_LOCAL_SERIAL_INTERFACE_TYPES = new Set(['rnode', 'rnode_multi', 'kiss']);

const RNODE_TCP_SCHEME = 'tcp://';
const BLE_SCHEME = 'ble://';

export interface ReticulumLocalSerialInterfaceRow {
  id: string;
  type: string;
  enabled: boolean;
  serial_port?: string | null;
}

function parseRnodeTcpHost(serialPort: string): string | null {
  const trimmed = serialPort.trim();
  if (!trimmed.toLowerCase().startsWith(RNODE_TCP_SCHEME)) {
    return null;
  }
  const rest = trimmed.slice(RNODE_TCP_SCHEME.length);
  if (!rest) {
    return null;
  }
  const parsed = parseConnectHostPort(rest, 7633);
  if (!parsed.host) {
    return null;
  }
  return stripConnectHostBrackets(parsed.host);
}

export function isReticulumLocalSerialInterfaceType(type: string): boolean {
  return RETICULUM_LOCAL_SERIAL_INTERFACE_TYPES.has(type.trim().toLowerCase());
}

/** Locally attached serial interface: USB path, BLE RNode, or tcp:// with a local connect host. */
export function isReticulumLocallyConnectedSerialInterface(
  row: ReticulumLocalSerialInterfaceRow,
): boolean {
  if (!isReticulumLocalSerialInterfaceType(row.type)) {
    return false;
  }
  const port = row.serial_port?.trim() ?? '';
  if (!port) {
    return false;
  }
  const lower = port.toLowerCase();
  if (lower.startsWith(BLE_SCHEME)) {
    return true;
  }
  if (lower.startsWith(RNODE_TCP_SCHEME)) {
    const host = parseRnodeTcpHost(port);
    return host != null && isLocalConnectHost(host);
  }
  return true;
}

export function pickDefaultPrimaryLocalSerialInterfaceId(
  interfaces: readonly ReticulumLocalSerialInterfaceRow[],
): string | null {
  for (const row of interfaces) {
    if (row.enabled && isReticulumLocallyConnectedSerialInterface(row)) {
      return row.id;
    }
  }
  return null;
}

export function resolveEffectivePrimaryLocalSerialInterfaceId(
  interfaces: readonly ReticulumLocalSerialInterfaceRow[],
  storedId: string | null | undefined,
): string | null {
  if (storedId) {
    const stored = interfaces.find((row) => row.id === storedId);
    if (stored?.enabled && isReticulumLocallyConnectedSerialInterface(stored)) {
      return storedId;
    }
  }
  return pickDefaultPrimaryLocalSerialInterfaceId(interfaces);
}

export function countEnabledLocallyConnectedSerialInterfaces(
  interfaces: readonly ReticulumLocalSerialInterfaceRow[],
): number {
  return interfaces.filter((row) => row.enabled && isReticulumLocallyConnectedSerialInterface(row))
    .length;
}
