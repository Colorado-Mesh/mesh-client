import { describe, expect, it } from 'vitest';

import {
  findMeshtasticCrossTransportDuplicate,
  mapMeshtasticCrossTransportUpgrade,
  MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
  meshtasticCrossTransportMatch,
  normalizeMeshtasticDedupPayload,
} from './meshtasticMessageDedup';
import type { ChatMessage } from './types';

function baseMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 0x12345678,
    sender_name: 'OW13',
    payload: 'hope all is well',
    channel: 0,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('normalizeMeshtasticDedupPayload', () => {
  it('strips placeholder "0" payloads', () => {
    expect(normalizeMeshtasticDedupPayload('0')).toBe('');
    expect(normalizeMeshtasticDedupPayload('hello')).toBe('hello');
  });
});

describe('meshtasticCrossTransportMatch', () => {
  it('matches MQTT then RF with different packetId and timestamp skew', () => {
    const mqtt = baseMsg({
      packetId: 0x11111111,
      receivedVia: 'mqtt',
      timestamp: 1_700_000_000_000,
    });
    const rf = baseMsg({
      packetId: 0x22222222,
      receivedVia: 'rf',
      timestamp: 1_700_000_060_000,
    });
    expect(meshtasticCrossTransportMatch(mqtt, rf)).toBe(true);
    expect(findMeshtasticCrossTransportDuplicate([mqtt], rf)).toBe(mqtt);
  });

  it('does not match when timestamps exceed the window', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt', timestamp: 0 });
    const rf = baseMsg({
      receivedVia: 'rf',
      timestamp: MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS + 1,
    });
    expect(meshtasticCrossTransportMatch(mqtt, rf)).toBe(false);
  });

  it('does not false-merge two messages on the same transport', () => {
    const first = baseMsg({ receivedVia: 'mqtt', timestamp: 0, payload: 'ok' });
    const second = baseMsg({
      receivedVia: 'mqtt',
      timestamp: 120_000,
      payload: 'ok',
    });
    expect(meshtasticCrossTransportMatch(first, second)).toBe(false);
  });

  it('matches packetId 0 on both paths with 30s skew', () => {
    const mqtt = baseMsg({
      packetId: 0,
      receivedVia: 'mqtt',
      timestamp: 1_000,
    });
    const rf = baseMsg({
      packetId: 0,
      receivedVia: 'rf',
      timestamp: 31_000,
    });
    expect(meshtasticCrossTransportMatch(mqtt, rf)).toBe(true);
  });

  it('never matches reactions', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt', emoji: 0x1f44d, replyId: 99 });
    const rf = baseMsg({ receivedVia: 'rf', emoji: 0x1f44d, replyId: 99 });
    expect(meshtasticCrossTransportMatch(mqtt, rf)).toBe(false);
  });
});

describe('mapMeshtasticCrossTransportUpgrade', () => {
  it('upgrades mqtt row to both and prefers non-zero RF packetId', () => {
    const mqtt = baseMsg({
      packetId: 0xaaaaaaaa,
      receivedVia: 'mqtt',
    });
    const rf = baseMsg({
      packetId: 0xbbbbbbbb,
      receivedVia: 'rf',
      rxHops: 4,
      timestamp: mqtt.timestamp + 60_000,
    });
    const { messages, matched, packetIdForDb } = mapMeshtasticCrossTransportUpgrade([mqtt], rf);
    expect(matched).toBe(true);
    expect(messages[0].receivedVia).toBe('both');
    expect(messages[0].rxHops).toBe(4);
    expect(messages[0].packetId).toBe(0xbbbbbbbb);
    expect(packetIdForDb).toBe(0xbbbbbbbb);
  });
});
