import type { Connection } from '@liamcottle/meshcore.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcoreProtocol } from './MeshCoreProtocol';
import type { DomainEvent } from './Protocol';

const EVENT_ADVERT = 128;
const EVENT_CHANNEL_MESSAGE = 8;
const EVENT_DIRECT_MESSAGE = 7;

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
});

describe('MeshCoreProtocol capability-gated operations', () => {
  it('setConfig remains on legacy companion until Protocol JSON config lands', async () => {
    await expect(meshcoreProtocol.setConfig({}, {})).rejects.toThrow(/setConfig/);
  });

  it('commitConfig remains on legacy companion panel actions', async () => {
    await expect(meshcoreProtocol.commitConfig({})).rejects.toThrow(/commitConfig/);
  });
});
