import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry, ReticulumRawPacketEntry } from './rawPacketLogConstants';

export type RawPacketSortColumn = 'time' | 'type' | 'hops' | 'snr';
export type RawPacketSortDirection = 'asc' | 'desc';

export interface RawPacketSortState {
  column: RawPacketSortColumn;
  direction: RawPacketSortDirection;
}

export const DEFAULT_RAW_PACKET_SORT: RawPacketSortState = {
  column: 'time',
  direction: 'asc',
};

function compareDirection(a: number, b: number, direction: RawPacketSortDirection): number {
  return direction === 'asc' ? a - b : b - a;
}

function compareString(a: string, b: string, direction: RawPacketSortDirection): number {
  const cmp = a.localeCompare(b);
  return direction === 'asc' ? cmp : -cmp;
}

export function sortMeshcorePackets(
  packets: readonly RxPacketEntry[],
  sort: RawPacketSortState,
): RxPacketEntry[] {
  const out = [...packets];
  out.sort((a, b) => {
    switch (sort.column) {
      case 'type':
        return compareString(a.payloadTypeString ?? '', b.payloadTypeString ?? '', sort.direction);
      case 'hops':
        return compareDirection(a.hopCount, b.hopCount, sort.direction);
      case 'snr':
        return compareDirection(a.snr, b.snr, sort.direction);
      case 'time':
      default:
        return compareDirection(a.ts, b.ts, sort.direction);
    }
  });
  return out;
}

export function sortMeshtasticPackets(
  packets: readonly MeshtasticRawPacketEntry[],
  sort: RawPacketSortState,
): MeshtasticRawPacketEntry[] {
  const out = [...packets];
  out.sort((a, b) => {
    switch (sort.column) {
      case 'type':
        return compareString(a.portLabel, b.portLabel, sort.direction);
      case 'hops': {
        const ah = a.hopsAway ?? -1;
        const bh = b.hopsAway ?? -1;
        return compareDirection(ah, bh, sort.direction);
      }
      case 'snr':
        return compareDirection(a.snr, b.snr, sort.direction);
      case 'time':
      default:
        return compareDirection(a.ts, b.ts, sort.direction);
    }
  });
  return out;
}

export function sortReticulumPackets(
  packets: readonly ReticulumRawPacketEntry[],
  sort: RawPacketSortState,
): ReticulumRawPacketEntry[] {
  const out = [...packets];
  out.sort((a, b) => {
    switch (sort.column) {
      case 'type':
        return compareString(a.packetType ?? '', b.packetType ?? '', sort.direction);
      case 'hops':
        return 0;
      case 'snr':
        return compareDirection(a.snr ?? 0, b.snr ?? 0, sort.direction);
      case 'time':
      default:
        return compareDirection(a.ts, b.ts, sort.direction);
    }
  });
  return out;
}
