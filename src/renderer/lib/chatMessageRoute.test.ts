import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { encodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';
import { meshcoreNodeHash } from '@/shared/meshcoreNodeHash';

import en from '../locales/en/translation.json';
import { meshcoreChatMessageRoute, meshtasticChatMessageRoute } from './chatMessageRoute';
import {
  buildChatMessageRouteView,
  type ChatMessageRouteView,
  formatChatMessageRouteTooltip,
  resolveMeshcoreRouteHops,
  resolveMeshtasticRelay,
} from './chatMessageRouteView';
import { formatChatSignalReport, meshcoreMessageReceptionStats } from './chatSignalReport';
import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import {
  clearMeshcorePubKeyRegistry,
  registerMeshcorePubKey,
} from './meshcore/meshcorePubKeyRegistry';
import type { ChatMessage, MeshNode } from './types';

const secret = new Uint8Array(16).fill(42);
const channelMessage: ChatMessage = {
  sender_id: 1,
  sender_name: 'AlexT1000',
  payload: 'Ubiquity nvr stuff looks sweet',
  channel: 0,
  timestamp: 1_800_000_000_000,
  receivedVia: 'rf',
  rxHops: 3,
};

/** Flood GRP_TXT as the radio hears it: 2-byte hashes F8F9, D4D4, 3A01 (sender side first). */
function grpTxtCapture(overrides: Partial<RxPacketEntry> = {}): RxPacketEntry {
  const path = [0xf8, 0xf9, 0xd4, 0xd4, 0x3a, 0x01];
  const inner = encodeMeshcoreGroupText(
    secret,
    channelMessage.timestamp / 1000,
    `${channelMessage.sender_name}: ${channelMessage.payload}`,
  );
  return {
    source: 'rf',
    ts: channelMessage.timestamp + 100,
    snr: 9.5,
    rssi: -88,
    // 0x15 = flood GRP_TXT; 0x43 = 2-byte hashes, 3 hops.
    raw: new Uint8Array([0x15, 0x43, ...path, ...inner]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'GRP_TXT',
    hopCount: 3,
    pathBytes: path,
    pathHashSizeBytes: 2,
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

const channels = [{ index: 0, name: 'Public', secret }];

function node(nodeId: number, overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Node ${nodeId.toString(16)}`,
    short_name: '',
    hw_model: 'Repeater',
    snr: 0,
    battery: 0,
    last_heard: 1_000,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function publicKey(...prefix: number[]): Uint8Array {
  const key = new Uint8Array(32).fill(0x55);
  key.set(prefix);
  return key;
}

function keyHex(key: Uint8Array): string {
  return Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('meshcoreChatMessageRoute', () => {
  it('returns the captured flood path, sender side first, matching the signal report', () => {
    const packets = [grpTxtCapture()];
    expect(meshcoreChatMessageRoute(channelMessage, packets, channels)).toEqual({
      status: 'floodPath',
      hashes: ['F8F9', 'D4D4', '3A01'],
    });
    // Same capture and order the "Send signal report" action puts on the wire.
    const stats = meshcoreMessageReceptionStats(channelMessage, packets, channels);
    expect(formatChatSignalReport(stats ?? {}, 200, 'rf')).toBe(
      'ack: SNR 9.5 dB, RSSI -88 dBm, 3 hops via F8F9, D4D4, 3A01',
    );
  });

  it('returns an empty path for a message heard directly', () => {
    const direct = grpTxtCapture({
      raw: grpTxtCapture()
        .raw.filter((_, i) => i < 2 || i > 7)
        .map((b, i) => (i === 1 ? 0 : b)),
      pathBytes: [],
      hopCount: 0,
    });
    expect(meshcoreChatMessageRoute(channelMessage, [direct], channels)).toEqual({
      status: 'floodPath',
      hashes: [],
    });
  });

  it.each([
    ['a DM', { to: 9 }],
    ['a DM stored on channel -1', { channel: -1 }],
    ['a room post', { roomServerId: 7 }],
  ])('says routes are unavailable for %s', (_label, overrides) => {
    expect(
      meshcoreChatMessageRoute({ ...channelMessage, ...overrides }, [grpTxtCapture()], channels),
    ).toEqual({ status: 'unavailable', reason: 'directOrRoomMessage' });
  });

  it('reports a channel message without a matching capture as not captured', () => {
    expect(meshcoreChatMessageRoute(channelMessage, [], channels)).toEqual({
      status: 'unavailable',
      reason: 'notCaptured',
    });
    // MQTT copies never stand in for a local RF capture.
    expect(
      meshcoreChatMessageRoute(channelMessage, [grpTxtCapture({ source: 'mqtt' })], channels),
    ).toEqual({ status: 'unavailable', reason: 'notCaptured' });
  });
});

describe('meshtasticChatMessageRoute', () => {
  const message = { packetId: 0x1234, sender_id: 0xa1b2c3d4 };

  it('finds the RF capture by packet id and sender and returns the relay byte', () => {
    expect(
      meshtasticChatMessageRoute(message, [
        { fromNodeId: 0xa1b2c3d4, viaMqtt: false, packetId: 0x9999, relayNode: 0x11 },
        { fromNodeId: 0xdeadbeef, viaMqtt: false, packetId: 0x1234, relayNode: 0x22 },
        { fromNodeId: 0xa1b2c3d4, viaMqtt: true, packetId: 0x1234, relayNode: 0x33 },
        { fromNodeId: 0xa1b2c3d4, viaMqtt: false, packetId: 0x1234, relayNode: 0x13a },
      ]),
    ).toEqual({ status: 'lastRelay', relayByte: 0x3a });
  });

  it.each([undefined, 0])('says the relay was not reported when relay_node is %s', (relay) => {
    expect(
      meshtasticChatMessageRoute(message, [
        { fromNodeId: 0xa1b2c3d4, viaMqtt: false, packetId: 0x1234, relayNode: relay },
      ]),
    ).toEqual({ status: 'unavailable', reason: 'relayNotReported' });
  });

  it('reports missing captures and missing packet ids as not captured', () => {
    expect(meshtasticChatMessageRoute(message, [])).toEqual({
      status: 'unavailable',
      reason: 'notCaptured',
    });
    expect(
      meshtasticChatMessageRoute({ sender_id: 1 }, [
        { fromNodeId: 1, viaMqtt: false, relayNode: 0x22 },
      ]),
    ).toEqual({ status: 'unavailable', reason: 'notCaptured' });
  });
});

describe('resolveMeshcoreRouteHops', () => {
  afterEach(() => {
    clearMeshcorePubKeyRegistry();
  });

  it('names a hash when exactly one repeater key matches and keeps unknown hashes', () => {
    const keys = new Map([[0x10, publicKey(0xf8, 0xf9)]]);
    const nodes = new Map([[0x10, node(0x10, { long_name: 'Pikes Peak' })]]);
    expect(
      resolveMeshcoreRouteHops(['F8F9', 'D4D4'], nodes, { getPubKey: (id) => keys.get(id) }),
    ).toEqual([
      { hash: 'F8F9', name: 'Pikes Peak', matchCount: 1 },
      { hash: 'D4D4', name: null, matchCount: 0 },
    ]);
  });

  it('matches a 1-byte hash on the first public key byte, not the node id fold', () => {
    const byKey = 0x11223344;
    const byFold = 0x000000f8;
    expect(meshcoreNodeHash(byKey)).not.toBe(0xf8);
    expect(meshcoreNodeHash(byFold)).toBe(0xf8);
    const keys = new Map([[byKey, publicKey(0xf8)]]);
    const nodes = new Map([
      [byKey, node(byKey, { long_name: 'Key match' })],
      // No public key: its id folds to F8, which is not how the firmware hashes.
      [byFold, node(byFold, { long_name: 'Fold only' })],
    ]);
    expect(resolveMeshcoreRouteHops(['F8'], nodes, { getPubKey: (id) => keys.get(id) })).toEqual([
      { hash: 'F8', name: 'Key match', matchCount: 1 },
    ]);
  });

  it('ignores contacts that do not forward floods and our own radio', () => {
    const keys = new Map([
      [0x20, publicKey(0xd4)],
      [0x21, publicKey(0xd4)],
      [0x22, publicKey(0xd4)],
    ]);
    const nodes = new Map([
      [0x20, node(0x20, { hw_model: 'Chat', long_name: 'Companion' })],
      [0x21, node(0x21, { long_name: 'My radio' })],
      [0x22, node(0x22, { hw_model: 'Room', long_name: 'Room server' })],
    ]);
    expect(
      resolveMeshcoreRouteHops(['D4'], nodes, {
        myNodeNum: 0x21,
        getPubKey: (id) => keys.get(id),
      }),
    ).toEqual([{ hash: 'D4', name: 'Room server', matchCount: 1 }]);
  });

  it('labels a matching repeater without a name by its node id', () => {
    const keys = new Map([[0x50, publicKey(0xee)]]);
    const nodes = new Map([[0x50, node(0x50, { long_name: '', short_name: '' })]]);
    expect(resolveMeshcoreRouteHops(['EE'], nodes, { getPubKey: (id) => keys.get(id) })).toEqual([
      { hash: 'EE', name: '0x50', matchCount: 1 },
    ]);
  });

  it('picks the freshest repeater on a hash collision and counts the others', () => {
    const keys = new Map([
      [0x30, publicKey(0x3a)],
      [0x31, publicKey(0x3a)],
      [0x32, publicKey(0x3a)],
    ]);
    const nodes = new Map([
      [0x30, node(0x30, { long_name: 'Old', last_heard: 100 })],
      [0x31, node(0x31, { long_name: 'Fresh', last_heard: 900 })],
      [0x32, node(0x32, { long_name: 'Middle', last_heard: 500 })],
    ]);
    expect(resolveMeshcoreRouteHops(['3A'], nodes, { getPubKey: (id) => keys.get(id) })).toEqual([
      { hash: '3A', name: 'Fresh', matchCount: 3 },
    ]);
  });

  it('reads keys from the live registry by default and from public_key_hex as a fallback', () => {
    registerMeshcorePubKey(0x40, publicKey(0xab, 0xcd));
    const nodes = new Map([
      [0x40, node(0x40, { long_name: 'Registry repeater' })],
      [
        0x41,
        node(0x41, { long_name: 'Hex repeater', public_key_hex: keyHex(publicKey(0x12, 0x34)) }),
      ],
    ]);
    expect(resolveMeshcoreRouteHops(['ABCD', '1234'], nodes)).toEqual([
      { hash: 'ABCD', name: 'Registry repeater', matchCount: 1 },
      { hash: '1234', name: 'Hex repeater', matchCount: 1 },
    ]);
  });
});

describe('resolveMeshtasticRelay', () => {
  it('names the only node whose number ends in the relay byte', () => {
    const nodes = new Map([
      [0xaabbcc3a, node(0xaabbcc3a, { long_name: 'Ridge Router', hops_away: 1 })],
      [0xaabbcc3b, node(0xaabbcc3b)],
    ]);
    expect(resolveMeshtasticRelay(0x3a, nodes)).toEqual({
      hash: '3a',
      name: 'Ridge Router',
      matchCount: 1,
    });
  });

  it('prefers a node heard directly when several share the byte', () => {
    const nodes = new Map([
      [0x1000003a, node(0x1000003a, { long_name: 'Far', hops_away: 3, last_heard: 999 })],
      [0x2000003a, node(0x2000003a, { long_name: 'Neighbor', hops_away: 0, last_heard: 10 })],
    ]);
    expect(resolveMeshtasticRelay(0x3a, nodes)).toEqual({
      hash: '3a',
      name: 'Neighbor',
      matchCount: 2,
    });
  });

  it('shows the node id when the matching node has no name yet', () => {
    const nodes = new Map([[0x7777777e, node(0x7777777e, { long_name: '', short_name: ' ' })]]);
    expect(resolveMeshtasticRelay(0x7e, nodes)).toEqual({
      hash: '7e',
      name: '!7777777e',
      matchCount: 1,
    });
  });

  it('never names our own radio or the sender', () => {
    const nodes = new Map([
      [0x1000000a, node(0x1000000a, { long_name: 'Me' })],
      [0x2000000a, node(0x2000000a, { long_name: 'Sender' })],
    ]);
    expect(
      resolveMeshtasticRelay(0x0a, nodes, { myNodeNum: 0x1000000a, senderId: 0x2000000a }),
    ).toEqual({ hash: '0a', name: null, matchCount: 0 });
  });
});

describe('formatChatMessageRouteTooltip', () => {
  const i18n = i18next.createInstance();
  beforeAll(async () => {
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  });
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

  const route: ChatMessageRouteView = {
    kind: 'floodPath',
    hops: [
      { hash: 'F8F9', name: 'Pikes Peak', matchCount: 1 },
      { hash: 'D4D4', name: null, matchCount: 0 },
      { hash: '3A', name: 'Denver North', matchCount: 2 },
    ],
  };

  it('lists the MeshCore route from the sender to you', () => {
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 3,
        senderName: 'AlexT1000',
        routeDetail: 'floodPath',
        view: route,
      }),
    ).toBe(
      [
        'Reached you in 3 hops',
        'From AlexT1000',
        '1. Pikes Peak (F8F9)',
        '2. D4D4, unknown repeater',
        '3. Denver North or another repeater (3A)',
        'To you',
      ].join('\n'),
    );
  });

  it('describes a direct reception without a lookup', () => {
    expect(
      formatChatMessageRouteTooltip(t, { hops: 0, senderName: ' ', routeDetail: 'floodPath' }),
    ).toBe('Received directly from Unknown, no relays');
  });

  it('counts hops from the captured path when the stored count disagrees', () => {
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 2,
        senderName: 'Nearby',
        routeDetail: 'floodPath',
        view: { kind: 'floodPath', hops: [] },
      }),
    ).toBe('Received directly from Nearby, no relays');
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 0,
        senderName: 'AlexT1000',
        routeDetail: 'floodPath',
        view: route,
      }).split('\n')[0],
    ).toBe('Reached you in 3 hops');
  });

  it('shows the Meshtastic last relay and says it is the only relay reported', () => {
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 2,
        senderName: 'Base',
        routeDetail: 'lastRelay',
        view: { kind: 'lastRelay', relay: { hash: '3a', name: 'Ridge', matchCount: 3 } },
      }),
    ).toBe(
      [
        'Reached you in 2 hops',
        'Last relay: Ridge or another node (ID ends in 3a)',
        'The radio reports only the last relay, not the full route.',
      ].join('\n'),
    );
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 1,
        senderName: 'Base',
        routeDetail: 'lastRelay',
        view: { kind: 'lastRelay', relay: { hash: '0a', name: null, matchCount: 0 } },
      }).split('\n')[1],
    ).toBe('Last relay: a node whose ID ends in 0a, not in your node list');
  });

  it.each([
    ['directOrRoomMessage', 'Routes are shown for channel messages only.'],
    [
      'notCaptured',
      'Route not available: routes are kept only for recent messages from this session.',
    ],
    ['relayNotReported', 'The radio did not report which node relayed this message.'],
  ] as const)('explains an unavailable route (%s)', (reason, line) => {
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 4,
        senderName: 'Base',
        routeDetail: 'floodPath',
        view: { kind: 'unavailable', reason },
      }),
    ).toBe(`Reached you in 4 hops\n${line}`);
  });

  it('falls back to "not available" when the lookup gave nothing', () => {
    expect(
      formatChatMessageRouteTooltip(t, { hops: 1, senderName: 'Base', routeDetail: 'lastRelay' }),
    ).toBe(
      'Reached you in 1 hop\nRoute not available: routes are kept only for recent messages from this session.',
    );
  });

  it('says the protocol records no relays and keeps the RF correction note', () => {
    expect(
      formatChatMessageRouteTooltip(t, {
        hops: 2,
        senderName: 'Peer',
        routeDetail: 'none',
        refined: true,
      }),
    ).toBe(
      [
        'Reached you in 2 hops',
        'Packets on this network record how many relays they passed, not which ones.',
        'Updated from RF path',
      ].join('\n'),
    );
  });
});

describe('buildChatMessageRouteView', () => {
  it('resolves each lookup kind', () => {
    const nodes = new Map([[0x5000003a, node(0x5000003a, { long_name: 'Relay' })]]);
    expect(buildChatMessageRouteView({ status: 'lastRelay', relayByte: 0x3a }, nodes)).toEqual({
      kind: 'lastRelay',
      relay: { hash: '3a', name: 'Relay', matchCount: 1 },
    });
    expect(
      buildChatMessageRouteView({ status: 'floodPath', hashes: ['FF'] }, nodes, {
        myNodeNum: 1,
      }),
    ).toEqual({ kind: 'floodPath', hops: [{ hash: 'FF', name: null, matchCount: 0 }] });
    expect(
      buildChatMessageRouteView({ status: 'unavailable', reason: 'notCaptured' }, nodes),
    ).toEqual({ kind: 'unavailable', reason: 'notCaptured' });
  });
});
