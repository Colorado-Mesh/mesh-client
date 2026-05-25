import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh, Portnums, StoreForward } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildStoreForwardHistoryRequestBytes,
  buildStoreForwardHistoryToRadioBytes,
  decodeStoreForwardTextPayload,
  getLastSfHistoryFetchMs,
  isDuplicateHistoryMessage,
  isLikelyReadableChatText,
  loadSfHistoryFetchState,
  MQTT_RECONNECT_BACKLOG_MS,
  mqttMessageTreatAsHistory,
  parseStoreForwardHeartbeat,
  parseStoreForwardHistory,
  recordSfHistoryFetch,
  releaseStoreForwardHistoryRequest,
  reserveStoreForwardHistoryRequest,
  resolveAutoStoreForwardHistoryWindowMinutes,
  resolveMeshtasticTextMessagePayload,
  resolveStoreForwardServerFromObservedPackets,
  setRemoteAdminReadsActive,
  SF_AUTO_HISTORY_COOLDOWN_MS,
  SF_AUTO_HISTORY_MESSAGE_CAP,
  SF_AUTO_HISTORY_OFFLINE_MIN_MS,
  SF_AUTO_HISTORY_WINDOW_CAP_MIN,
  SF_HISTORY_FETCH_STATE_STORAGE_KEY,
  SF_MANUAL_HISTORY_MESSAGE_CAP,
  shouldAutoRequestStoreForwardHistoryOnHeartbeat,
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

  it('builds CLIENT_HISTORY request bytes with message cap', () => {
    const capped = buildStoreForwardHistoryRequestBytes({
      messageCap: SF_AUTO_HISTORY_MESSAGE_CAP,
    });
    const parsed = fromBinary(StoreForward.StoreAndForwardSchema, capped) as unknown as {
      variant: { case?: string; value?: { historyMessages?: number } };
    };
    if (parsed.variant.case === 'history' && parsed.variant.value) {
      expect(parsed.variant.value.historyMessages).toBe(SF_AUTO_HISTORY_MESSAGE_CAP);
    }
  });

  it('resolves auto history window from heartbeat period', () => {
    expect(resolveAutoStoreForwardHistoryWindowMinutes(0)).toBe(SF_AUTO_HISTORY_WINDOW_CAP_MIN);
    expect(resolveAutoStoreForwardHistoryWindowMinutes(30)).toBe(30);
    expect(resolveAutoStoreForwardHistoryWindowMinutes(999)).toBe(SF_AUTO_HISTORY_WINDOW_CAP_MIN);
  });

  it('gates auto-fetch on cooldown, offline, and opt-out', () => {
    const now = 1_000_000;
    const base = {
      heartbeatSecondary: 0,
      connectedIsStoreForwardServer: false,
      alreadyRequestedServer: false,
      deviceConfigured: true,
      autoFetchEnabled: true,
      now,
      lastFetchMs: null as number | null,
      lastDisconnectMs: null as number | null,
    };
    expect(shouldAutoRequestStoreForwardHistoryOnHeartbeat(base)).toBe(true);
    expect(
      shouldAutoRequestStoreForwardHistoryOnHeartbeat({ ...base, autoFetchEnabled: false }),
    ).toBe(false);
    expect(
      shouldAutoRequestStoreForwardHistoryOnHeartbeat({
        ...base,
        lastFetchMs: now - SF_AUTO_HISTORY_COOLDOWN_MS + 1000,
      }),
    ).toBe(false);
    expect(
      shouldAutoRequestStoreForwardHistoryOnHeartbeat({
        ...base,
        lastDisconnectMs: now - SF_AUTO_HISTORY_OFFLINE_MIN_MS + 1000,
      }),
    ).toBe(false);
    expect(
      shouldAutoRequestStoreForwardHistoryOnHeartbeat({
        ...base,
        lastFetchMs: now - SF_AUTO_HISTORY_COOLDOWN_MS - 1000,
        lastDisconnectMs: now - SF_AUTO_HISTORY_OFFLINE_MIN_MS - 1000,
      }),
    ).toBe(true);
  });

  it('resolves S&F server from latest primary heartbeat in observed packets', () => {
    const serverA = 0xaaaa;
    const serverB = 0xbbbb;
    const hbA = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 60, secondary: 0 }),
    });
    const hbB = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 120, secondary: 0 }),
    });
    const map = new Map([
      [serverA, [{ data: hbA, timestamp: 1000 }]],
      [serverB, [{ data: hbB, timestamp: 2000 }]],
    ]);
    expect(resolveStoreForwardServerFromObservedPackets(map, null)).toEqual({
      serverNodeId: serverB,
      heartbeatPeriod: 120,
    });
    expect(resolveStoreForwardServerFromObservedPackets(map, serverA)).toEqual({
      serverNodeId: serverA,
      heartbeatPeriod: 60,
    });
  });

  it('returns null when only secondary heartbeats are observed', () => {
    const server = 0xcccc;
    const hb = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 60, secondary: 1 }),
    });
    const map = new Map([[server, [{ data: hb, timestamp: 1000 }]]]);
    expect(resolveStoreForwardServerFromObservedPackets(map, null)).toBeNull();
  });

  it('persists per-server fetch timestamps in localStorage', () => {
    localStorage.removeItem(SF_HISTORY_FETCH_STATE_STORAGE_KEY);
    const server = 0xabcd1234;
    expect(getLastSfHistoryFetchMs(server)).toBeNull();
    recordSfHistoryFetch(server, 42_000);
    expect(getLastSfHistoryFetchMs(server)).toBe(42_000);
    expect(loadSfHistoryFetchState()[String(server)]).toBe(42_000);
    localStorage.removeItem(SF_HISTORY_FETCH_STATE_STORAGE_KEY);
  });

  it('uses higher cap constant for manual fetch', () => {
    expect(SF_MANUAL_HISTORY_MESSAGE_CAP).toBeGreaterThan(SF_AUTO_HISTORY_MESSAGE_CAP);
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

  it('queues concurrent ToRadio writes when WritableStream writer is locked', async () => {
    let locked = false;
    const order: number[] = [];
    const write = vi.fn().mockImplementation(async (chunk: Uint8Array) => {
      order.push(chunk[0] ?? 0);
      await new Promise((r) => setTimeout(r, 5));
    });
    const releaseLock = vi.fn().mockImplementation(() => {
      locked = false;
    });
    const device = {
      transport: {
        toDevice: {
          getWriter: () => {
            if (locked) {
              throw new Error(
                "Failed to execute 'getWriter' on 'WritableStream': Cannot create writer when WritableStream is locked",
              );
            }
            locked = true;
            return { write, releaseLock };
          },
        },
      },
    } as unknown as MeshDevice;

    await Promise.all([
      writeToRadioWithoutQueue(device, new Uint8Array([1])),
      writeToRadioWithoutQueue(device, new Uint8Array([2])),
    ]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(order).toEqual([1, 2]);
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });

  it('retries when WritableStream writer is locked by SDK traffic', async () => {
    let getWriterAttempts = 0;
    const write = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const lockedError = new Error(
      "Failed to execute 'getWriter' on 'WritableStream': Cannot create writer when WritableStream is locked",
    );
    const device = {
      transport: {
        toDevice: {
          getWriter: () => {
            getWriterAttempts++;
            if (getWriterAttempts < 3) throw lockedError;
            return { write, releaseLock };
          },
        },
      },
    } as unknown as MeshDevice;

    vi.useFakeTimers();
    const promise = writeToRadioWithoutQueue(device, new Uint8Array([9]));
    await vi.runAllTimersAsync();
    await promise;

    expect(getWriterAttempts).toBe(3);
    expect(write).toHaveBeenCalledWith(new Uint8Array([9]));
    expect(releaseLock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('throws after WritableStream lock retries are exhausted', async () => {
    const lockedError = new Error(
      "Failed to execute 'getWriter' on 'WritableStream': Cannot create writer when WritableStream is locked",
    );
    const device = {
      transport: {
        toDevice: {
          getWriter: () => {
            throw lockedError;
          },
        },
      },
    } as unknown as MeshDevice;

    vi.useFakeTimers();
    const promise = writeToRadioWithoutQueue(device, new Uint8Array([1]));
    const rejection = expect(promise).rejects.toThrow(/WritableStream is locked/);
    await vi.runAllTimersAsync();
    await rejection;
    vi.useRealTimers();
  });

  it('uses extended WritableStream lock retries while remote admin reads are active', async () => {
    let getWriterAttempts = 0;
    const write = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const lockedError = new Error(
      "Failed to execute 'getWriter' on 'WritableStream': Cannot create writer when WritableStream is locked",
    );
    const device = {
      transport: {
        toDevice: {
          getWriter: () => {
            getWriterAttempts++;
            if (getWriterAttempts < 8) throw lockedError;
            return { write, releaseLock };
          },
        },
      },
    } as unknown as MeshDevice;

    setRemoteAdminReadsActive(true);
    vi.useFakeTimers();
    try {
      const promise = writeToRadioWithoutQueue(device, new Uint8Array([4]));
      await vi.runAllTimersAsync();
      await promise;
      expect(getWriterAttempts).toBe(8);
      expect(write).toHaveBeenCalledWith(new Uint8Array([4]));
    } finally {
      setRemoteAdminReadsActive(false);
      vi.useRealTimers();
    }
  });

  describe('resolveMeshtasticTextMessagePayload', () => {
    const garbledUserBytes = new Uint8Array([
      0x16, 0x15, 0x18, 0x0d, 0x25, 0x11, 0x6a, 0x28, 0x02, 0x58, 0x04, 0x78, 0x03, 0x01, 0x0e,
      0x01, 0x05, 0x01,
    ]);

    it('rejects garbled control-heavy payloads from the field report', () => {
      expect(resolveMeshtasticTextMessagePayload(garbledUserBytes)).toBeNull();
      expect(isLikelyReadableChatText(garbledUserBytes)).toBe(false);
    });

    it('rejects store-forward heartbeat protobuf on TEXT port', () => {
      const heartbeat = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
        case: 'heartbeat',
        value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 120, secondary: 0 }),
      });
      expect(resolveMeshtasticTextMessagePayload(heartbeat)).toBeNull();
    });

    it('accepts store-forward text variant with viaStoreForward flag', () => {
      const bytes = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
        case: 'text',
        value: new TextEncoder().encode('summit check-in'),
      });
      expect(resolveMeshtasticTextMessagePayload(bytes)).toEqual({
        text: 'summit check-in',
        viaStoreForward: true,
      });
    });

    it('accepts normal UTF-8 chat text', () => {
      const bytes = new TextEncoder().encode("Yes, I'm on the summit");
      expect(resolveMeshtasticTextMessagePayload(bytes)).toEqual({
        text: "Yes, I'm on the summit",
      });
    });

    it('accepts short and emoji payloads', () => {
      expect(resolveMeshtasticTextMessagePayload(new TextEncoder().encode('OK'))).toEqual({
        text: 'OK',
      });
      expect(resolveMeshtasticTextMessagePayload(new TextEncoder().encode('🦥'))).toEqual({
        text: '🦥',
      });
    });
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
