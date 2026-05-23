import { describe, expect, it } from 'vitest';

import {
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  MQTT_RECONNECT_BACKLOG_MS,
  mqttMessageTreatAsHistory,
} from './meshtasticBacklogUtils';

describe('meshtasticBacklogUtils', () => {
  it('marks MQTT messages as history during reconnect backlog window', () => {
    const now = 1_000_000;
    const until = now + MQTT_RECONNECT_BACKLOG_MS;
    expect(mqttMessageTreatAsHistory(now + 1000, until)).toBe(true);
    expect(mqttMessageTreatAsHistory(until + 1, until)).toBe(false);
    expect(mqttMessageTreatAsHistory(now, 0)).toBe(false);
  });

  it('decodes store-forward text payloads', () => {
    const data = new TextEncoder().encode('  hello mesh  ');
    expect(decodeStoreForwardTextPayload(data)).toBe('hello mesh');
    expect(decodeStoreForwardTextPayload(new Uint8Array())).toBeNull();
  });

  it('dedupes history messages within time window', () => {
    const existing = [
      {
        isHistory: true,
        sender_id: 0xabcd1234,
        payload: 'cached',
        timestamp: 1000,
      },
    ];
    expect(
      isDuplicateHistoryMessage(existing, {
        isHistory: true,
        sender_id: 0xabcd1234,
        payload: 'cached',
        timestamp: 3000,
      }),
    ).toBe(true);
    expect(
      isDuplicateHistoryMessage(existing, {
        isHistory: true,
        sender_id: 0xabcd1234,
        payload: 'other',
        timestamp: 3000,
      }),
    ).toBe(false);
  });
});
