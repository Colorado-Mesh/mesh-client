import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '@/renderer/lib/drivers/PacketRouter';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import type {
  DeviceLogEntry,
  MeshCoreConnection,
  RxPacketEntry,
} from '@/renderer/lib/meshcore/meshcoreHookTypes';
import * as meshcoreRepeaterRpcInFlight from '@/renderer/lib/meshcoreRepeaterRpcInFlight';
import {
  beginMeshcoreSilentBulkAttempt,
  resetMeshcoreWaitingMessagesDrainState,
} from '@/renderer/lib/meshcoreWaitingMessagesDrain';
import type { DomainEvent } from '@/renderer/lib/protocols/Protocol';
import {
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP,
} from '@/renderer/lib/timeConstants';
import type { ChatMessage, DeviceState, TelemetryPoint } from '@/renderer/lib/types';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { useNodeStore } from '@/renderer/stores/nodeStore';

import { attachMeshcoreConnSideEffects } from './meshcoreConnSideEffects';
import type { MeshcoreConnSideEffectsCtx } from './meshcoreConnSideEffectsCtx';
import type { PendingDmAckEntry } from './meshcoreHookPreamble';
import {
  clearMeshcoreWaitingMessagesFollowUp,
  resetMeshcoreWaitingMessagesSilentFollowUpChain,
  setMeshcoreProcessWaitingMessagesInFlight,
} from './meshcoreWaitingMessagesSyncState';

const ID = 'meshcore-conn-side-effects-test';

function ref<T>(current: T) {
  return { current };
}

interface Harness {
  ctx: MeshcoreConnSideEffectsCtx;
  conn: MeshCoreConnection;
  deviceLogs: DeviceLogEntry[];
  rawPackets: RxPacketEntry[];
  signal: TelemetryPoint[];
  state: DeviceState;
  cliHistory: { nodeId: number; text: string }[];
  handleResponse: ReturnType<typeof vi.fn>;
  teardownConn: ReturnType<typeof vi.fn>;
  handleConnectionLost: ReturnType<typeof vi.fn>;
  syncNextMessage: ReturnType<typeof vi.fn>;
  pendingAcks: Map<number, PendingDmAckEntry>;
  messages: ChatMessage[];
}

