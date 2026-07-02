import type { MessageTransport } from '@/renderer/stores/messageStore';

const RETICULUM_VIA_VALUES = ['rf', 'tcp', 'network'] as const;
export type ReticulumVia = (typeof RETICULUM_VIA_VALUES)[number];

/** Classify an RNS interface name or UI type into a Reticulum transport marker. */
export function classifyReticulumVia(nameOrType: string): ReticulumVia {
  const lower = nameOrType.toLowerCase();
  if (lower.includes('rnode') || lower === 'rnode') return 'rf';
  if (lower.includes('tcp') || lower === 'tcp') return 'tcp';
  return 'network';
}

/** Minimal sidecar interface row for outbound transport resolution. */
export interface ReticulumSidecarInterfaceRow {
  type: string;
  enabled: boolean;
}

/** Outbound LXMF transport from local enabled egress interfaces (matches sidecar via.rs). */
export function resolveReticulumOutboundViaFromInterfaces(
  interfaces: readonly Pick<ReticulumSidecarInterfaceRow, 'type' | 'enabled'>[],
): ReticulumVia {
  let fallback: ReticulumVia = 'network';
  for (const iface of interfaces) {
    if (!iface.enabled) continue;
    const via = classifyReticulumVia(iface.type);
    if (via === 'rf') return 'rf';
    if (via === 'tcp') fallback = 'tcp';
  }
  return fallback;
}

export function isReticulumVia(value: string | undefined | null): value is ReticulumVia {
  return value != null && (RETICULUM_VIA_VALUES as readonly string[]).includes(value);
}

export function reticulumViaToMessageTransport(via: ReticulumVia): MessageTransport {
  return via;
}

export function messageTransportFromWire(
  receivedVia?: string | null,
  sentVia?: string | null,
  direction?: string,
): MessageTransport | undefined {
  const raw = direction === 'outbound' ? (sentVia ?? receivedVia) : (receivedVia ?? sentVia);
  if (raw == null) return undefined;
  if (isReticulumVia(raw)) return raw;
  if (raw === 'rf' || raw === 'mqtt' || raw === 'both') return raw;
  return classifyReticulumVia(raw);
}
