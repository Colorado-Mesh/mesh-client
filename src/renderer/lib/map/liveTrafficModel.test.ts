import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import type { RxPacketEntry } from '../meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '../rawPacketLogConstants';
import type { MeshNode } from '../types';
import { groupLiveTrafficEvents } from './liveTrafficGroups';
import {
  buildLiveTrafficEvents,
  buildLiveTrafficNodeIndex,
  buildMeshtasticLiveTrafficEvents,
  filterLiveTrafficEvents,
  LIVE_TRAFFIC_MAX_AGE_MS,
  LIVE_TRAFFIC_MAX_PACKETS,
  pointInLiveTrafficBounds,
} from './liveTrafficModel';

const NOW = 1_000_000;

function node(nodeId: number, overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Node ${nodeId}`,
    short_name: `${nodeId}`,
    hw_model: 'Repeater',
    snr: 5,
    battery: 100,
    last_heard: NOW / 1000,
    latitude: 39 + nodeId / 10,
    longitude: -105,
    public_key_hex: nodeId.toString(16).padStart(2, '0').repeat(32),
    ...overrides,
  };
}

function indexFor(...nodes: MeshNode[]) {
  return buildLiveTrafficNodeIndex(new Map(nodes.map((item) => [item.node_id, item])));
}

function capture(overrides: Partial<RxPacketEntry> = {}): RxPacketEntry {
  return {
    ts: NOW,
    snr: 7,
    rssi: -95,
    source: 'rf',
    raw: new Uint8Array([0x15, 2, 2, 3, 0]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'GRP_TXT',
    hopCount: 2,
    pathBytes: [2, 3],
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

function advert(overrides: Partial<RxPacketEntry> = {}): RxPacketEntry {
  return capture({
    raw: new Uint8Array([0x11, 2, 2, 3, ...new Uint8Array(32).fill(1)]),
    payloadTypeString: 'ADVERT',
    fromNodeId: 1,
    ...overrides,
  });
}

function meshtasticCapture(
  overrides: Partial<MeshtasticRawPacketEntry> = {},
): MeshtasticRawPacketEntry {
  return {
    ts: NOW,
    snr: 7,
    rssi: -95,
    raw: new Uint8Array([1, 2, 3]),
    fromNodeId: 1,
    portLabel: 'TEXT_MESSAGE_APP',
    viaMqtt: false,
    ...overrides,
  };
}

function wireMeshPacket(
  fields: Parameters<typeof create<typeof Mesh.MeshPacketSchema>>[1],
): Uint8Array {
  return toBinary(Mesh.MeshPacketSchema, create(Mesh.MeshPacketSchema, fields) as never);
}

describe('local MeshCore discovery controls', () => {
  it.each([
    [[0x80], 'DISCOVER_REQ'],
    [[0x92, 0x1b, 1, 2, 3, 4], 'DISCOVER_RESP'],
    [[0x70], undefined],
    [[], undefined],
  ])('keeps the control category and reports only the discovery purpose', (payload, subtype) => {
    const [event] = buildLiveTrafficEvents(
      [
        capture({
          raw: new Uint8Array([0x2e, 0, ...payload]),
          payloadTypeString: 'CONTROL',
          routeTypeString: 'DIRECT',
          hopCount: 0,
          pathBytes: [],
          fromNodeId: 2,
        }),
      ],
      indexFor(node(2), node(4)),
      4,
      NOW,
    );
    expect(event.kind).toBe('CONTROL');
    expect(event.controlSubtype).toBe(subtype);
    expect(event.senderLabel).toBeUndefined();
  });

  it('does not trust a CONTROL capture label when wire bytes are another category', () => {
    const [event] = buildLiveTrafficEvents(
      [capture({ raw: new Uint8Array([0x15, 0, 0x80]), payloadTypeString: 'CONTROL' })],
      indexFor(node(4)),
      4,
      NOW,
    );
    expect(event.controlSubtype).toBeUndefined();
    const [unparsed] = buildLiveTrafficEvents(
      [
        capture({
          raw: new Uint8Array([0x2e, 0, 0x80]),
          payloadTypeString: 'CONTROL',
          parseOk: false,
        }),
      ],
      indexFor(node(4)),
      4,
      NOW,
    );
    expect(unparsed.controlSubtype).toBeUndefined();
  });
});

describe('live traffic node index', () => {
  it('uses configured self position without changing contacts and lets static override old GPS', () => {
    const contact = node(4);
    const nodes = new Map([[4, contact]]);
    const configured = buildLiveTrafficNodeIndex(nodes, undefined, {
      nodeId: 4,
      position: { lat: 40, lon: -104, source: 'static' },
    });
    expect(configured.points.get(4)).toMatchObject({ lat: 40, lon: -104 });
    expect(contact.latitude).toBe(39.4);
    const fallback = buildLiveTrafficNodeIndex(new Map(), undefined, {
      nodeId: 4,
      position: { lat: 40, lon: -104, source: 'device' },
    });
    expect(fallback.points.get(4)).toMatchObject({ lat: 40, lon: -104 });
    expect(
      buildLiveTrafficNodeIndex(nodes, undefined, {
        nodeId: 4,
        position: { lat: 40, lon: -104, source: 'device' },
      }).points.get(4)?.lat,
    ).toBe(39.4);
    expect(
      buildLiveTrafficNodeIndex(new Map(), undefined, {
        nodeId: 0,
        position: { lat: 40, lon: -104, source: 'static' },
      }).points.size,
    ).toBe(0);
  });

  it('indexes all hash widths from full public keys and includes unlocated collisions', () => {
    const nodes = new Map([
      [1, node(1, { public_key_hex: 'aabbcc' + '01'.repeat(29) })],
      [2, node(2, { latitude: null, public_key_hex: 'aabbee' + '02'.repeat(29) })],
    ]);
    const index = buildLiveTrafficNodeIndex(nodes);
    expect(index.nodesByPrefix.get('aa')).toBeNull();
    expect(index.nodesByPrefix.get('aabb')).toBeNull();
    expect(index.nodesByPrefix.get('aabbcc')).toBe(1);
    expect(index.points.has(2)).toBe(false);
  });

  it('uses live full public keys when display nodes omit them, without node-id hash guessing', () => {
    const nodes = new Map([[1, node(1, { public_key_hex: undefined })]]);
    expect(buildLiveTrafficNodeIndex(nodes).nodesByPrefix.size).toBe(0);
    const index = buildLiveTrafficNodeIndex(nodes, new Map([[1, new Uint8Array(32).fill(0xab)]]));
    expect(index.nodesByPrefix.get('abab')).toBe(1);
    expect(index.nodesByPrefix.get('01')).toBeUndefined();
  });

  it('rejects invalid and placeholder coordinates while keeping their public keys indexed', () => {
    const index = indexFor(
      node(1, { latitude: NaN }),
      node(2, { longitude: 181 }),
      node(3, { latitude: 0, longitude: 0 }),
      node(4, { latitude: 0, longitude: 10 }),
    );
    expect([...index.points.keys()]).toEqual([4]);
    expect(index.nodesByPrefix.get('03')).toBe(3);
  });
});

describe('MeshCore live traffic', () => {
  it('groups identical full payloads across observed paths without merging their provenance', () => {
    const events = buildLiveTrafficEvents(
      [
        capture({ ts: NOW - 100 }),
        capture({ raw: new Uint8Array([0x15, 2, 2, 5, 0]), pathBytes: [2, 5] }),
      ],
      indexFor(node(2), node(3), node(4), node(5)),
      4,
      NOW,
    );
    expect(events[0].packetIdentity).toBe(events[1].packetIdentity);
    const [group] = groupLiveTrafficEvents(events, NOW);
    expect(group).toMatchObject({
      reportCount: 2,
      observerCount: 1,
      observerId: 'radio:4',
      contentStatus: 'unavailable',
    });
    expect(group.segments).toHaveLength(4);
    expect(group.observedPaths).toHaveLength(2);
    const mqtt = buildLiveTrafficEvents(
      [capture({ source: 'mqtt' })],
      indexFor(node(2), node(3)),
      4,
      NOW,
    )[0];
    expect(mqtt.observerId).toBeUndefined();
    expect(groupLiveTrafficEvents([...events, mqtt], NOW)).toHaveLength(2);
  });

  it('keeps payload, route type, and transport context distinct instead of using a short fingerprint alone', () => {
    const captures = [
      capture(),
      capture({ raw: new Uint8Array([0x15, 2, 2, 3, 1]) }),
      capture({ raw: new Uint8Array([0x16, 2, 2, 3, 0]), routeTypeString: 'DIRECT' }),
      capture({
        raw: new Uint8Array([0x14, 1, 0, 0, 0, 2, 2, 3, 0]),
        routeTypeString: 'TRANSPORT_FLOOD',
        transportScopeCode: 1,
      }),
      capture({
        raw: new Uint8Array([0x14, 2, 0, 0, 0, 2, 2, 3, 0]),
        routeTypeString: 'TRANSPORT_FLOOD',
        transportScopeCode: 2,
      }),
    ];
    const events = buildLiveTrafficEvents(captures, indexFor(node(2), node(3)), null, NOW);
    expect(new Set(events.map((event) => event.packetIdentity)).size).toBe(captures.length);
    expect(groupLiveTrafficEvents(events, NOW)).toHaveLength(captures.length);
  });

  it('draws consecutive flood relay observations and the known local receiver', () => {
    const [event] = buildLiveTrafficEvents(
      [advert()],
      indexFor(node(1), node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(event).toMatchObject({ source: 'RF', routeStatus: 'resolved', rssi: -95, snr: 7 });
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([0, 1, 2]);
  });

  it('keeps original hop indices across an unresolved relay and on the final receiver edge', () => {
    const [event] = buildLiveTrafficEvents(
      [
        advert({
          raw: new Uint8Array([0x11, 4, 2, 9, 2, 3, ...new Uint8Array(32).fill(1)]),
          pathBytes: [2, 9, 2, 3],
          hopCount: 4,
        }),
      ],
      indexFor(node(1), node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(
      event.segments.map(({ from, to, hopIndex }) => [from.nodeId, to.nodeId, hopIndex]),
    ).toEqual([
      [1, 2, 0],
      [2, 3, 3],
      [3, 4, 4],
    ]);
  });

  it.each([1, 2, 3] as const)('resolves %i-byte on-air hashes with the index', (width) => {
    const pathBytes = [...new Array<number>(width).fill(2), ...new Array<number>(width).fill(3)];
    const [event] = buildLiveTrafficEvents(
      [capture({ pathBytes, pathHashSizeBytes: width })],
      indexFor(node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([
      [2, 3],
      [3, 4],
    ]);
    expect(event.routeStatus).toBe('partial');
  });

  it('breaks lines at an ambiguous hash instead of choosing the freshest contact', () => {
    const [event] = buildLiveTrafficEvents(
      [advert()],
      indexFor(
        node(1),
        node(2),
        node(3),
        node(4),
        node(5, { public_key_hex: '02' + '05'.repeat(31) }),
      ),
      4,
      NOW,
    );
    expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([[3, 4]]);
    expect(event.routeStatus).toBe('partial');
  });

  it.each(['unknown', 'unlocated'] as const)('does not bridge an %s middle relay', (state) => {
    const nodes = [node(1), node(3), node(4)];
    if (state === 'unlocated') nodes.push(node(2, { latitude: null }));
    const [event] = buildLiveTrafficEvents([advert()], indexFor(...nodes), 4, NOW);
    expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([[3, 4]]);
    expect(event.points.map((point) => point.nodeId)).toEqual([1, 3, 4]);
  });

  it.each(['DIRECT', 'TRANSPORT_DIRECT'])(
    'does not animate remaining %s path instructions',
    (routeTypeString) => {
      const [event] = buildLiveTrafficEvents(
        [capture({ routeTypeString, fromNodeId: 1 })],
        indexFor(node(1), node(2), node(3), node(4)),
        4,
        NOW,
      );
      expect(event.segments).toEqual([]);
      expect(event.points.map((point) => point.nodeId)).toEqual([4]);
      expect(event.routeStatus).toBe('direct');
    },
  );

  it.each(['mqtt', undefined] as const)(
    'never invents a local receiver for source %s',
    (source) => {
      const [event] = buildLiveTrafficEvents(
        [capture({ source })],
        indexFor(node(2), node(3), node(4)),
        4,
        NOW,
      );
      expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([[2, 3]]);
      expect(event.points.some((point) => point.nodeId === 4)).toBe(false);
      expect(event.source).toBe(source === 'mqtt' ? 'MQTT' : 'unknown');
    },
  );

  it('uses an advertisement coordinate without requiring a cached contact', () => {
    const [event] = buildLiveTrafficEvents(
      [advert({ advertName: 'New repeater', advertLat: 40, advertLon: -106 })],
      indexFor(node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(event.segments[0].from).toEqual({
      nodeId: null,
      label: 'New repeater',
      lat: 40,
      lon: -106,
    });
  });

  it('preserves advertisement origin names without GPS or a cached contact', () => {
    const unlocated = indexFor(
      node(1, { latitude: null, longitude: null }),
      node(2),
      node(3),
      node(4),
    );
    const [cached] = buildLiveTrafficEvents([advert()], unlocated, 4, NOW);
    expect(cached.senderLabel).toBe('Node 1');
    expect(cached.points.map((point) => point.nodeId)).toEqual([2, 3, 4]);
    expect(cached.segments.map((segment) => segment.hopIndex)).toEqual([1, 2]);
    const [uncached] = buildLiveTrafficEvents(
      [advert({ advertName: 'Companion without GPS' })],
      indexFor(node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(uncached.senderLabel).toBe('Companion without GPS');
    expect(uncached.points.map((point) => point.nodeId)).toEqual([2, 3, 4]);
  });

  it('labels anonymous requests from their full source key independently of coordinates', () => {
    const entry = capture({
      raw: new Uint8Array([0x1d, 2, 2, 3, 0xff, ...new Uint8Array(32).fill(1)]),
      payloadTypeString: 'ANON_REQ',
    });
    const [known] = buildLiveTrafficEvents(
      [entry],
      indexFor(node(1, { latitude: null }), node(2), node(3)),
      null,
      NOW,
    );
    expect(known.senderLabel).toBe('Node 1');
    expect(known.points.map((point) => point.nodeId)).toEqual([2, 3]);
    const [uncached] = buildLiveTrafficEvents([entry], indexFor(), null, NOW);
    expect(uncached.senderLabel).toBe('01010101');
  });

  it('never trusts heuristic fromNodeId as the origin of an encrypted group packet', () => {
    const [event] = buildLiveTrafficEvents(
      [capture({ fromNodeId: 1 })],
      indexFor(node(1), node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(event.points.some((point) => point.nodeId === 1)).toBe(false);
    expect(event.senderLabel).toBeUndefined();
  });

  it('retains malformed packets in the feed without drawing speculative links', () => {
    const [event] = buildLiveTrafficEvents(
      [capture({ parseOk: false })],
      indexFor(node(2), node(3), node(4)),
      4,
      NOW,
    );
    expect(event).toMatchObject({ segments: [], routeStatus: 'unparsed', hopCount: null });
    const [truncated] = buildLiveTrafficEvents(
      [advert({ pathBytes: [2] })],
      indexFor(node(1), node(2), node(4)),
      4,
      NOW,
    );
    expect(truncated.segments).toEqual([]);
  });
});

describe('Meshtastic live traffic', () => {
  it('keeps sender names for unlocated companions without inventing direct geometry', () => {
    const raw = wireMeshPacket({
      from: 1,
      id: 42,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('Hello mesh'),
        },
      },
    });
    const [event] = buildMeshtasticLiveTrafficEvents(
      [meshtasticCapture({ raw, hopsAway: 0 })],
      indexFor(node(1, { latitude: null, longitude: null }), node(2)),
      2,
      NOW,
    );
    expect(event).toMatchObject({ senderLabel: 'Node 1', messageText: 'Hello mesh', segments: [] });
    expect(event.points.map((point) => point.nodeId)).toEqual([2]);
  });

  it('retains the source identity for encrypted and non-text packets without GPS', () => {
    const [event] = buildMeshtasticLiveTrafficEvents(
      [
        meshtasticCapture({
          raw: wireMeshPacket({
            from: 1,
            id: 42,
            payloadVariant: { case: 'encrypted', value: new Uint8Array([1, 2, 3]) },
          }),
        }),
      ],
      indexFor(node(1, { latitude: null })),
      2,
      NOW,
    );
    expect(event.senderLabel).toBe('Node 1');
    expect(event.messageText).toBeUndefined();
    expect(event.points).toEqual([]);
    expect(event.segments).toEqual([]);
  });

  it('groups repeat MeshPacket payloads and exposes only decoded TEXT_MESSAGE_APP text', () => {
    const fields = {
      from: 1,
      id: 42,
      to: 0xffffffff,
      channel: 0,
      payloadVariant: {
        case: 'decoded' as const,
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('Hello mesh'),
        },
      },
    };
    const entries = [
      meshtasticCapture({
        raw: wireMeshPacket({ ...fields, rxTime: 100 }),
        hopsAway: 0,
        ts: NOW - 10,
      }),
      meshtasticCapture({ raw: wireMeshPacket({ ...fields, rxTime: 101 }), hopsAway: 0 }),
    ];
    const events = buildMeshtasticLiveTrafficEvents(entries, indexFor(node(1), node(2)), 2, NOW);
    expect(events[0]).toMatchObject({
      messageText: 'Hello mesh',
      senderLabel: 'Node 1',
      contentStatus: 'decoded',
      observerId: 'radio:2',
    });
    expect(events[1].packetIdentity).toBe(events[0].packetIdentity);
    expect(groupLiveTrafficEvents(events, NOW)).toHaveLength(1);
  });

  it('does not merge reused IDs with different channels, recipients, full Data fields, or payload bytes', () => {
    const payload = new TextEncoder().encode('Hello');
    const base = {
      from: 1,
      id: 42,
      to: 2,
      channel: 0,
      payloadVariant: {
        case: 'decoded' as const,
        value: { portnum: Portnums.PortNum.TEXT_MESSAGE_APP, payload },
      },
    };
    const variants = [
      base,
      { ...base, to: 3 },
      { ...base, channel: 1 },
      {
        ...base,
        payloadVariant: {
          case: 'decoded' as const,
          value: { ...base.payloadVariant.value, wantResponse: true },
        },
      },
      {
        ...base,
        payloadVariant: {
          case: 'decoded' as const,
          value: { ...base.payloadVariant.value, payload: new TextEncoder().encode('Different') },
        },
      },
    ];
    const events = buildMeshtasticLiveTrafficEvents(
      variants.map((fields) => meshtasticCapture({ raw: wireMeshPacket(fields) })),
      indexFor(node(1)),
      2,
      NOW,
    );
    expect(new Set(events.map((event) => event.packetIdentity)).size).toBe(variants.length);
  });

  it('does not guess identity for absent IDs or read encrypted/non-text payloads as message text', () => {
    const fields = [
      {
        from: 1,
        id: 0,
        payloadVariant: {
          case: 'decoded' as const,
          value: {
            portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
            payload: new TextEncoder().encode('No ID'),
          },
        },
      },
      {
        from: 1,
        id: 42,
        payloadVariant: { case: 'encrypted' as const, value: new Uint8Array([1, 2, 3]) },
      },
      {
        from: 1,
        id: 42,
        payloadVariant: {
          case: 'decoded' as const,
          value: { portnum: Portnums.PortNum.POSITION_APP, payload: new Uint8Array([1, 2, 3]) },
        },
      },
    ];
    const events = buildMeshtasticLiveTrafficEvents(
      fields.map((entry) => meshtasticCapture({ raw: wireMeshPacket(entry) })),
      indexFor(node(1)),
      2,
      NOW,
    );
    expect(events[0].packetIdentity).toBeUndefined();
    expect(events[1].messageText).toBeUndefined();
    expect(events[2].messageText).toBeUndefined();
    const oversized = buildMeshtasticLiveTrafficEvents(
      [meshtasticCapture({ raw: new Uint8Array(65_537) })],
      indexFor(node(1)),
      2,
      NOW,
    )[0];
    expect(oversized.packetIdentity).toBeUndefined();
  });

  it('caps plaintext and rejects a wire sender that disagrees with the capture metadata', () => {
    const raw = wireMeshPacket({
      from: 1,
      id: 42,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('a'.repeat(2_000)),
        },
      },
    });
    const events = buildMeshtasticLiveTrafficEvents(
      [meshtasticCapture({ raw }), meshtasticCapture({ raw, fromNodeId: 2 })],
      indexFor(node(1), node(2)),
      null,
      NOW,
    );
    expect(events[0].messageText).toHaveLength(1_000);
    expect(events[1].messageText).toBeUndefined();
    expect(events[1].packetIdentity).toBeUndefined();
    expect(events[1].senderLabel).toBeUndefined();
  });

  it('animates a proven zero-hop RF reception', () => {
    const [event] = buildMeshtasticLiveTrafficEvents(
      [meshtasticCapture({ hopsAway: 0 })],
      indexFor(node(1), node(2)),
      2,
      NOW,
    );
    expect(event.segments.map(({ from, to }) => [from.nodeId, to.nodeId])).toEqual([[1, 2]]);
    expect(event.routeStatus).toBe('resolved');
  });

  it.each([undefined, 1, 3])(
    'pulses known nodes without inventing a route for hop count %s',
    (hopsAway) => {
      const [event] = buildMeshtasticLiveTrafficEvents(
        [meshtasticCapture({ hopsAway })],
        indexFor(node(1), node(2)),
        2,
        NOW,
      );
      expect(event.segments).toEqual([]);
      expect(event.points.map((point) => point.nodeId)).toEqual([1, 2]);
    },
  );

  it('never draws an MQTT observation to the locally connected radio', () => {
    const [event] = buildMeshtasticLiveTrafficEvents(
      [meshtasticCapture({ viaMqtt: true, hopsAway: 0 })],
      indexFor(node(1), node(2)),
      2,
      NOW,
    );
    expect(event).toMatchObject({ source: 'MQTT', segments: [] });
    expect(event.points.map((point) => point.nodeId)).toEqual([1]);
  });

  it('ignores local telemetry records that were never heard over the mesh', () => {
    expect(
      buildMeshtasticLiveTrafficEvents(
        [meshtasticCapture({ isLocal: true })],
        indexFor(node(1)),
        1,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('traffic bounds, lifetime, and scope', () => {
  it('caps examined captures, expires old packets, and excludes future timestamps', () => {
    const packets = Array.from({ length: LIVE_TRAFFIC_MAX_PACKETS + 3 }, (_, i) =>
      capture({ ts: NOW - i }),
    );
    const events = buildLiveTrafficEvents(packets, indexFor(), null, NOW);
    expect(events).toHaveLength(LIVE_TRAFFIC_MAX_PACKETS);
    expect(events[0].ts).toBe(NOW - 3);
    const timed = buildLiveTrafficEvents(
      [
        capture({ ts: NOW - LIVE_TRAFFIC_MAX_AGE_MS - 1 }),
        capture({ ts: NOW - LIVE_TRAFFIC_MAX_AGE_MS }),
        capture({ ts: NOW + 1 }),
      ],
      indexFor(),
      null,
      NOW,
    );
    expect(timed.map((event) => event.ts)).toEqual([NOW - LIVE_TRAFFIC_MAX_AGE_MS]);
  });

  it('gives identical captures distinct stable IDs without collapsing repeat observations', () => {
    const packets = [capture(), capture()];
    const events = buildLiveTrafficEvents(packets, indexFor(), null, NOW);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    expect(
      buildLiveTrafficEvents(packets, indexFor(), null, NOW + 1).map((event) => event.id),
    ).toEqual(events.map((event) => event.id));
  });

  it('filters geography independently from packet-specific transport scope codes', () => {
    const index = indexFor(node(2), node(3), node(4));
    const events = buildLiveTrafficEvents(
      [
        capture({ transportScopeCode: 0, transportReturnCode: 255 }),
        capture({ transportScopeCode: 42 }),
        capture(),
      ],
      index,
      4,
      NOW,
    );
    const bounds = { south: 39, north: 40, west: -106, east: -104 };
    expect(filterLiveTrafficEvents(events, { bounds })).toHaveLength(3);
    expect(filterLiveTrafficEvents(events, { bounds, scope: 'scoped' })).toHaveLength(2);
    expect(
      filterLiveTrafficEvents(events, { scope: 0 }).map((event) => event.returnScopeCode),
    ).toEqual([255]);
    expect(filterLiveTrafficEvents(events, { scope: 'unscoped' })).toHaveLength(1);
    expect(
      filterLiveTrafficEvents(events, { bounds: { south: 45, north: 50, west: -125, east: -120 } }),
    ).toEqual([]);
  });

  it('supports a custom viewport across the antimeridian', () => {
    const point = { nodeId: 1, label: 'Island', lat: 10, lon: 179 };
    const bounds = { south: 0, north: 20, west: 170, east: -170 };
    expect(pointInLiveTrafficBounds(point, bounds)).toBe(true);
    expect(pointInLiveTrafficBounds({ ...point, lon: -179 }, bounds)).toBe(true);
    expect(pointInLiveTrafficBounds({ ...point, lon: 0 }, bounds)).toBe(false);
    expect(pointInLiveTrafficBounds({ ...point, lat: 30 }, bounds)).toBe(false);
  });

  it.each([
    { west: 170, east: 190 },
    { west: -190, east: -170 },
    { west: 530, east: 550 },
  ])('filters Leaflet dateline bounds $west to $east', ({ west, east }) => {
    const index = indexFor(
      node(1, { latitude: 10, longitude: 179 }),
      node(2, { latitude: 10, longitude: -179 }),
      node(3, { latitude: 10, longitude: 0 }),
    );
    const events = buildMeshtasticLiveTrafficEvents(
      [1, 2, 3].map((fromNodeId) => meshtasticCapture({ fromNodeId, viaMqtt: true })),
      index,
      null,
      NOW,
    );
    expect(
      filterLiveTrafficEvents(events, { bounds: { south: 0, north: 20, west, east } }).map(
        (event) => event.points[0].nodeId,
      ),
    ).toEqual([1, 2]);
  });

  it('keeps exact viewport boundaries after panning one world east', () => {
    const point = { nodeId: 1, label: 'Node', lat: 10, lon: -110 };
    const bounds = { south: 0, north: 20, west: 250, east: 270 };
    expect(pointInLiveTrafficBounds(point, bounds)).toBe(true);
    expect(pointInLiveTrafficBounds({ ...point, lon: -90 }, bounds)).toBe(true);
    expect(pointInLiveTrafficBounds({ ...point, lon: -110.01 }, bounds)).toBe(false);
    expect(pointInLiveTrafficBounds({ ...point, lon: -89.99 }, bounds)).toBe(false);
  });

  it.each([
    { west: -180, east: 180 },
    { west: 170, east: 530 },
    { west: -240, east: 240 },
  ])('covers all longitudes for a world-wide viewport $west to $east', ({ west, east }) => {
    const point = { nodeId: 1, label: 'Node', lat: 10, lon: 0 };
    const bounds = { south: 0, north: 20, west, east };
    for (const lon of [-180, -179, 0, 179, 180]) {
      expect(pointInLiveTrafficBounds({ ...point, lon }, bounds)).toBe(true);
    }
    expect(pointInLiveTrafficBounds({ ...point, lat: 30 }, bounds)).toBe(false);
  });
});
