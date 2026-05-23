import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { StoreForward } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  buildStoreForwardHistoryRequestBytes,
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  MQTT_RECONNECT_BACKLOG_MS,
  mqttMessageTreatAsHistory,
} from './meshtasticBacklogUtils';

function sfPacket(rr: number, variant: { case: string; value: unknown }): Uint8Array {
  const msg = create(StoreForward.StoreAndForwardSchema, { rr, variant });
  return toBinary(StoreForward.StoreAndForwardSchema, msg);
}

describe('meshtasticBacklogUtils', () => {
  it('marks MQTT messages as history during reconnect backlog window', () => {
    const now = 1_000_000;
    const until = now + MQTT_RECONNECT_BACKLOG_MS;
    expect(mqttMessageTreatAsHistory(now + 1000, until)).toBe(true);
    expect(mqttMessageTreatAsHistory(until, until)).toBe(false);
    expect(mqttMessageTreatAsHistory(until + 1, until)).toBe(false);
    expect(mqttMessageTreatAsHistory(now, 0)).toBe(false);
  });

  it('decodes store-forward text variant payloads', () => {
    const bytes = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
      case: 'text',
      value: new TextEncoder().encode('  hello mesh  '),
    });
    expect(decodeStoreForwardTextPayload(bytes)).toBe('hello mesh');
    expect(decodeStoreForwardTextPayload(new Uint8Array())).toBeNull();
  });

  it('returns null for non-text store-forward variants', () => {
    const heartbeat = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 300, secondary: 0 }),
    });
    expect(decodeStoreForwardTextPayload(heartbeat)).toBeNull();

    const stats = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_STATS, {
      case: 'stats',
      value: create(StoreForward.StoreAndForward_StatisticsSchema, {
        messagesTotal: 10,
        messagesSaved: 5,
        messagesMax: 100,
        upTime: 3600,
        requests: 1,
        requestsHistory: 1,
        heartbeat: true,
        returnMax: 10,
        returnWindow: 60,
      }),
    });
    expect(decodeStoreForwardTextPayload(stats)).toBeNull();

    const history = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HISTORY, {
      case: 'history',
      value: create(StoreForward.StoreAndForward_HistorySchema, {
        historyMessages: 5,
        window: 60,
        lastRequest: 0,
      }),
    });
    expect(decodeStoreForwardTextPayload(history)).toBeNull();
  });

  it('returns null for invalid store-forward bytes', () => {
    expect(decodeStoreForwardTextPayload(new Uint8Array([0xff, 0xff]))).toBeNull();
    expect(decodeStoreForwardTextPayload(new TextEncoder().encode('plain text'))).toBeNull();
  });

  it('builds CLIENT_HISTORY request bytes with defaults and custom window', () => {
    const defaultBytes = buildStoreForwardHistoryRequestBytes();
    const parsedDefault = fromBinary(
      StoreForward.StoreAndForwardSchema,
      defaultBytes,
    ) as unknown as {
      rr: number;
      variant: {
        case?: string;
        value?: { historyMessages?: number; window?: number; lastRequest?: number };
      };
    };
    expect(parsedDefault.rr).toBe(StoreForward.StoreAndForward_RequestResponse.CLIENT_HISTORY);
    expect(parsedDefault.variant.case).toBe('history');
    if (parsedDefault.variant.case === 'history' && parsedDefault.variant.value) {
      expect(parsedDefault.variant.value.historyMessages).toBe(0);
      expect(parsedDefault.variant.value.window).toBe(0);
      expect(parsedDefault.variant.value.lastRequest).toBe(0);
    }

    const customBytes = buildStoreForwardHistoryRequestBytes({
      windowMinutes: 120,
      lastRequest: 42,
    });
    const parsedCustom = fromBinary(StoreForward.StoreAndForwardSchema, customBytes) as unknown as {
      variant: {
        case?: string;
        value?: { window?: number; lastRequest?: number };
      };
    };
    if (parsedCustom.variant.case === 'history' && parsedCustom.variant.value) {
      expect(parsedCustom.variant.value.window).toBe(120);
      expect(parsedCustom.variant.value.lastRequest).toBe(42);
    }
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
