import { describe, expect, it } from 'vitest';

import {
  buildMeshtasticNodeMapFromDbRows,
  mergeMeshtasticDbHydrationWithLive,
  meshtasticLoosePersistenceMatchKey,
} from './meshtasticDbCacheHydration';
import type { ChatMessage } from './types';

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'payload' | 'timestamp'>,
): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'A',
    channel: 0,
    ...partial,
  };
}

describe('buildMeshtasticNodeMapFromDbRows', () => {
  it('excludes MeshCore-only rows persisted in the Meshtastic nodes table', () => {
    const map = buildMeshtasticNodeMapFromDbRows([
      {
        node_id: 0xabc123,
        long_name: 'MC Repeater',
        short_name: '',
        hw_model: 'Repeater',
        battery: 0,
        snr: 0,
        rssi: 0,
        last_heard: 1,
        latitude: null,
        longitude: null,
        role: null,
        favorited: 0,
        source: 'rf',
        hops: null,
        path: null,
        hops_away: 1,
      } as never,
      {
        node_id: 42,
        long_name: 'T-Beam',
        short_name: 'TB',
        hw_model: 'TBEAM',
        battery: 0,
        snr: 0,
        rssi: 0,
        last_heard: 1,
        latitude: null,
        longitude: null,
        role: 0,
        favorited: 0,
        source: 'rf',
        hops: null,
        path: null,
        hops_away: 0,
      } as never,
    ]);
    expect(map.has(0xabc123)).toBe(false);
    expect(map.has(42)).toBe(true);
  });
});

describe('mergeMeshtasticDbHydrationWithLive', () => {
  it('preserves in-flight RF lines not yet in SQLite', () => {
    const fromDb = [msg({ id: 1, payload: 'db', timestamp: 1000 })];
    const live = [msg({ id: 99, payload: 'live', timestamp: 2000, packetId: 0xabc })];
    const merged = mergeMeshtasticDbHydrationWithLive(live, fromDb);
    expect(merged.map((m) => m.payload)).toEqual(['db', 'live']);
  });

  it('dedupes by packetId when DB row arrives after live RF', () => {
    const fromDb = [msg({ id: 1, payload: 'hi', timestamp: 1000, packetId: 42 })];
    const live = [msg({ payload: 'hi', timestamp: 1001, packetId: 42 })];
    const merged = mergeMeshtasticDbHydrationWithLive(live, fromDb);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(1);
  });

  it('uses loose key when ids are missing', () => {
    const key = meshtasticLoosePersistenceMatchKey(
      msg({ payload: 'x', timestamp: 500, sender_id: 2 }),
    );
    const fromDb = [msg({ payload: 'x', timestamp: 500, sender_id: 2 })];
    const live = [msg({ payload: 'x', timestamp: 500, sender_id: 2 })];
    expect(key).toBe(meshtasticLoosePersistenceMatchKey(live[0]));
    const merged = mergeMeshtasticDbHydrationWithLive(live, fromDb);
    expect(merged).toHaveLength(1);
  });
});
