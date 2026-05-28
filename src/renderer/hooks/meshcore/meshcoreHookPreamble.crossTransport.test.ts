import { describe, expect, it } from 'vitest';

import { meshcoreChatStubNodeIdFromDisplayName } from '../../lib/meshcoreUtils';
import type { ChatMessage } from '../../lib/types';
import {
  findMeshcoreCrossTransportDuplicate,
  mapMeshcoreCrossTransportUpgrade,
  MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
  meshcoreCrossTransportMatch,
} from './meshcoreHookPreamble';

function baseMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 0x12345678,
    sender_name: 'Alice',
    payload: 'hello mesh',
    channel: 0,
    timestamp: 1_700_000_000_000,
    meshcoreDedupeKey: 'Alice: hello mesh',
    ...overrides,
  };
}

describe('meshcoreCrossTransportMatch', () => {
  it('matches MQTT then RF with different timestamps within window', () => {
    const mqtt = baseMsg({
      receivedVia: 'mqtt',
      timestamp: 1_700_000_000_000,
    });
    const rf = baseMsg({
      receivedVia: 'rf',
      timestamp: mqtt.timestamp + 3_000,
    });
    expect(meshcoreCrossTransportMatch(mqtt, rf)).toBe(true);
    expect(findMeshcoreCrossTransportDuplicate([mqtt], rf)).toBe(mqtt);
  });

  it('does not match when timestamps exceed the window', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt', timestamp: 0 });
    const rf = baseMsg({
      receivedVia: 'rf',
      timestamp: MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS + 1,
    });
    expect(meshcoreCrossTransportMatch(mqtt, rf)).toBe(false);
  });

  it('does not false-merge two messages on the same transport', () => {
    const first = baseMsg({ receivedVia: 'mqtt', timestamp: 0, payload: 'ok' });
    const second = baseMsg({
      receivedVia: 'mqtt',
      timestamp: 2_000,
      payload: 'ok',
    });
    expect(meshcoreCrossTransportMatch(first, second)).toBe(false);
  });

  it('matches stub senders by display name across transports', () => {
    const stubId = meshcoreChatStubNodeIdFromDisplayName('NVON 01');
    const mqtt = baseMsg({
      sender_id: stubId,
      sender_name: 'NVON 01',
      receivedVia: 'mqtt',
    });
    const rf = baseMsg({
      sender_id: 0,
      sender_name: 'NVON 01',
      receivedVia: 'rf',
      timestamp: mqtt.timestamp + 1_000,
    });
    expect(meshcoreCrossTransportMatch(mqtt, rf)).toBe(true);
  });

  it('matches reaction duplicates across transports', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt', emoji: 0x1f44d, replyId: 99 });
    const rf = baseMsg({
      receivedVia: 'rf',
      emoji: 0x1f44d,
      replyId: 99,
      timestamp: mqtt.timestamp + 500,
    });
    expect(meshcoreCrossTransportMatch(mqtt, rf)).toBe(true);
  });
});

describe('mapMeshcoreCrossTransportUpgrade', () => {
  it('upgrades mqtt row to both without inserting duplicate', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt' });
    const rf = baseMsg({
      receivedVia: 'rf',
      timestamp: mqtt.timestamp + 2_000,
    });
    const { messages, matched } = mapMeshcoreCrossTransportUpgrade([mqtt], rf);
    expect(matched).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].receivedVia).toBe('both');
  });

  it('returns matched=false when no duplicate found', () => {
    const msg = baseMsg({ receivedVia: 'mqtt' });
    const unrelated = baseMsg({
      payload: 'other',
      meshcoreDedupeKey: 'Bob: other',
      receivedVia: 'rf',
    });
    const { messages, matched } = mapMeshcoreCrossTransportUpgrade([msg], unrelated);
    expect(matched).toBe(false);
    expect(messages[0]).toBe(msg);
  });
});
