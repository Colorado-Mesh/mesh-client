import { describe, expect, it } from 'vitest';

import {
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
