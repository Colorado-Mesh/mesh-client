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
    legacyOwnsRoomPosts: () => false,
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
  });

  it('warns and uses senderId 0 for unknown pubKeyPrefix', () => {
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
    expect(result.pendingMessages[0]?.sender_id).toBe(0);
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
      legacyOwnsRoomPosts: () => false,
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
      legacyOwnsRoomPosts: () => false,
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

  it('queues legacy room posts in pendingMessages', () => {
    const roomPubKey = makePubKey(32);
    const roomId = pubkeyToNodeId(roomPubKey);
    const roomPrefixBytes = roomPubKey.slice(0, 6);
    const deps = baseDeps({
      pubKeyPrefixMap: new Map([[prefixHexFromBytes(roomPrefixBytes), roomId]]),
      legacyOwnsRoomPosts: () => true,
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
          text: 'legacy room post',
          senderTimestamp: 1_700_000_500,
        },
      },
      deps,
    );

    expect(result.pendingMessages).toHaveLength(1);
    expect(result.pendingMessages[0]?.payload).toContain('legacy room post');
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
});
