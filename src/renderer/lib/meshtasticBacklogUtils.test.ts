import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh, Portnums, StoreForward } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildStoreForwardHistoryRequestBytes,
  buildStoreForwardHistoryToRadioBytes,
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  MQTT_RECONNECT_BACKLOG_MS,
  mqttMessageTreatAsHistory,
  parseStoreForwardHeartbeat,
  parseStoreForwardHistory,
  releaseStoreForwardHistoryRequest,
  reserveStoreForwardHistoryRequest,
  shouldRequestStoreForwardHistoryOnHeartbeat,
  writeToRadioWithoutQueue,
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

  it('parses ROUTER_HEARTBEAT payloads', () => {
    const heartbeat = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 120, secondary: 0 }),
    });
    expect(parseStoreForwardHeartbeat(heartbeat)).toEqual({ period: 120, secondary: 0 });

    const secondary = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 60, secondary: 1 }),
    });
    expect(parseStoreForwardHeartbeat(secondary)).toEqual({ period: 60, secondary: 1 });
    expect(parseStoreForwardHeartbeat(new Uint8Array())).toBeNull();
  });

  it('parses ROUTER_HISTORY payloads', () => {
    const history = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HISTORY, {
      case: 'history',
      value: create(StoreForward.StoreAndForward_HistorySchema, {
        historyMessages: 5,
        window: 60,
        lastRequest: 42,
      }),
    });
    expect(parseStoreForwardHistory(history)).toEqual({
      historyMessages: 5,
      window: 60,
      lastRequest: 42,
    });
    expect(parseStoreForwardHistory(new Uint8Array())).toBeNull();
  });

  it('returns null for non-text store-forward variants in decodeStoreForwardTextPayload', () => {
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

  it('builds ToRadio CLIENT_HISTORY packet with wantAck and wantResponse false', () => {
    const bytes = buildStoreForwardHistoryToRadioBytes({
      from: 0x11111111,
      to: 0x22222222,
      channel: 1,
      packetId: 99,
      windowMinutes: 120,
    });
    const toRadio = fromBinary(Mesh.ToRadioSchema, bytes) as unknown as {
      payloadVariant: {
        case?: string;
        value?: {
          from?: number;
          to?: number;
          channel?: number;
          id?: number;
          wantAck?: boolean;
          payloadVariant?: {
            case?: string;
            value?: { portnum?: number; wantResponse?: boolean; payload?: Uint8Array };
          };
        };
      };
    };
    expect(toRadio.payloadVariant.case).toBe('packet');
    const pkt = toRadio.payloadVariant.value;
    expect(pkt?.from).toBe(0x11111111);
    expect(pkt?.to).toBe(0x22222222);
    expect(pkt?.channel).toBe(1);
    expect(pkt?.id).toBe(99);
    expect(pkt?.wantAck).toBe(false);
    expect(pkt?.payloadVariant?.case).toBe('decoded');
    const decoded = pkt?.payloadVariant?.value;
    expect(decoded?.portnum).toBe(Portnums.PortNum.STORE_FORWARD_APP);
    expect(decoded?.wantResponse).toBe(false);
    expect(decoded?.payload?.length).toBeGreaterThan(0);
  });

  it('gates heartbeat-triggered history requests', () => {
    const base = {
      heartbeatSecondary: 0,
      connectedIsStoreForwardServer: false,
      alreadyRequestedServer: false,
      deviceConfigured: true,
    };
    expect(shouldRequestStoreForwardHistoryOnHeartbeat(base)).toBe(true);
    expect(shouldRequestStoreForwardHistoryOnHeartbeat({ ...base, heartbeatSecondary: 1 })).toBe(
      false,
    );
    expect(
      shouldRequestStoreForwardHistoryOnHeartbeat({ ...base, connectedIsStoreForwardServer: true }),
    ).toBe(false);
    expect(
      shouldRequestStoreForwardHistoryOnHeartbeat({ ...base, alreadyRequestedServer: true }),
    ).toBe(false);
    expect(shouldRequestStoreForwardHistoryOnHeartbeat({ ...base, deviceConfigured: false })).toBe(
      false,
    );
  });

  it('reserves and releases per-server history requests for one session', () => {
    const requested = new Set<number>();
    const server = 0xabcd1234;
    expect(reserveStoreForwardHistoryRequest(requested, server)).toBe(true);
    expect(reserveStoreForwardHistoryRequest(requested, server)).toBe(false);
    releaseStoreForwardHistoryRequest(requested, server);
    expect(reserveStoreForwardHistoryRequest(requested, server)).toBe(true);
  });

  it('writes ToRadio bytes directly to transport without queue', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const device = {
      transport: {
        toDevice: {
          getWriter: () => ({ write, releaseLock }),
        },
      },
    } as unknown as MeshDevice;

    const bytes = new Uint8Array([1, 2, 3]);
    await writeToRadioWithoutQueue(device, bytes);
    expect(write).toHaveBeenCalledWith(bytes);
    expect(releaseLock).toHaveBeenCalled();
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