function makeHarness(overrides?: { handleResponseResult?: boolean }): Harness {
  const deviceLogs: DeviceLogEntry[] = [];
  const rawPackets: RxPacketEntry[] = [];
  const signal: TelemetryPoint[] = [];
  const cliHistory: { nodeId: number; text: string }[] = [];
  const pendingAcks = new Map<number, PendingDmAckEntry>();
  const messages: ChatMessage[] = [];
  let state: DeviceState = {
    status: 'configured',
    myNodeNum: 1,
    connectionType: 'ble',
  };

  const syncNextMessage = vi.fn().mockResolvedValue(null);
  const conn = {
    getWaitingMessages: vi.fn().mockResolvedValue([]),
    syncNextMessage,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MeshCoreConnection;

  const handleResponse = vi.fn().mockReturnValue(overrides?.handleResponseResult ?? false);
  const teardownConn = vi.fn();
  const handleConnectionLost = vi.fn();

  const ctx: MeshcoreConnSideEffectsCtx = {
    resolveIdentityId: () => ID,
    meshcoreIdentityIdRef: ref<string | null>(ID),
    meshcoreDriverConnectedRef: ref(true),
    connRef: ref<MeshCoreConnection | null>(conn),
    lastPacketLogPublishFailureLogAtRef: ref(0),
    meshcoreContactsRefreshTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    meshcoreHookMountedRef: ref(true),
    meshcoreSessionPathUpdatedNodeIdsRef: ref(new Set<number>()),
    meshcoreWaitingMessagesPollRef: ref<ReturnType<typeof setInterval> | null>(null),
    meshcoreConnectTypeRef: ref<'ble' | 'serial' | 'tcp'>('ble'),
    mqttStatusRef: ref('disconnected' as const),
    myNodeNumRef: ref(1),
    nicknameMapRef: ref(new Map<number, string>()),
    readNodes: () => getIdentityNodeMap(ID),
    pendingAcksRef: ref(pendingAcks),
    processWaitingMessagesRef: ref<
      | ((options?: {
          showSyncBanner?: boolean;
          force?: boolean;
          incrementalOnly?: boolean;
        }) => Promise<void>)
      | null
    >(null),
    pubKeyMapRef: ref(new Map<number, Uint8Array>()),
    pubKeyPrefixMapRef: ref(new Map<string, number>()),
    rawPacketsRef: ref(rawPackets),
    repeaterCommandServiceRef: ref({
      handleResponse,
      clear: vi.fn(),
      parseResponseToken: (text: string) => ({ token: null, body: text }),
    } as never),
    selfInfoRef: ref(null),
    setDeviceLogs: (updater) => {
      const next = typeof updater === 'function' ? updater(deviceLogs) : updater;
      deviceLogs.splice(0, deviceLogs.length, ...next);
    },
    setMeshcorePingRouteReadyEpoch: vi.fn(),
    setMessages: vi.fn(),
    setQueueStatus: vi.fn(),
    setRawPackets: (updater) => {
      const next = typeof updater === 'function' ? updater(rawPackets) : updater;
      rawPackets.splice(0, rawPackets.length, ...next);
    },
    setSignalTelemetry: (updater) => {
      const next = typeof updater === 'function' ? updater(signal) : updater;
      signal.splice(0, signal.length, ...next);
    },
    setState: (updater) => {
      state = typeof updater === 'function' ? updater(state) : updater;
    },
    setWaitingMessagesCount: vi.fn(),
    setWaitingMessagesSyncActive: vi.fn(),
    setWaitingMessagesSyncProgress: vi.fn(),
    setWaitingMessagesSilentDrainActive: vi.fn(),
    setWaitingMessagesDrainDeferred: vi.fn(),
    addMessagesBatch: vi.fn(),
    addCliHistoryEntry: (nodeId, entry) => {
      cliHistory.push({ nodeId, text: entry.text });
    },
    teardownMeshcoreConnEventListeners: teardownConn,
    handleConnectionLostRef: ref(handleConnectionLost),
    meshcoreExplicitDisconnectRef: ref(false),
  };

  return {
    ctx,
    conn,
    deviceLogs,
    rawPackets,
    signal,
    get state() {
      return state;
    },
    cliHistory,
    handleResponse,
    teardownConn,
    handleConnectionLost,
    syncNextMessage,
    pendingAcks,
    messages,
  };
}

function dispatch(event: DomainEvent, identityId = ID): void {
  packetRouter.dispatch(event, identityId);
}

describe('attachMeshcoreConnSideEffects', () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    resetMeshcoreWaitingMessagesDrainState(0);
    setMeshcoreProcessWaitingMessagesInFlight(null);
    clearMeshcoreWaitingMessagesFollowUp();
    resetMeshcoreWaitingMessagesSilentFollowUpChain();
    useNodeStore.setState({ nodes: {} });
    useMessageStore.setState({ messages: {} });
  });

  afterEach(() => {
    detach?.();
    detach = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('routes CLI data responses to the repeater command service', () => {
    const h = makeHarness({ handleResponseResult: true });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({
      type: 'meshcore_cli_response',
      payload: { text: 'A1|uptime 42', senderNodeId: 0x1234, pubKeyPrefixHex: 'aabbcc' },
    });

    expect(h.handleResponse).toHaveBeenCalledWith('A1|uptime 42', 0x1234);
    expect(h.cliHistory).toHaveLength(0);
  });

  it('appends unmatched CLI responses to panel history', () => {
    const h = makeHarness({ handleResponseResult: false });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({
      type: 'meshcore_cli_response',
      payload: { text: 'stray output', senderNodeId: 0x99, pubKeyPrefixHex: 'aabbcc' },
    });

    expect(h.cliHistory).toEqual([{ nodeId: 0x99, text: 'stray output' }]);
  });

  it('ignores events routed to a different identity', () => {
    const h = makeHarness({ handleResponseResult: true });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch(
      {
        type: 'meshcore_cli_response',
        payload: { text: 'other', senderNodeId: 1, pubKeyPrefixHex: 'aabbcc' },
      },
      'some-other-identity',
    );

    expect(h.handleResponse).not.toHaveBeenCalled();
  });

  it('records RF RX into device logs, signal telemetry, and the raw packet log', () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({
      type: 'meshcore_rf_rx',
      payload: { lastSnr: 7.5, lastRssi: -60, raw: Uint8Array.from([0x11, 0x22, 0x33, 0x44]) },
    });

    expect(h.deviceLogs.at(-1)?.message).toContain('SNR=7.50dB RSSI=-60dBm');
    expect(h.signal.at(-1)).toMatchObject({ snr: 7.5, rssi: -60 });
    expect(h.rawPackets).toHaveLength(1);
    expect(h.ctx.rawPacketsRef.current).toHaveLength(1);
  });

  it('logs RF RX without raw bytes and skips the raw packet log', () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({ type: 'meshcore_rf_rx', payload: { lastSnr: 0, lastRssi: 0, raw: null } });

    expect(h.deviceLogs).toHaveLength(1);
    expect(h.rawPackets).toHaveLength(0);
  });

  it('resolves a pending DM ack and persists the new status', () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    const timeoutId = setTimeout(() => {}, 60_000);
    h.pendingAcks.set(0x80, {
      timeoutId,
      mapKeys: [0x80],
      canonicalPacketIdU32: 0x80,
    });

    dispatch({ type: 'meshcore_dm_ack', payload: { ackCode: 0x80 } });

    expect(h.pendingAcks.size).toBe(0);
    expect(window.electronAPI.db.updateMeshcoreMessageStatus).toHaveBeenCalledWith(0x80, 'acked');
    clearTimeout(timeoutId);
  });

  it('resolves a late DM ack against messageStore rows instead of a runtime mirror', () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    useMessageStore.setState({
      messages: {
        [ID]: {
          '128': {
            id: '128',
            from: 1,
            to: 42,
            payload: 'late dm',
            channelIndex: -1,
            timestamp: 1_700_000_000_000,
            status: 'sending',
          },
        },
      },
    });

    dispatch({ type: 'meshcore_dm_ack', payload: { ackCode: 0x80 } });

    expect(h.ctx.setMessages).toHaveBeenCalled();
    expect(window.electronAPI.db.updateMeshcoreMessageStatus).toHaveBeenCalledWith(0x80, 'acked');
  });

  it('marks a NACK ack code as failed', () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({ type: 'meshcore_dm_ack', payload: { ackCode: 0x81 } });

    expect(window.electronAPI.db.updateMeshcoreMessageStatus).toHaveBeenCalledWith(0x81, 'failed');
  });

  it('keeps accepting events for identity captured at attach when resolveIdentityId later returns null', () => {
    const h = makeHarness({ handleResponseResult: true });
    h.ctx.resolveIdentityId = () => ID;
    h.ctx.meshcoreIdentityIdRef.current = null;
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    h.ctx.resolveIdentityId = () => null;
    h.ctx.meshcoreIdentityIdRef.current = null;

    dispatch({
      type: 'meshcore_cli_response',
      payload: { text: 'A1|frozen', senderNodeId: 0x55, pubKeyPrefixHex: 'aabbcc' },
    });
    expect(h.handleResponse).toHaveBeenCalledWith('A1|frozen', 0x55);
  });

  it('prefers finalized meshcoreIdentityIdRef over pending attach identity', () => {
    const h = makeHarness({ handleResponseResult: true });
    h.ctx.resolveIdentityId = () => 'pending-driver-id';
    h.ctx.meshcoreIdentityIdRef.current = null;
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    h.ctx.meshcoreIdentityIdRef.current = ID;

    dispatch(
      {
        type: 'meshcore_cli_response',
        payload: { text: 'A1|final', senderNodeId: 1, pubKeyPrefixHex: 'aabbcc' },
      },
      ID,
    );
    expect(h.handleResponse).toHaveBeenCalledWith('A1|final', 1);

    h.handleResponse.mockClear();
    dispatch(
      {
        type: 'meshcore_cli_response',
        payload: { text: 'A1|stale-pending', senderNodeId: 1, pubKeyPrefixHex: 'aabbcc' },
      },
      'pending-driver-id',
    );
    expect(h.handleResponse).not.toHaveBeenCalled();
  });

  it('rate-limits MQTT packet-log publishes with a token bucket', () => {
    const h = makeHarness();
    h.ctx.mqttStatusRef.current = 'connected';
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    const publish = vi.mocked(window.electronAPI.mqtt.publishMeshcorePacketLog);

    for (let i = 0; i < 20; i += 1) {
      dispatch({
        type: 'meshcore_rf_rx',
        payload: { lastSnr: 1, lastRssi: -70, raw: Uint8Array.from([i, 0x22, 0x33, 0x44]) },
      });
    }

    expect(publish.mock.calls.length).toBeLessThan(20);
    expect(publish.mock.calls.length).toBeGreaterThan(0);
  });

  it.each(['ble', 'serial'] as const)(
    'silent drain prefers bulk getWaitingMessages on %s',
    async (connectionType) => {
      vi.useFakeTimers();
      const h = makeHarness();
      h.ctx.meshcoreConnectTypeRef.current = connectionType;
      vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([
        {
          channelMessage: {
            channelIdx: 0,
            text: 'BulkPeer: queued',
            senderTimestamp: 1_700_000_000,
          },
        },
      ]);
      detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

      dispatch({ type: 'meshcore_waiting_messages', payload: {} });
      await vi.advanceTimersByTimeAsync(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS + 50);
      await vi.runAllTimersAsync();

      expect(h.conn.getWaitingMessages).toHaveBeenCalled();
      expect(h.syncNextMessage).not.toHaveBeenCalled();
      expect(h.ctx.setWaitingMessagesSyncProgress).toHaveBeenCalledWith(
        expect.objectContaining({ processed: expect.any(Number), total: 1 }),
      );
      expect(h.ctx.addMessagesBatch).toHaveBeenCalled();
      expect(h.handleConnectionLost).not.toHaveBeenCalled();
    },
  );

  it('silent drain on tcp uses syncNextMessage without bulk getWaitingMessages', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.ctx.meshcoreConnectTypeRef.current = 'tcp';
    h.syncNextMessage
      .mockResolvedValueOnce({
        channelMessage: {
          channelIdx: 0,
          text: 'TcpPeer: queued',
          senderTimestamp: 1_700_000_000,
        },
      })
      .mockResolvedValueOnce(null);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({ type: 'meshcore_waiting_messages', payload: {} });
    await vi.advanceTimersByTimeAsync(MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS + 50);
    await vi.runAllTimersAsync();

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
    expect(h.ctx.addMessagesBatch).toHaveBeenCalled();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
  });

  it.each(['ble', 'serial'] as const)(
    'silent bulk timeout falls back to syncNextMessage on %s without disconnect',
    async (connectionType) => {
      vi.useFakeTimers();
      const h = makeHarness();
      h.ctx.meshcoreConnectTypeRef.current = connectionType;
      vi.mocked(h.conn.getWaitingMessages).mockImplementation(
        () => new Promise(() => undefined), // hang until withTimeout
      );
      h.syncNextMessage
        .mockResolvedValueOnce({
          channelMessage: {
            channelIdx: 0,
            text: 'FallbackPeer: one',
            senderTimestamp: 1_700_000_001,
          },
        })
        .mockResolvedValueOnce(null);
      detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

      const drainPromise = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
      await vi.advanceTimersByTimeAsync(MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS);
      await vi.runAllTimersAsync();
      await drainPromise;

      expect(h.conn.getWaitingMessages).toHaveBeenCalled();
      expect(h.syncNextMessage).toHaveBeenCalled();
      expect(h.handleConnectionLost).not.toHaveBeenCalled();
      expect(h.teardownConn).not.toHaveBeenCalled();
      expect(h.ctx.connRef.current).toBe(h.conn);
      expect(h.ctx.addMessagesBatch).toHaveBeenCalled();
    },
  );

  it('TCP silent drain starts syncNextMessage immediately without bulk timeout wait', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.ctx.meshcoreConnectTypeRef.current = 'tcp';
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(() => new Promise(() => undefined));
    h.syncNextMessage.mockResolvedValueOnce(null);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const drainPromise = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.runAllTimersAsync();
    await drainPromise;

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
  });

  it('skips silent bulk after consecutive timeouts and drains incrementally', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(
      () => new Promise(() => undefined), // hang until withTimeout
    );
    h.syncNextMessage.mockResolvedValue(null);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    for (let i = 0; i < MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP; i += 1) {
      const drainPromise = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
      await vi.advanceTimersByTimeAsync(MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS);
      await vi.runAllTimersAsync();
      await drainPromise;
    }
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(
      MESHCORE_WAITING_MESSAGES_SILENT_BULK_TIMEOUT_TRIP,
    );

    vi.mocked(h.conn.getWaitingMessages).mockClear();
    const skipped = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.runAllTimersAsync();
    await skipped;

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();

    vi.mocked(h.conn.getWaitingMessages).mockClear();
    vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([]);
    const retried = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.runAllTimersAsync();
    await retried;
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);
  });

  it('ignores late bulk resolve after timeout fallback has started', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    let resolveBulk: (value: unknown[]) => void = () => undefined;
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveBulk = resolve;
        }),
    );
    h.syncNextMessage.mockResolvedValue(null);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const drainPromise = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.advanceTimersByTimeAsync(45_000);
    await Promise.resolve();
    // Late bulk payload — must not be ingested (withTimeout already abandoned; attempt id bumped).
    resolveBulk([
      {
        channelMessage: {
          channelIdx: 0,
          text: 'LatePeer: should not ingest',
          senderTimestamp: 1_700_000_999,
        },
      },
    ]);
    await vi.runAllTimersAsync();
    await drainPromise;

    expect(h.syncNextMessage).toHaveBeenCalled();
    expect(h.ctx.addMessagesBatch).not.toHaveBeenCalled();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
  });

  it('does not flush silent bulk when unmounted during ingest await', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([
      {
        channelMessage: {
          channelIdx: 0,
          text: 'UnmountPeer: queued',
          senderTimestamp: 1_700_000_000,
        },
      },
    ]);
    vi.mocked(h.ctx.setWaitingMessagesSyncProgress).mockImplementation(() => {
      h.ctx.meshcoreHookMountedRef.current = false;
    });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.runAllTimersAsync();

    expect(h.ctx.addMessagesBatch).not.toHaveBeenCalled();
  });

  it('does not flush silent bulk when superseded during ingest await', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([
      {
        channelMessage: {
          channelIdx: 0,
          text: 'StalePeer: queued',
          senderTimestamp: 1_700_000_000,
        },
      },
    ]);
    vi.mocked(h.ctx.setWaitingMessagesSyncProgress).mockImplementation(() => {
      beginMeshcoreSilentBulkAttempt();
    });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await vi.runAllTimersAsync();

    expect(h.ctx.addMessagesBatch).not.toHaveBeenCalled();
  });

  it('does not fallback after silent bulk timeout when lifecycle reset superseded the attempt', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(
      () => new Promise(() => undefined), // hang until withTimeout
    );
    h.syncNextMessage.mockResolvedValue(null);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const drainPromise = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await Promise.resolve();
    resetMeshcoreWaitingMessagesDrainState(0);
    await vi.advanceTimersByTimeAsync(MESHCORE_WAITING_MESSAGES_SERIAL_SILENT_TIMEOUT_MS);
    await vi.runAllTimersAsync();
    await drainPromise;

    expect(h.syncNextMessage).not.toHaveBeenCalled();
    expect(h.ctx.addMessagesBatch).not.toHaveBeenCalled();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
  });

  it('does not fallback or disconnect when silent bulk hits transport-dead', async () => {
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockRejectedValue(
      new Error('meshcore:tcp-write: no active socket'),
    );
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });

    expect(h.syncNextMessage).not.toHaveBeenCalled();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
    expect(h.teardownConn).not.toHaveBeenCalled();
  });

  it('manual Sync now still uses bulk getWaitingMessages with banner progress', async () => {
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([
      {
        channelMessage: {
          channelIdx: 0,
          text: 'ManualPeer: queued',
          senderTimestamp: 1_700_000_000,
        },
      },
    ]);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: true });

    expect(h.conn.getWaitingMessages).toHaveBeenCalled();
    expect(h.syncNextMessage).not.toHaveBeenCalled();
    expect(h.ctx.setWaitingMessagesSyncActive).toHaveBeenCalledWith(true);
    expect(h.ctx.setWaitingMessagesSyncProgress).toHaveBeenCalledWith(
      expect.objectContaining({ total: 1 }),
    );
  });

  it('skips a second silent drain while one is in flight', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    let releaseBulk: () => void = () => undefined;
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBulk = () => {
            resolve([]);
          };
        }),
    );
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const first = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await Promise.resolve();
    const second = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);
    releaseBulk();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
  });

  it('force drain runs while CLI reply hold would defer silent drain', async () => {
    const holdSpy = vi
      .spyOn(meshcoreRepeaterRpcInFlight, 'meshcoreCliReplyHoldActive')
      .mockReturnValue(true);
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({
      showSyncBanner: false,
      force: true,
      incrementalOnly: true,
    });

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
    holdSpy.mockRestore();
  });

  it('non-force silent drain still defers during CLI reply hold', async () => {
    vi.useFakeTimers();
    const holdSpy = vi
      .spyOn(meshcoreRepeaterRpcInFlight, 'meshcoreCliReplyHoldActive')
      .mockReturnValue(true);
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const pending = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await Promise.resolve();
    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).not.toHaveBeenCalled();

    holdSpy.mockReturnValue(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);
    holdSpy.mockRestore();
  });

  it('incrementalOnly skips bulk getWaitingMessages', async () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({
      showSyncBanner: false,
      force: true,
      incrementalOnly: true,
    });

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
  });

  it('TCP silent auto-drain skips bulk getWaitingMessages', async () => {
    const h = makeHarness();
    h.ctx.meshcoreConnectTypeRef.current = 'tcp';
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false, force: true });

    expect(h.conn.getWaitingMessages).not.toHaveBeenCalled();
    expect(h.syncNextMessage).toHaveBeenCalled();
  });

  it('force follow-up after in-flight drain starts another force incremental drain', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    let releaseBulk: () => void = () => undefined;
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBulk = () => {
            resolve([]);
          };
        }),
    );
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    const first = h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: false });
    await Promise.resolve();
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);

    void h.ctx.processWaitingMessagesRef.current?.({
      showSyncBanner: false,
      force: true,
      incrementalOnly: true,
    });
    // Still coalesced onto the in-flight bulk (no second getWaitingMessages yet).
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);

    releaseBulk();
    await first;
    await vi.runAllTimersAsync();
    // Follow-up force drain uses incrementalOnly — syncNext, not a second bulk.
    expect(h.syncNextMessage).toHaveBeenCalled();
    expect(h.conn.getWaitingMessages).toHaveBeenCalledTimes(1);
  });

  it('flushes waiting-message node changes to nodeStore without updating the runtime node mirror', async () => {
    const h = makeHarness();
    vi.mocked(h.conn.getWaitingMessages).mockResolvedValue([
      {
        channelMessage: {
          channelIdx: 0,
          text: 'QueuePeer: queued channel message',
          senderTimestamp: 1_700_000_000,
        },
      },
    ]);
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: true });

    const records = useNodeStore.getState().nodes[ID];
    const node = Object.values(records ?? {})[0];
    expect(node).toMatchObject({ lastHeardAt: 1_700_000_000, source: 'rf' });
    expect(h.ctx.addMessagesBatch).toHaveBeenCalledTimes(1);
  });

  it('preserves concurrent RF snr/rssi when flushing waiting-drain last_heard', async () => {
    const prefix = new Uint8Array([0xaa, 0xbb]);
    useNodeStore.setState({
      nodes: {
        [ID]: {
          42: {
            nodeId: 42,
            longName: 'Peer',
            shortName: 'P',
            snr: 5,
            rssi: -80,
            lastHeardAt: 100,
            source: 'rf',
          },
        },
      },
    });
    const h = makeHarness();
    h.ctx.pubKeyPrefixMapRef.current.set('aabb', 42);
    vi.mocked(h.conn.getWaitingMessages).mockImplementation(() => {
      // Concurrent RF RX while the drain still holds the start-of-drain workingNodes snapshot.
      useNodeStore.setState((s) => ({
        nodes: {
          ...s.nodes,
          [ID]: {
            ...s.nodes[ID],
            42: { ...s.nodes[ID]?.[42], nodeId: 42, snr: 9, rssi: -40 },
          },
        },
      }));
      return Promise.resolve([
        {
          contactMessage: {
            pubKeyPrefix: prefix,
            text: 'hello from queue',
            senderTimestamp: 1_700_000_100,
          },
        },
      ]);
    });
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    await h.ctx.processWaitingMessagesRef.current?.({ showSyncBanner: true });

    expect(useNodeStore.getState().nodes[ID]?.[42]).toMatchObject({
      snr: 9,
      rssi: -40,
      lastHeardAt: 1_700_000_100,
    });
  });

  it('tears down the session and requests reconnect on disconnect', async () => {
    const h = makeHarness();
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({ type: 'device_status', payload: { status: 'disconnected' } });

    expect(h.state.status).toBe('disconnected');
    expect(h.teardownConn).toHaveBeenCalledWith({ driverDisconnect: true });
    expect(h.ctx.connRef.current).toBeNull();
    await Promise.resolve();
    expect(h.handleConnectionLost).toHaveBeenCalled();
  });

  it('ignores TCP device_status disconnect (runtime owns TCP bridge + reconnect)', async () => {
    const h = makeHarness();
    h.ctx.meshcoreConnectTypeRef.current = 'tcp';
    detach = attachMeshcoreConnSideEffects(h.conn, h.ctx);

    dispatch({ type: 'device_status', payload: { status: 'disconnected' } });

    // OpenHop FIN must not strip the ConnectionDriver handle — write-dead / tcp.onDisconnected
    // own recovery after "accepting dead bridge".
    expect(h.state.status).toBe('configured');
    expect(h.teardownConn).not.toHaveBeenCalled();
    expect(h.ctx.connRef.current).toBe(h.conn);
    await Promise.resolve();
    expect(h.handleConnectionLost).not.toHaveBeenCalled();
  });

  it('stops handling events after detach', () => {
    const h = makeHarness({ handleResponseResult: true });
    const stop = attachMeshcoreConnSideEffects(h.conn, h.ctx);
    stop();

    dispatch({
      type: 'meshcore_cli_response',
      payload: { text: 'after detach', senderNodeId: 5, pubKeyPrefixHex: 'aabbcc' },
    });

    expect(h.handleResponse).not.toHaveBeenCalled();
    expect(h.ctx.processWaitingMessagesRef.current).toBeNull();
  });
});
