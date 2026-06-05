import { describe, expect, it } from 'vitest';

import {
  findMeshtasticCrossTransportDuplicate,
  findMeshtasticStoreForwardDuplicate,
  mapMeshtasticCrossTransportUpgrade,
  MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
  meshtasticCrossTransportMatch,
  meshtasticStoreForwardContentMatch,
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

  it('matches reaction duplicates across transports', () => {
    const mqtt = baseMsg({ receivedVia: 'mqtt', emoji: 0x1f44d, replyId: 99 });
    const rf = baseMsg({
      receivedVia: 'rf',
      emoji: 0x1f44d,
      replyId: 99,
      timestamp: mqtt.timestamp + 5,
    });
    expect(meshtasticCrossTransportMatch(mqtt, rf)).toBe(true);
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

  it('returns matched=false and leaves messages unchanged when no duplicate found', () => {
    const msg = baseMsg({ packetId: 0xaaaaaaaa, receivedVia: 'mqtt' });
    const unrelated = baseMsg({ payload: 'different', packetId: 0xcccccccc, receivedVia: 'rf' });
    const { messages, matched, packetIdForDb } = mapMeshtasticCrossTransportUpgrade(
      [msg],
      unrelated,
    );
    expect(matched).toBe(false);
    expect(messages[0]).toBe(msg);
    expect(packetIdForDb).toBeUndefined();
  });

  it('falls back to existing row packetId when incoming packetId is 0', () => {
    const mqtt = baseMsg({ packetId: 0xdeadbeef, receivedVia: 'mqtt' });
    const rf = baseMsg({ packetId: 0, receivedVia: 'rf', timestamp: mqtt.timestamp + 1_000 });
    const { messages, packetIdForDb } = mapMeshtasticCrossTransportUpgrade([mqtt], rf);
    expect(messages[0].packetId).toBe(0xdeadbeef);
    expect(packetIdForDb).toBe(0xdeadbeef);
  });

  it('preserves existing rxHops when incoming has none', () => {
    const mqtt = baseMsg({ packetId: 0x11111111, receivedVia: 'mqtt', rxHops: 2 });
    const rf = baseMsg({
      packetId: 0x22222222,
      receivedVia: 'rf',
      rxHops: undefined,
      timestamp: mqtt.timestamp + 5_000,
    });
    const { messages } = mapMeshtasticCrossTransportUpgrade([mqtt], rf);
    expect(messages[0].rxHops).toBe(2);
  });

  it('does not clobber optimistic/device id when MQTT echo arrives before RF', () => {
    const optimistic = baseMsg({ packetId: 0x99999999, status: 'sending' });
    const mqtt = baseMsg({
      packetId: 0xbbbbbbbb,
      receivedVia: 'mqtt',
      timestamp: optimistic.timestamp + 5_000,
    });
    const { messages } = mapMeshtasticCrossTransportUpgrade([optimistic], mqtt);
    expect(messages[0].packetId).toBe(0x99999999);
  });
});

describe('Meshtastic runtime cross-transport integration — logic layer', () => {
  it('MQTT path: upgrade-then-return keeps RF packetId when RF arrived first', () => {
    const rfMsg = baseMsg({ packetId: 0xaaaaaaaa, receivedVia: 'rf' });
    const mqttMsg = baseMsg({
      packetId: 0xbbbbbbbb,
      receivedVia: 'mqtt',
      timestamp: rfMsg.timestamp + 30_000,
    });

    const crossDup = findMeshtasticCrossTransportDuplicate([rfMsg], mqttMsg);
    expect(crossDup).toBe(rfMsg);

    const { messages: next, matched } = mapMeshtasticCrossTransportUpgrade([rfMsg], mqttMsg);
    expect(matched).toBe(true);
    expect(next[0].receivedVia).toBe('both');
    expect(next[0].packetId).toBe(0xaaaaaaaa);
  });

  it('RF path: upgrade-then-return skips saving duplicate when cross-dup found', () => {
    // Simulates the RF handler in useMeshtasticRuntime: MQTT message arrived first, RF arrives later
    const mqttMsg = baseMsg({ packetId: 0xaaaaaaaa, receivedVia: 'mqtt' });
    const rfMsg = baseMsg({
      packetId: 0xcccccccc,
      receivedVia: 'rf',
      rxHops: 3,
      timestamp: mqttMsg.timestamp + 45_000,
    });

    const crossDup = findMeshtasticCrossTransportDuplicate([mqttMsg], rfMsg);
    expect(crossDup).toBe(mqttMsg);

    const {
      messages: next,
      matched,
      packetIdForDb,
    } = mapMeshtasticCrossTransportUpgrade([mqttMsg], { ...rfMsg, rxHops: rfMsg.rxHops ?? 3 });
    expect(matched).toBe(true);
    expect(next[0].receivedVia).toBe('both');
    expect(next[0].rxHops).toBe(3);
    expect(packetIdForDb).toBe(0xcccccccc);
  });

  it('cross-dup when reaction arrives on opposite transport', () => {
    const mqttReaction = baseMsg({ receivedVia: 'mqtt', emoji: 0x1f44d, replyId: 42 });
    const rfReaction = baseMsg({
      receivedVia: 'rf',
      emoji: 0x1f44d,
      replyId: 42,
      timestamp: mqttReaction.timestamp + 5_000,
    });
    expect(findMeshtasticCrossTransportDuplicate([mqttReaction], rfReaction)).toBe(mqttReaction);
  });

  it('no cross-dup when payloads differ', () => {
    const mqttMsg = baseMsg({ receivedVia: 'mqtt', payload: 'hello' });
    const rfMsg = baseMsg({
      receivedVia: 'rf',
      payload: 'world',
      timestamp: mqttMsg.timestamp + 1_000,
    });
    expect(findMeshtasticCrossTransportDuplicate([mqttMsg], rfMsg)).toBeUndefined();
  });
});

describe('findMeshtasticStoreForwardDuplicate', () => {
  it('matches live RF row for S&F replay without time window', () => {
    const live = baseMsg({ receivedVia: 'rf', timestamp: 1_600_000_000_000 });
    const sfReplay = baseMsg({
      viaStoreForward: true,
      receivedVia: 'mqtt',
      timestamp: 1_700_000_000_000,
    });
    expect(meshtasticStoreForwardContentMatch(live, sfReplay)).toBe(true);
    expect(findMeshtasticStoreForwardDuplicate([live], sfReplay)).toBe(live);
  });
});
