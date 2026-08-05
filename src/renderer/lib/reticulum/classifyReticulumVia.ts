import type { MessageTransport } from '@/renderer/stores/messageStore';

const RETICULUM_VIA_ATOMS = ['ble', 'rf', 'tcp', 'network'] as const;
export type ReticulumVia = (typeof RETICULUM_VIA_ATOMS)[number];

/** Classify an RNS interface name or UI type into a Reticulum transport marker. */
export function classifyReticulumVia(nameOrType: string): ReticulumVia {
  const lower = nameOrType.toLowerCase();
  if (lower.includes('ble') || lower.startsWith('ble://') || lower.includes('bluetooth')) {
    return 'ble';
  }
  if (
    lower.includes('rnode') ||
    lower === 'rnode' ||
    lower.includes('lora') ||
    lower.includes('kiss')
  ) {
    return 'rf';
  }
  if (lower.includes('tcp') || lower === 'tcp') return 'tcp';
  return 'network';
}

/** Minimal sidecar interface row for outbound transport resolution. */
export interface ReticulumSidecarInterfaceRow {
  id?: string;
  type: string;
  name?: string;
  enabled: boolean;
  serial_port?: string | null;
}

export function classifyReticulumInterfaceRow(
  row: Pick<ReticulumSidecarInterfaceRow, 'type' | 'name' | 'serial_port'>,
): ReticulumVia {
  const port = row.serial_port?.trim().toLowerCase() ?? '';
  if (port.startsWith('ble://')) return 'ble';
  const fromType = classifyReticulumVia(row.type);
  if (fromType !== 'network') return fromType;
  return classifyReticulumVia(row.name ?? '');
}

/** Map a path-table interface name onto a local interface row when possible. */
export function classifyReticulumPathInterfaceName(
  pathInterfaceName: string,
  interfaces: readonly Pick<ReticulumSidecarInterfaceRow, 'type' | 'name' | 'id' | 'serial_port'>[],
): ReticulumVia {
  const match = interfaces.find(
    (iface) =>
      iface.name?.toLowerCase() === pathInterfaceName.toLowerCase() ||
      iface.id?.toLowerCase() === pathInterfaceName.toLowerCase(),
  );
  if (match) return classifyReticulumInterfaceRow(match);
  return classifyReticulumVia(pathInterfaceName);
}

/** Outbound LXMF transport from local enabled egress interfaces (capability fallback only). */
export function resolveReticulumOutboundViaFromInterfaces(
  interfaces: readonly Pick<
    ReticulumSidecarInterfaceRow,
    'type' | 'enabled' | 'id' | 'name' | 'serial_port'
  >[],
  primaryLocalSerialInterfaceId?: string | null,
): ReticulumVia {
  if (primaryLocalSerialInterfaceId) {
    const primary = interfaces.find(
      (iface) => iface.id === primaryLocalSerialInterfaceId && iface.enabled,
    );
    if (primary) {
      const via = classifyReticulumInterfaceRow(primary);
      if (via === 'rf' || via === 'ble') return via;
    }
  }

  let hasBle = false;
  let fallback: ReticulumVia = 'network';
  for (const iface of interfaces) {
    if (!iface.enabled) continue;
    const via = classifyReticulumInterfaceRow(iface);
    if (via === 'rf') return 'rf';
    if (via === 'ble') hasBle = true;
    if (via === 'tcp') fallback = 'tcp';
  }
  if (hasBle) return 'ble';
  return fallback;
}

/** Path-table egress first; capability classifier only when path unknown. */
export function resolveReticulumOutboundViaFromPath(
  pathInterfaceName: string | null | undefined,
  interfaces: readonly Pick<
    ReticulumSidecarInterfaceRow,
    'type' | 'enabled' | 'id' | 'name' | 'serial_port'
  >[],
  primaryLocalSerialInterfaceId?: string | null,
): ReticulumVia {
  const name = pathInterfaceName?.trim();
  if (name) {
    return classifyReticulumPathInterfaceName(name, interfaces);
  }
  return resolveReticulumOutboundViaFromInterfaces(interfaces, primaryLocalSerialInterfaceId);
}

/** Merge observed atoms into an explicit wire label (`rf`, `rf+tcp`, …). Never `both`. */
export function mergeObservedReticulumEgressVias(vias: readonly string[]): string {
  const seen = new Set<ReticulumVia>();
  for (const via of vias) {
    if ((RETICULUM_VIA_ATOMS as readonly string[]).includes(via)) {
      seen.add(via as ReticulumVia);
    }
  }
  const parts = RETICULUM_VIA_ATOMS.filter((v) => seen.has(v));
  return parts.length === 0 ? 'network' : parts.join('+');
}

export function parseReticulumViaAtoms(value: string | undefined | null): ReticulumVia[] {
  if (value == null || value === '') return [];
  const parts = value
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const atoms: ReticulumVia[] = [];
  for (const part of parts) {
    if ((RETICULUM_VIA_ATOMS as readonly string[]).includes(part)) {
      atoms.push(part as ReticulumVia);
    }
  }
  return atoms;
}

export function isReticulumVia(value: string | undefined | null): value is ReticulumVia {
  return value != null && (RETICULUM_VIA_ATOMS as readonly string[]).includes(value);
}

export function isReticulumViaLabel(value: string | undefined | null): boolean {
  if (value == null || value === '') return false;
  const atoms = parseReticulumViaAtoms(value);
  if (atoms.length === 0) return false;
  return mergeObservedReticulumEgressVias(atoms) === value;
}

export function reticulumViaToMessageTransport(via: string): MessageTransport {
  return via as MessageTransport;
}

export function messageTransportFromWire(
  receivedVia?: string | null,
  sentVia?: string | null,
  direction?: string,
): MessageTransport | undefined {
  const raw = direction === 'outbound' ? (sentVia ?? receivedVia) : (receivedVia ?? sentVia);
  if (raw == null) return undefined;
  if (isReticulumViaLabel(raw) || isReticulumVia(raw)) {
    return reticulumViaToMessageTransport(raw);
  }
  if (
    raw === 'rf' ||
    raw === 'mqtt' ||
    raw === 'both' ||
    raw === 'ble' ||
    raw === 'tcp' ||
    raw === 'network' ||
    raw === 'paper'
  ) {
    return raw;
  }
  return classifyReticulumVia(raw);
}

/** Short badge label for explicit egress atoms / joins (`RF`, `BLE`, `RF+TCP`). */
export function formatReticulumViaBadgeLabel(via: string | undefined | null): string {
  const atoms = parseReticulumViaAtoms(via);
  if (atoms.length === 0) return 'NET';
  const labels: Record<ReticulumVia, string> = {
    ble: 'BLE',
    rf: 'RF',
    tcp: 'TCP',
    network: 'NET',
  };
  return atoms.map((a) => labels[a]).join('+');
}
