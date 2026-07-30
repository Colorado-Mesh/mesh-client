import type { Connection } from '@liamcottle/meshcore.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcorePubKeyRegistry,
  registerMeshcorePubKey,
} from '../meshcore/meshcorePubKeyRegistry';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { meshcoreProtocol } from './MeshCoreProtocol';
import type { DomainEvent } from './Protocol';

const EVENT_ADVERT = 128;
const EVENT_CHANNEL_MESSAGE = 8;
const EVENT_DIRECT_MESSAGE = 7;
const EVENT_PATH_UPDATED = 129;
const EVENT_DM_ACK = 130;
const EVENT_WAITING_MESSAGES = 131;
const EVENT_RF_RX = 136;
const EVENT_DISCONNECTED = 'disconnected';

function mockMeshCoreConnection() {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const bus = {
    on(event: string | number, cb: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
    },
    off(event: string | number, cb: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(cb);
    },
    emit(event: string | number, data: unknown) {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
    getSelfInfo: vi.fn().mockResolvedValue({ publicKey: new Uint8Array(32).fill(1) }),
  };
  return bus;
}

describe('MeshCoreProtocol.subscribe', () => {
  beforeEach(() => {
    clearMeshcorePubKeyRegistry();
    vi.spyOn(meshcoreProtocol, 'createDevice').mockResolvedValue(
      mockMeshCoreConnection() as unknown as Connection,
    );
  });

  it('emits node_info and position on advert', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    conn.emit(EVENT_ADVERT, {
      publicKey,
      advName: 'Test',
      lastAdvert: 1_700_000_000,
      advLat: 40_000_000,
      advLon: -105_000_000,
    });
    expect(events.some((e) => e.type === 'node_info')).toBe(true);
    expect(events.some((e) => e.type === 'position')).toBe(true);
    teardown();
  });

  it('emits meshcore_path_updated on path-updated (129)', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 3) % 256);
    conn.emit(EVENT_PATH_UPDATED, { publicKey });
    const pathEv = events.find((e) => e.type === 'meshcore_path_updated');
    expect(pathEv).toMatchObject({
      type: 'meshcore_path_updated',
      payload: expect.objectContaining({ publicKey }),
    });
    expect(pathEv?.type === 'meshcore_path_updated' && pathEv.payload.nodeId).not.toBe(0);
    teardown();
  });

  it('emits text_message on channel message', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 0,
      text: 'hello mesh',
      senderTimestamp: 1_700_000,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text).toMatchObject({
      type: 'text_message',
      payload: expect.objectContaining({ payload: 'hello mesh', channelIndex: 0 }),
    });
    teardown();
  });

  it('assigns distinct ids to different senders sharing a channel/second', () => {
    // Companion channel events carry no sender id, only the raw wire text — two different
    // senders posting in the same channel within the same second must not collide on id.
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 0,
      text: 'Alice: hello mesh',
      senderTimestamp: 1_700_000,
    });
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 0,
      text: 'Bob: hello mesh',
      senderTimestamp: 1_700_000,
    });
    const ids = events
      .filter((e) => e.type === 'text_message')
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
      .map((e) => (e.type === 'text_message' ? e.payload.id : undefined));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    teardown();
  });

  it('maps channel pathLen to hopCount (0xFF = direct)', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 0,
      text: 'hello mesh',
      senderTimestamp: 1_700_000,
      pathLen: 0xff,
    });
    const direct = events.find((e) => e.type === 'text_message');
    expect(direct?.type === 'text_message' && direct.payload.hopCount).toBe(0);
    events.length = 0;
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 0,
      text: 'multi hop',
      senderTimestamp: 1_700_001,
      pathLen: 3,
    });
    const flood = events.find((e) => e.type === 'text_message');
    expect(flood?.type === 'text_message' && flood.payload.hopCount).toBe(3);
    teardown();
  });

  it('maps DM pathLen to hopCount', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const nodeId = pubkeyToNodeId(publicKey);
    registerMeshcorePubKey(nodeId, publicKey);
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_DIRECT_MESSAGE, {
      pubKeyPrefix: publicKey.slice(0, 6),
      text: 'weather report',
      senderTimestamp: 1_700_000_300,
      txtType: 0,
      pathLen: 2,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text?.type === 'text_message' && text.payload.hopCount).toBe(2);
    teardown();
  });

  it('routes transport status channel lines to device_log instead of chat', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_CHANNEL_MESSAGE, {
      channelIdx: 6,
      text: '[2552] @[Nix Mobile 3] | 1 hops, 1-byte hashes, SNR -1.75 | recv 16:44:41',
      senderTimestamp: 1_700_000,
    });
    expect(events.some((e) => e.type === 'text_message')).toBe(false);
    const log = events.find((e) => e.type === 'device_log');
    expect(log).toMatchObject({
      type: 'device_log',
      payload: expect.objectContaining({
        source: 'meshcore',
        message: expect.stringContaining('SNR -1.75'),
      }),
    });
    teardown();
  });

  it('resolves DM sender from global pubkey registry without a live advert in this subscription', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const nodeId = pubkeyToNodeId(publicKey);
    registerMeshcorePubKey(nodeId, publicKey);
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_DIRECT_MESSAGE, {
      pubKeyPrefix: publicKey.slice(0, 6),
      text: 'weather report',
      senderTimestamp: 1_700_000_300,
      txtType: 0,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text).toMatchObject({
      type: 'text_message',
      payload: expect.objectContaining({
        from: nodeId,
        channelIndex: -1,
        payload: 'weather report',
      }),
    });
    teardown();
  });

  it('emits room-shaped text_message for SignedPlain direct messages', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    conn.emit(EVENT_ADVERT, {
      publicKey,
      advName: 'RoomServer',
      lastAdvert: 1_700_000_000,
    });
    conn.emit(EVENT_DIRECT_MESSAGE, {
      pubKeyPrefix: publicKey.slice(0, 6),
      text: '\0\0\0\0Welcome',
      senderTimestamp: 1_700_000_100,
      txtType: 2,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text).toMatchObject({
      type: 'text_message',
      payload: expect.objectContaining({
        channelIndex: -2,
        txtType: 2,
        roomServerId: expect.any(Number),
        id: expect.stringMatching(/^room:/),
      }),
    });
    teardown();
  });

  it('emits room-shaped text_message for PLAIN direct messages from known room contacts', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const EVENT_NEW_CONTACT = 138;
    conn.emit(EVENT_NEW_CONTACT, {
      publicKey,
      type: 3,
      advName: 'PizzaParty',
      lastAdvert: 1_700_000_000,
      advLat: 0,
      advLon: 0,
      flags: 0,
    });
    conn.emit(EVENT_DIRECT_MESSAGE, {
      pubKeyPrefix: publicKey.slice(0, 6),
      text: 'Bot Stats (24h):',
      senderTimestamp: 1_700_000_200,
      txtType: 0,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text).toMatchObject({
      type: 'text_message',
      payload: expect.objectContaining({
        channelIndex: -2,
        roomServerId: expect.any(Number),
        id: expect.stringMatching(/^room:/),
        payload: 'Bot Stats (24h):',
      }),
    });
    teardown();
  });

  it('emits meshcore_dm_ack on hop ACK (130)', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_DM_ACK, { ackCode: 0x80, roundTrip: 120 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'meshcore_dm_ack',
        payload: expect.objectContaining({ ackCode: 0x80, roundTrip: 120 }),
      }),
    );
    teardown();
  });

  it('emits meshcore_waiting_messages on event 131', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_WAITING_MESSAGES, {});
    expect(events.some((e) => e.type === 'meshcore_waiting_messages')).toBe(true);
    teardown();
  });

  it('emits meshcore_rf_rx on RF RX (136)', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_RF_RX, {
      lastSnr: 4.5,
      lastRssi: -80,
      raw: Uint8Array.from([1, 2, 3, 4]),
    });
    const rf = events.find((e) => e.type === 'meshcore_rf_rx');
    expect(rf).toMatchObject({
      type: 'meshcore_rf_rx',
      payload: expect.objectContaining({ lastSnr: 4.5, lastRssi: -80 }),
    });
    teardown();
  });

  it('emits device_status disconnected on disconnect', () => {
    const conn = mockMeshCoreConnection();
    const events: DomainEvent[] = [];
    const teardown = meshcoreProtocol.subscribe(conn, (e) => events.push(e));
    conn.emit(EVENT_DISCONNECTED, undefined);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'device_status',
        payload: expect.objectContaining({ status: 'disconnected' }),
      }),
    );
    teardown();
  });
});

