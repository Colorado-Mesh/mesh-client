import { describe, expect, it } from 'vitest';

import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry, ReticulumRawPacketEntry } from './rawPacketLogConstants';
import {
  sortMeshcorePackets,
  sortMeshtasticPackets,
  sortReticulumPackets,
} from './rawPacketLogSort';

function meshcoreEntry(
  overrides: Partial<RxPacketEntry> & Pick<RxPacketEntry, 'ts' | 'hopCount'>,
): RxPacketEntry {
  return {
    snr: 0,
    rssi: 0,
    raw: new Uint8Array([0x01]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'ADVERT',
    pathBytes: [],
    pathHashSizeBytes: 1,
    fromNodeId: null,
    messageFingerprintHex: null,
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
    ...overrides,
  };
}

function meshtasticEntry(
  overrides: Partial<MeshtasticRawPacketEntry> & Pick<MeshtasticRawPacketEntry, 'ts'>,
): MeshtasticRawPacketEntry {
  return {
    snr: 1,
    rssi: -80,
    raw: new Uint8Array([0x01]),
    fromNodeId: 1,
    portLabel: 'TEXT_MESSAGE_APP',
    viaMqtt: false,
    ...overrides,
  };
}

function reticulumEntry(
  overrides: Partial<ReticulumRawPacketEntry> & Pick<ReticulumRawPacketEntry, 'ts'>,
): ReticulumRawPacketEntry {
  return {
    direction: 'rx',
    interfaceId: 1,
    interfaceName: 'RNode',
    raw: new Uint8Array([0x01]),
    packetType: 'DATA',
    headerType: 'SINGLE',
    ...overrides,
  };
}

describe('rawPacketLogSort', () => {
  it('sorts MeshCore packets by hop count descending', () => {
    const sorted = sortMeshcorePackets(
      [meshcoreEntry({ ts: 1, hopCount: 1 }), meshcoreEntry({ ts: 2, hopCount: 3 })],
      { column: 'hops', direction: 'desc' },
    );
    expect(sorted.map((p) => p.hopCount)).toEqual([3, 1]);
  });

  it('sorts MeshCore packets by time ascending', () => {
    const sorted = sortMeshcorePackets(
      [meshcoreEntry({ ts: 30, hopCount: 1 }), meshcoreEntry({ ts: 10, hopCount: 1 })],
      { column: 'time', direction: 'asc' },
    );
    expect(sorted.map((p) => p.ts)).toEqual([10, 30]);
  });

  it('sorts Meshtastic packets by hopsAway descending', () => {
    const sorted = sortMeshtasticPackets(
      [
        meshtasticEntry({ ts: 1, hopsAway: 1 }),
        meshtasticEntry({ ts: 2, hopsAway: 4 }),
        meshtasticEntry({ ts: 3, hopsAway: undefined }),
      ],
      { column: 'hops', direction: 'desc' },
    );
    expect(sorted.map((p) => p.hopsAway ?? -1)).toEqual([4, 1, -1]);
  });

  it('sorts Meshtastic packets by port label ascending', () => {
    const sorted = sortMeshtasticPackets(
      [
        meshtasticEntry({ ts: 1, portLabel: 'TEXT_MESSAGE_APP' }),
        meshtasticEntry({ ts: 2, portLabel: 'ADMIN_APP' }),
      ],
      { column: 'type', direction: 'asc' },
    );
    expect(sorted.map((p) => p.portLabel)).toEqual(['ADMIN_APP', 'TEXT_MESSAGE_APP']);
  });

  it('sorts Reticulum packets by time descending', () => {
    const sorted = sortReticulumPackets([reticulumEntry({ ts: 5 }), reticulumEntry({ ts: 20 })], {
      column: 'time',
      direction: 'desc',
    });
    expect(sorted.map((p) => p.ts)).toEqual([20, 5]);
  });

  it('leaves Reticulum hop sort order unchanged', () => {
    const packets = [reticulumEntry({ ts: 1 }), reticulumEntry({ ts: 2 })];
    const sorted = sortReticulumPackets(packets, { column: 'hops', direction: 'desc' });
    expect(sorted.map((p) => p.ts)).toEqual([1, 2]);
  });
});
