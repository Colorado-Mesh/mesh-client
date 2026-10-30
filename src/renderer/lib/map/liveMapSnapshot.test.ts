import { describe, expect, it } from 'vitest';

import type { RxPacketEntry } from '../meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '../rawPacketLogConstants';
import {
  applyLiveMapSnapshot,
  buildLiveMapSnapshot,
  emptyLiveMapWindowData,
  type LiveMapSnapshotInput,
} from './liveMapSnapshot';
import { LIVE_TRAFFIC_MAX_PACKETS, type LiveTrafficNode } from './liveTrafficModel';

function meshcorePacket(ts: number): RxPacketEntry {
  return {
    source: 'rf',
    ts,
    snr: 6.5,
    rssi: -91,
    raw: new Uint8Array([0x11, 0, ts & 0xff]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'ADVERT',
    hopCount: 0,
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
  };
}

function meshtasticPacket(ts: number): MeshtasticRawPacketEntry {
  return {
    ts,
    snr: 4,
    rssi: -100,
    raw: new Uint8Array([1, 2, 3]),
    fromNodeId: 0x1234,
    portLabel: 'TEXT_MESSAGE_APP',
    viaMqtt: false,
  };
}

const denver: LiveTrafficNode = {
  long_name: 'Denver Repeater',
  short_name: 'DEN',
  latitude: 39.74,
  longitude: -104.99,
  public_key_hex: 'ab'.repeat(32),
};
const unlocated: LiveTrafficNode = {
  long_name: 'Somewhere',
  short_name: 'SW',
  latitude: null,
  longitude: null,
};

function input(overrides: Partial<LiveMapSnapshotInput> = {}): LiveMapSnapshotInput {
  return {
    nodes: new Map([
      [1, denver],
      [2, unlocated],
    ]),
    myNodeNum: 1,
    ourPosition: { lat: 39.7, lon: -105, source: 'static', altitudeMeters: 1600 },
    meshcorePackets: [meshcorePacket(1), meshcorePacket(2)],
    pubKeyByNodeId: new Map([[3, new Uint8Array(32).fill(7)]]),
    ...overrides,
  };
}

describe('buildLiveMapSnapshot', () => {
  it('sends the node fields traffic geometry reads, plus keys, position and packets', () => {
    const snapshot = buildLiveMapSnapshot(input(), { nodes: true, pubKeys: true });
    expect(snapshot).toEqual({
      myNodeNum: 1,
      ourPosition: { lat: 39.7, lon: -105, source: 'static' },
      nodes: [
        [1, 'Denver Repeater', 'DEN', 39.74, -104.99, 'ab'.repeat(32)],
        [2, 'Somewhere', 'SW', null, null, null],
      ],
      pubKeys: [[3, new Uint8Array(32).fill(7)]],
      meshcorePackets: [meshcorePacket(1), meshcorePacket(2)],
    });
  });

  it('leaves out unchanged nodes and keys', () => {
    const snapshot = buildLiveMapSnapshot(input(), { nodes: false, pubKeys: false });
    expect(snapshot).not.toHaveProperty('nodes');
    expect(snapshot).not.toHaveProperty('pubKeys');
  });

  it('sends only the packet window the traffic builders read', () => {
    const packets = Array.from({ length: LIVE_TRAFFIC_MAX_PACKETS + 50 }, (_, i) =>
      meshtasticPacket(i),
    );
    const snapshot = buildLiveMapSnapshot(
      input({ meshcorePackets: undefined, meshtasticPackets: packets }),
      { nodes: false, pubKeys: false },
    );
    expect(snapshot.meshtasticPackets).toHaveLength(LIVE_TRAFFIC_MAX_PACKETS);
    expect(snapshot.meshtasticPackets?.[0].ts).toBe(50);
    expect(snapshot).not.toHaveProperty('meshcorePackets');
  });
});

describe('applyLiveMapSnapshot', () => {
  const timestamps = (packets: readonly { ts: number }[] | undefined) =>
    packets?.map((packet) => packet.ts);

  it('restores the inputs after the IPC structured clone', () => {
    const sent = structuredClone(buildLiveMapSnapshot(input(), { nodes: true, pubKeys: true }));
    const data = applyLiveMapSnapshot(emptyLiveMapWindowData('meshcore'), sent);
    expect(data.myNodeNum).toBe(1);
    expect(data.ourPosition).toEqual({ lat: 39.7, lon: -105, source: 'static' });
    expect(data.nodes.get(1)).toEqual(denver);
    expect(data.nodes.get(2)).toEqual(unlocated);
    expect(data.pubKeyByNodeId.get(3)).toEqual(new Uint8Array(32).fill(7));
    expect(timestamps(data.meshcorePackets)).toEqual([1, 2]);
  });

  it('keeps nodes and keys when a snapshot leaves them out', () => {
    const first = applyLiveMapSnapshot(
      emptyLiveMapWindowData('meshcore'),
      buildLiveMapSnapshot(input(), { nodes: true, pubKeys: true }),
    );
    const next = applyLiveMapSnapshot(
      first,
      buildLiveMapSnapshot(input({ meshcorePackets: [meshcorePacket(9)] }), {
        nodes: false,
        pubKeys: false,
      }),
    );
    expect(next.nodes).toBe(first.nodes);
    expect(next.pubKeyByNodeId).toBe(first.pubKeyByNodeId);
    expect(timestamps(next.meshcorePackets)).toEqual([9]);
  });

  it('holds only the packet log of the window protocol', () => {
    const snapshot = {
      myNodeNum: 5,
      ourPosition: null,
      meshcorePackets: [meshcorePacket(1)],
      meshtasticPackets: [meshtasticPacket(2)],
    };
    const meshtastic = applyLiveMapSnapshot(emptyLiveMapWindowData('meshtastic'), snapshot);
    expect(timestamps(meshtastic.meshtasticPackets)).toEqual([2]);
    expect(meshtastic).not.toHaveProperty('meshcorePackets');
    const meshcore = applyLiveMapSnapshot(emptyLiveMapWindowData('meshcore'), snapshot);
    expect(timestamps(meshcore.meshcorePackets)).toEqual([1]);
    expect(meshcore).not.toHaveProperty('meshtasticPackets');
  });

  it('skips packets without bytes or a timestamp, and malformed node rows', () => {
    const data = applyLiveMapSnapshot(emptyLiveMapWindowData('meshcore'), {
      myNodeNum: 1,
      ourPosition: { lat: 1, lon: 2, source: 'satellite' },
      nodes: [[1, 'Ok', 'OK', 1, 2, null], ['x'], 'row', [Number.NaN, 'Bad']],
      pubKeys: [
        [1, 'not bytes'],
        [2, new Uint8Array(32)],
      ],
      meshcorePackets: [meshcorePacket(1), { ts: 2 }, { ...meshcorePacket(3), ts: 'late' }],
    });
    expect([...data.nodes.keys()]).toEqual([1]);
    expect([...data.pubKeyByNodeId.keys()]).toEqual([2]);
    expect(timestamps(data.meshcorePackets)).toEqual([1]);
    expect(data.ourPosition).toBeNull();
  });

  it.each([null, 'snapshot', { myNodeNum: 'one' }])('ignores %s', (value) => {
    const empty = emptyLiveMapWindowData('meshcore');
    expect(applyLiveMapSnapshot(empty, value)).toBe(empty);
  });
});