describe('MeshCoreProtocol capability-gated operations', () => {
  it('rejects null or empty outbound text before calling the connection', async () => {
    const conn = {
      sendTextMessage: vi.fn(),
      sendChannelTextMessage: vi.fn(),
    } as unknown as Connection;

    await expect(
      meshcoreProtocol.sendMessage(null, { text: 'hello', channelIndex: 0 }),
    ).rejects.toThrow(/handle is required/);
    await expect(
      meshcoreProtocol.sendMessage(conn, { text: null as unknown as string, channelIndex: 0 }),
    ).rejects.toThrow(/contain text/);
    await expect(meshcoreProtocol.sendMessage(conn, { text: '', channelIndex: 0 })).rejects.toThrow(
      /contain text/,
    );
    expect(
      (conn as unknown as { sendChannelTextMessage: ReturnType<typeof vi.fn> })
        .sendChannelTextMessage,
    ).not.toHaveBeenCalled();
  });

  it('rejects an empty direct-message public key', async () => {
    const conn = { sendTextMessage: vi.fn() } as unknown as Connection;

    await expect(
      meshcoreProtocol.sendMessage(conn, {
        text: 'hello',
        destination: 1,
        destinationPubKey: new Uint8Array(),
      }),
    ).rejects.toThrow(/destinationPubKey/);
    expect(
      (conn as unknown as { sendTextMessage: ReturnType<typeof vi.fn> }).sendTextMessage,
    ).not.toHaveBeenCalled();
  });

  it('setConfig remains on legacy companion until Protocol JSON config lands', async () => {
    await expect(meshcoreProtocol.setConfig({}, {})).rejects.toThrow(/setConfig/);
  });

  it('commitConfig remains on legacy companion panel actions', async () => {
    await expect(meshcoreProtocol.commitConfig({})).rejects.toThrow(/commitConfig/);
  });
});
