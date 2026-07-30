import { beforeEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from './drivers/PacketRouter';
import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from './meshcoreChannelText';
import { processMeshcoreWaitingMessageItem } from './meshcoreProcessWaitingMessageItem';
import * as meshcoreRoomSyncStorage from './meshcoreRoomSyncStorage';
import { pubkeyToNodeId } from './meshcoreUtils';
import type { ChatMessage, MeshNode } from './types';

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed;
  return key;
}

function prefixHexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function baseDeps(overrides?: Partial<Parameters<typeof processMeshcoreWaitingMessageItem>[1]>) {
  const workingNodes = new Map<number, MeshNode>();
  return {
    workingNodes,
    pubKeyPrefixMap: new Map<string, number>(),
    myNodeNum: 0x42,
    meshcoreIdentityId: 'meshcore-test-id',
    storePriorForBatch: () => [] as ChatMessage[],
    logTransportLineAsDevice: vi.fn(),
    ...overrides,
  };
}

describe('processMeshcoreWaitingMessageItem', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(meshcoreRoomSyncStorage, 'setMeshcoreRoomLastPostAt').mockResolvedValue(undefined);
  });

  it('logs transport status lines for DM without adding messages', () => {
    const pubKey = makePubKey(5);
    const prefixBytes = pubKey.slice(0, 6);
    const senderId = pubkeyToNodeId(pubKey);
    const logTransportLineAsDevice = vi.fn();
    const deps = baseDeps({
      pubKeyPrefixMap: new Map([[prefixHexFromBytes(prefixBytes), senderId]]),
      logTransportLineAsDevice,
    });
    deps.workingNodes.set(senderId, {
      node_id: senderId,
      long_name: 'Peer',
      short_name: '',
      hw_model: 'Client',
      snr: 0,
      rssi: 0,
      last_heard: 0,
      battery: 0,
      latitude: null,
      longitude: null,
    });

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: prefixBytes,
          text: 'ack @peer',
          senderTimestamp: 1_700_000_000,
        },
      },
      deps,
    );

    expect(result.pendingMessages).toHaveLength(0);
    expect(logTransportLineAsDevice).toHaveBeenCalledWith('ack @peer');
  });

  it('queues DM history with isHistory when sender is known', () => {
    const pubKey = makePubKey(8);
    const prefixBytes = pubKey.slice(0, 6);
    const senderId = pubkeyToNodeId(pubKey);
    const deps = baseDeps({
      pubKeyPrefixMap: new Map([[prefixHexFromBytes(prefixBytes), senderId]]),
    });
    deps.workingNodes.set(senderId, {
      node_id: senderId,
      long_name: 'Alpha',
      short_name: '',
      hw_model: 'Client',
      snr: 0,
      rssi: 0,
      last_heard: 0,
      battery: 0,
      latitude: null,
      longitude: null,
    });

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: prefixBytes,
          text: 'hello dm',
          senderTimestamp: 1_700_000_100,
        },
      },
      deps,
    );

    expect(result.pendingMessages).toHaveLength(1);
    expect(result.pendingMessages[0]?.payload).toBe('hello dm');
    expect(result.pendingMessages[0]?.isHistory).toBe(true);
    expect(result.nodesDirty).toBe(true);
    expect(result.updatedNodeIds).toEqual([senderId]);
    expect(deps.workingNodes.get(senderId)?.last_heard).toBe(1_700_000_100);
  });

  it('warns and skips ingest for unknown pubKeyPrefix (senderId 0)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pubKey = makePubKey(99);
    const prefixBytes = pubKey.slice(0, 6);

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: prefixBytes,
          text: 'orphan dm',
          senderTimestamp: 1_700_000_200,
        },
      },
      baseDeps(),
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(result.pendingMessages).toHaveLength(0);
    expect(result.nodesDirty).toBe(false);
    expect(result.updatedNodeIds).toEqual([]);
    warnSpy.mockRestore();
  });

  it('still logs transport status lines when senderId is 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logTransportLineAsDevice = vi.fn();
    const pubKey = makePubKey(98);
    const prefixBytes = pubKey.slice(0, 6);

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: prefixBytes,
          text: 'ack @peer',
          senderTimestamp: 1_700_000_201,
        },
      },
      baseDeps({ logTransportLineAsDevice }),
    );

    expect(result.pendingMessages).toHaveLength(0);
    expect(logTransportLineAsDevice).toHaveBeenCalledWith('ack @peer');
    warnSpy.mockRestore();
  });

  it('dispatches non-legacy room posts through PacketRouter', () => {
    const dispatchSpy = vi.spyOn(packetRouter, 'dispatch').mockImplementation(() => {});
    const roomPubKey = makePubKey(30);
    const authorPubKey = makePubKey(40);
    const roomId = pubkeyToNodeId(roomPubKey);
    const authorId = pubkeyToNodeId(authorPubKey);
    const roomPrefixBytes = roomPubKey.slice(0, 6);
    const authorPrefix = String.fromCharCode(
      authorPubKey[0] & 0xff,
      authorPubKey[1] & 0xff,
      authorPubKey[2] & 0xff,
      authorPubKey[3] & 0xff,
    );
    const deps = baseDeps({
      pubKeyPrefixMap: new Map([
        [prefixHexFromBytes(roomPrefixBytes), roomId],
        [prefixHexFromBytes(authorPubKey.slice(0, 6)), authorId],
      ]),
    });
    deps.workingNodes.set(roomId, {
      node_id: roomId,
      long_name: 'BBS',
      short_name: '',
      hw_model: 'Room',
      snr: 0,
      rssi: 0,
      last_heard: 0,
      battery: 0,
      latitude: null,
      longitude: null,
    });

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: roomPrefixBytes,
          text: `${authorPrefix}room post`,
          senderTimestamp: 1_700_000_300,
          txtType: MESHCORE_TXT_TYPE_SIGNED_PLAIN,
        },
      },
      deps,
    );

    expect(result.roomDispatched).toBe(true);
    expect(result.pendingMessages).toHaveLength(0);
    expect(dispatchSpy).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('skips non-legacy room dispatch when identityId is null', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchSpy = vi.spyOn(packetRouter, 'dispatch').mockImplementation(() => {});
    const roomPubKey = makePubKey(31);
    const roomId = pubkeyToNodeId(roomPubKey);
    const roomPrefixBytes = roomPubKey.slice(0, 6);
    const deps = baseDeps({
      meshcoreIdentityId: null,
      pubKeyPrefixMap: new Map([[prefixHexFromBytes(roomPrefixBytes), roomId]]),
    });
    deps.workingNodes.set(roomId, {
      node_id: roomId,
      long_name: 'BBS',
      short_name: '',
      hw_model: 'Room',
      snr: 0,
      rssi: 0,
      last_heard: 0,
      battery: 0,
      latitude: null,
      longitude: null,
    });

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: roomPrefixBytes,
          text: 'room post',
          senderTimestamp: 1_700_000_400,
        },
      },
      deps,
    );

    expect(result.roomDispatched).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it('dispatches room posts through PacketRouter when identity is bound', () => {
    const dispatchSpy = vi.spyOn(packetRouter, 'dispatch').mockImplementation(() => {});
    const roomPubKey = makePubKey(32);
    const roomId = pubkeyToNodeId(roomPubKey);
    const roomPrefixBytes = roomPubKey.slice(0, 6);
    const deps = baseDeps({
      pubKeyPrefixMap: new Map([[prefixHexFromBytes(roomPrefixBytes), roomId]]),
    });
    deps.workingNodes.set(roomId, {
      node_id: roomId,
      long_name: 'BBS',
      short_name: '',
      hw_model: 'Room',
      snr: 0,
      rssi: 0,
      last_heard: 0,
      battery: 0,
      latitude: null,
      longitude: null,
    });

    const result = processMeshcoreWaitingMessageItem(
      {
        contactMessage: {
          pubKeyPrefix: roomPrefixBytes,
          text: 'room post via router',
          senderTimestamp: 1_700_000_500,
        },
      },
      deps,
    );

    expect(result.roomDispatched).toBe(true);
    expect(result.pendingMessages).toHaveLength(0);
    expect(dispatchSpy).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('queues channel messages with isHistory', () => {
    const deps = baseDeps();

    const result = processMeshcoreWaitingMessageItem(
      {
        channelMessage: {
          channelIdx: 0,
          text: 'channel hello',
          senderTimestamp: 1_700_000_600,
        },
      },
      deps,
    );

    expect(result.pendingMessages).toHaveLength(1);
    expect(result.pendingMessages[0]?.payload).toBe('channel hello');
    expect(result.pendingMessages[0]?.isHistory).toBe(true);
  });

  describe('pathLen → rxHops', () => {
    function dmDeps(pubKey: Uint8Array) {
      const prefixBytes = pubKey.slice(0, 6);
      const senderId = pubkeyToNodeId(pubKey);
      const deps = baseDeps({
        pubKeyPrefixMap: new Map([[prefixHexFromBytes(prefixBytes), senderId]]),
      });
      deps.workingNodes.set(senderId, {
        node_id: senderId,
        long_name: 'HopPeer',
        short_name: '',
        hw_model: 'Client',
        snr: 0,
        rssi: 0,
        last_heard: 0,
        battery: 0,
        latitude: null,
        longitude: null,
      });
      return { deps, prefixBytes };
    }

    function roomDeps(roomPubKey: Uint8Array) {
      const roomPrefixBytes = roomPubKey.slice(0, 6);
      const roomId = pubkeyToNodeId(roomPubKey);
      const deps = baseDeps({
        pubKeyPrefixMap: new Map([[prefixHexFromBytes(roomPrefixBytes), roomId]]),
      });
      deps.workingNodes.set(roomId, {
        node_id: roomId,
        long_name: 'BBS',
        short_name: '',
        hw_model: 'Room',
        snr: 0,
        rssi: 0,
        last_heard: 0,
        battery: 0,
        latitude: null,
        longitude: null,
      });
      return { deps, roomPrefixBytes, roomId };
    }

    it('sets DM rxHops from pathLen 0xFF (direct) and flood pathLen', () => {
      const { deps, prefixBytes } = dmDeps(makePubKey(50));
      const direct = processMeshcoreWaitingMessageItem(
        {
          contactMessage: {
            pubKeyPrefix: prefixBytes,
            text: 'direct dm',
            senderTimestamp: 1_700_000_700,
            pathLen: 0xff,
          },
        },
        deps,
      );
      expect(direct.pendingMessages[0]?.rxHops).toBe(0);

      const flood = processMeshcoreWaitingMessageItem(
        {
          contactMessage: {
            pubKeyPrefix: prefixBytes,
            text: 'flood dm',
            senderTimestamp: 1_700_000_701,
            pathLen: 3,
          },
        },
        deps,
      );
      expect(flood.pendingMessages[0]?.rxHops).toBe(3);
    });

    it('omits DM rxHops when pathLen is missing', () => {
      const { deps, prefixBytes } = dmDeps(makePubKey(51));
      const result = processMeshcoreWaitingMessageItem(
        {
          contactMessage: {
            pubKeyPrefix: prefixBytes,
            text: 'no hops dm',
            senderTimestamp: 1_700_000_710,
          },
        },
        deps,
      );
      expect(result.pendingMessages[0]?.rxHops).toBeUndefined();
    });

    it('sets channel rxHops from pathLen', () => {
      const deps = baseDeps();
      const result = processMeshcoreWaitingMessageItem(
        {
          channelMessage: {
            channelIdx: 0,
            text: 'channel hops',
            senderTimestamp: 1_700_000_720,
            pathLen: 2,
          },
        },
        deps,
      );
      expect(result.pendingMessages[0]?.rxHops).toBe(2);
    });

    it('omits channel rxHops when pathLen is missing', () => {
      const deps = baseDeps();
      const result = processMeshcoreWaitingMessageItem(
        {
          channelMessage: {
            channelIdx: 0,
            text: 'channel no hops',
            senderTimestamp: 1_700_000_721,
          },
        },
        deps,
      );
      expect(result.pendingMessages[0]?.rxHops).toBeUndefined();
    });

    it('forwards pathLen into PacketRouter room dispatch as hopCount (room pathLen)', () => {
      const dispatchSpy = vi.spyOn(packetRouter, 'dispatch').mockImplementation(() => {});
      const { deps, roomPrefixBytes } = roomDeps(makePubKey(52));
      const result = processMeshcoreWaitingMessageItem(
        {
          contactMessage: {
            pubKeyPrefix: roomPrefixBytes,
            text: 'room hops',
            senderTimestamp: 1_700_000_730,
            pathLen: 4,
          },
        },
        deps,
      );
      expect(result.roomDispatched).toBe(true);
      expect(result.pendingMessages).toHaveLength(0);
      const textEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find((e) => e.type === 'text_message');
      expect(textEvent?.type === 'text_message' && textEvent.payload.hopCount).toBe(4);
      dispatchSpy.mockRestore();
    });

    it('maps pathLen 0xff to direct 0-hop room dispatch hopCount', () => {
      const dispatchSpy = vi.spyOn(packetRouter, 'dispatch').mockImplementation(() => {});
      const { deps, roomPrefixBytes } = roomDeps(makePubKey(53));
      const result = processMeshcoreWaitingMessageItem(
        {
          contactMessage: {
            pubKeyPrefix: roomPrefixBytes,
            text: 'router room hops',
            senderTimestamp: 1_700_000_740,
            pathLen: 0xff,
          },
        },
        deps,
      );
      expect(result.roomDispatched).toBe(true);
      const textEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find((e) => e.type === 'text_message');
      expect(textEvent?.type === 'text_message' && textEvent.payload.hopCount).toBe(0);
      dispatchSpy.mockRestore();
    });
  });
});
