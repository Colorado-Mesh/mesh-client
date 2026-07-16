import type { ReticulumRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import { hexToBytesLenient } from '@/shared/hexBytes';
import type { ReticulumWirePacketRow } from '@/shared/reticulum-types';

/** Sidecar wire row → sniffer entry (shared by runtime hydrate + WS events). */
export function reticulumWireRowToEntry(row: ReticulumWirePacketRow): ReticulumRawPacketEntry {
  const direction = row.direction === 'tx' ? 'tx' : 'rx';
  return {
    ts: row.ts,
    direction,
    interfaceId: row.interface_id,
    interfaceName: row.interface_name,
    raw: hexToBytesLenient(row.raw_hex),
    rssi: row.rssi ?? null,
    snr: row.snr ?? null,
    q: row.q ?? null,
    packetType: row.packet_type ?? null,
    headerType: row.header_type ?? null,
    destinationHash: row.destination_hash ?? null,
    transportType: row.transport_type ?? null,
    context: row.context ?? null,
  };
}

/** Human-readable RNS enum label stripped of Debug formatting. */
export function formatReticulumWireEnumLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const base = value.includes('::') ? (value.split('::').pop() ?? value) : value;
  const inner = base.replace(/^([A-Za-z]+)\((.+)\)$/, '$2');
  return inner.replace(/([a-z])([A-Z])/g, '$1 $2');
}
