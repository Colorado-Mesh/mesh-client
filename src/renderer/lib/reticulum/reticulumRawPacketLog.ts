import type { ReticulumRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import type { ReticulumWirePacketRow } from '@/shared/reticulum-types';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Sidecar wire row → sniffer entry (shared by runtime hydrate + WS events). */
export function reticulumWireRowToEntry(row: ReticulumWirePacketRow): ReticulumRawPacketEntry {
  const direction = row.direction === 'tx' ? 'tx' : 'rx';
  return {
    ts: row.ts,
    direction,
    interfaceId: row.interface_id,
    interfaceName: row.interface_name,
    raw: hexToBytes(row.raw_hex),
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
