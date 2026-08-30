import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setConnection, useConnectionStore } from '../stores/connectionStore';
import {
  addIdentity,
  addTransport,
  setActiveIdentity,
  useIdentityStore,
} from '../stores/identityStore';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { lastReadStorageKey } from './chatPanelProtocolStorage';
import {
  analyzeDebugSnapshot,
  buildDebugSnapshot,
  buildDebugSnapshotAsync,
  copyDebugSnapshotToClipboard,
  DEBUG_SNAPSHOT_ID_LEGEND,
  type DebugReticulumSnapshot,
  type DebugSnapshot,
} from './debugSnapshot';
import {
  resetDebugSnapshotMeshtasticContext,
  setDebugSnapshotMeshtasticContext,
} from './debugSnapshotMeshtasticContext';
import {
  getDebugSnapshotUiContext,
  resetDebugSnapshotUiContext,
  setDebugSnapshotUiContext,
} from './debugSnapshotUiContext';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
  OFFLINE_RETICULUM_IDENTITY_ID,
} from './offlineProtocolIdentities';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

function makeBucketOverrides(
  overrides: Partial<DebugSnapshot['meshcore']>,
): DebugSnapshot['meshcore'] {
  return {
    hydrationSlotId: OFFLINE_MESHCORE_IDENTITY_ID,
    connectIdentityId: OFFLINE_MESHCORE_IDENTITY_ID,
    uiStoreIdentityId: OFFLINE_MESHCORE_IDENTITY_ID,
    identitySplit: false,
    identityCount: 1,
    primaryTransportStatuses: [],
    sessionState: 'empty',
    liveSession: false,
    rfTransportConnected: false,
    mqttConnected: false,
    hydrationSlotIsLiveSession: false,
    hydrationSlotMessageCount: 0,
    connectMessageCount: 0,
    uiStoreMessageCount: 0,
    hydrationSlotNodeCount: 0,
    connectNodeCount: 0,
    uiStoreNodeCount: 0,
    hydrationSlotNewestMessageTs: null,
    connectNewestMessageTs: null,
    uiStoreNewestMessageTs: null,
    lastReadWatermarkCount: 0,
    lastReadByViewKey: {},
    lastReadSanitizedFlag: null,
    channelLastReadTriage: [],
    connection: null,
    ...overrides,
  };
}

function makeMeshtasticBucketOverrides(
  overrides: Partial<DebugSnapshot['meshtastic']> = {},
): DebugSnapshot['meshtastic'] {
  return {
    ...makeBucketOverrides({
      hydrationSlotId: OFFLINE_MESHTASTIC_IDENTITY_ID,
      connectIdentityId: OFFLINE_MESHTASTIC_IDENTITY_ID,
      uiStoreIdentityId: OFFLINE_MESHTASTIC_IDENTITY_ID,
      ...overrides,
    }),
    channelPills: overrides.channelPills ?? [],
    channelConfigsSummary: overrides.channelConfigsSummary ?? [],
    mqttChannelKeyEntryCount: overrides.mqttChannelKeyEntryCount ?? null,
    mqttChannelNameToIndex: overrides.mqttChannelNameToIndex ?? null,
  };
}

function makeReticulumSnapshot(
  overrides: Partial<DebugReticulumSnapshot> = {},
): DebugReticulumSnapshot {
  const bucket = makeBucketOverrides({
    hydrationSlotId: OFFLINE_RETICULUM_IDENTITY_ID,
    connectIdentityId: OFFLINE_RETICULUM_IDENTITY_ID,
    uiStoreIdentityId: OFFLINE_RETICULUM_IDENTITY_ID,
    ...(overrides.bucket ?? {}),
  });
  return {
    bucket,
    sidecar: { running: false, port: 0, pid: null },
    stack: null,
    diagnosticRows: [],
    fetchErrors: {},
    ...overrides,
  };
}

function makeSyntheticSnapshot(overrides: Partial<DebugSnapshot> = {}): DebugSnapshot {
  const ui = {
    activePanelIndex: 0,
    chatTabVisited: false,
    chatPanelFrozen: false,
    frozenMessageCount: null,
    liveResolvedMessageCount: 0,
    activeProtocol: 'meshcore' as const,
    waitingMessagesSilentDrainActive: false,
    waitingMessagesDrainDeferred: false,
    ...overrides.ui,
  };
  const meshcore = makeBucketOverrides(overrides.meshcore ?? {});
  const meshtastic = makeMeshtasticBucketOverrides(overrides.meshtastic ?? {});
  const reticulum = makeReticulumSnapshot(overrides.reticulum ?? {});
  const base: Omit<DebugSnapshot, 'warnings'> = {
    capturedAt: '2026-06-19T16:00:00.000Z',
    legend: DEBUG_SNAPSHOT_ID_LEGEND,
    sessionSummary: {
      meshtastic: {
        sessionState: meshtastic.sessionState,
        liveSession: meshtastic.liveSession,
        rfTransportConnected: meshtastic.rfTransportConnected,
        mqttConnected: meshtastic.mqttConnected,
        uiStoreIdentityId: meshtastic.uiStoreIdentityId,
      },
      meshcore: {
        sessionState: meshcore.sessionState,
        liveSession: meshcore.liveSession,
        rfTransportConnected: meshcore.rfTransportConnected,
        mqttConnected: meshcore.mqttConnected,
        uiStoreIdentityId: meshcore.uiStoreIdentityId,
      },
      reticulum: {
        sessionState: reticulum.bucket.sessionState,
        liveSession: reticulum.bucket.liveSession,
        rfTransportConnected: reticulum.bucket.rfTransportConnected,
        mqttConnected: reticulum.bucket.mqttConnected,
        uiStoreIdentityId: reticulum.bucket.uiStoreIdentityId,
      },
    },
    activeTab: {
      protocol: 'meshcore',
      uiStoreIdentityId: meshcore.uiStoreIdentityId,
      sessionState: meshcore.sessionState,
      liveSession: meshcore.liveSession,
      ...overrides.activeTab,
    },
    storedProtocol: 'meshcore',
    windowHidden: false,
    ui,
    meshtastic,
    meshcore,
    reticulum,
    ...overrides,
  };
  return { ...base, warnings: analyzeDebugSnapshot(base) };
}

describe('buildDebugSnapshot', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {} });
    useConnectionStore.setState({ connections: {} });
    resetDebugSnapshotUiContext();
    resetDebugSnapshotMeshtasticContext();
    localStorage.clear();
  });

  it('matches idle disconnected baseline shape', () => {
    ensureOfflineProtocolIdentities();
    upsertMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'mt-1',
      from: 1,
      to: 0,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 1,
    });
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'mc-1',
      from: 2,
      to: 0,
      payload: 'hey',
      channelIndex: 30,
      timestamp: 2,
    });

    const snap = buildDebugSnapshot();

    expect(snap.legend).toBe(DEBUG_SNAPSHOT_ID_LEGEND);
    expect(snap.activeTab.uiStoreIdentityId).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
    expect(snap.activeTab.liveSession).toBe(false);
    expect(snap.meshtastic.connectIdentityId).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
    expect(snap.meshtastic.uiStoreIdentityId).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
    expect(snap.meshtastic.identitySplit).toBe(false);
    expect(snap.meshtastic.primaryTransportStatuses).toEqual([]);
    expect(snap.meshtastic.sessionState).toBe('hydratedOnly');
    expect(snap.meshtastic.liveSession).toBe(false);
    expect(snap.meshtastic.hydrationSlotIsLiveSession).toBe(false);
    expect(snap.meshtastic.hydrationSlotMessageCount).toBe(snap.meshtastic.connectMessageCount);
    expect(snap.meshcore.hydrationSlotMessageCount).toBe(snap.meshcore.connectMessageCount);
    expect(snap.reticulum.bucket.hydrationSlotId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(snap.reticulum.sidecar.running).toBe(false);
    expect(snap.reticulum.stack).toBeNull();
    expect(snap.meshtastic.channelPills).toEqual([]);
    expect(snap.meshtastic.channelConfigsSummary).toEqual([]);
    expect(snap.meshtastic.mqttChannelKeyEntryCount).toBeNull();
    expect(snap.meshtastic.mqttChannelNameToIndex).toBeNull();
    expect(snap.warnings).toEqual([]);
  });

  it('includes Meshtastic channel pills and config summary from debug context', () => {
    ensureOfflineProtocolIdentities();
    setDebugSnapshotMeshtasticContext({
      channelPills: [
        { index: 0, name: 'Private' },
        { index: 1, name: 'LongFast' },
      ],
      channelConfigsSummary: [
        {
          index: 0,
          name: 'Private',
          role: 1,
          uplinkEnabled: false,
          isDefaultPublicPsk: false,
        },
        {
          index: 1,
          name: '',
          role: 2,
          uplinkEnabled: true,
          isDefaultPublicPsk: true,
        },
      ],
      mqttChannelKeyEntryCount: 2,
      mqttChannelNameToIndex: { LongFast: 1, Private: 0 },
    });

    const snap = buildDebugSnapshot();

    expect(snap.meshtastic.channelPills).toEqual([
      { index: 0, name: 'Private' },
      { index: 1, name: 'LongFast' },
    ]);
    expect(snap.meshtastic.channelConfigsSummary).toHaveLength(2);
    expect(snap.meshtastic.channelConfigsSummary[1]?.isDefaultPublicPsk).toBe(true);
    expect(snap.meshtastic.mqttChannelKeyEntryCount).toBe(2);
    expect(snap.meshtastic.mqttChannelNameToIndex).toEqual({ LongFast: 1, Private: 0 });
  });

  it('uses activeProtocol from ui context for activeTab including reticulum', () => {
    ensureOfflineProtocolIdentities();
    setDebugSnapshotUiContext({ activeProtocol: 'reticulum' });

    const snap = buildDebugSnapshot();

    expect(snap.activeTab.protocol).toBe('reticulum');
    expect(snap.activeTab.uiStoreIdentityId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(snap.sessionSummary.reticulum.uiStoreIdentityId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
  });

  it('includes resolved and primary identity bucket counts when connected', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-debug';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:debug',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'debug-ble' },
        },
      ],
      createdAt: 10,
      lastSeenAt: 10,
    });
    setActiveIdentity(connectedId);
    upsertMessage(connectedId, {
      id: 'snap-1',
      from: 1,
      to: 0,
      payload: 'test',
      channelIndex: 30,
      timestamp: 1_700_000_000_000,
    });

    const snap = buildDebugSnapshot();
    expect(snap.meshcore.connectIdentityId).toBe(connectedId);
    expect(snap.meshcore.uiStoreIdentityId).toBe(connectedId);
    expect(snap.meshcore.identitySplit).toBe(false);
    expect(snap.meshcore.connectMessageCount).toBe(1);
    expect(snap.meshcore.connectNewestMessageTs).toBe(1_700_000_000_000);
    expect(snap.meshcore.sessionState).toBe('live');
    expect(snap.meshcore.liveSession).toBe(true);
    expect(snap.warnings.some((w) => w.code === 'identitySplit')).toBe(false);
  });

  it('reports live session when hydration slot id is reused on connect', () => {
    ensureOfflineProtocolIdentities();
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshcore');
    setDebugSnapshotUiContext({ activeProtocol: 'meshcore' });
    addTransport(OFFLINE_MESHCORE_IDENTITY_ID, {
      transportId: 't1',
      type: 'ble',
      status: 'connected',
      params: { type: 'ble', peripheralId: 'ble-hydration-slot' },
    });
    setActiveIdentity(OFFLINE_MESHCORE_IDENTITY_ID);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      connectionType: 'ble',
      mqttStatus: 'connected',
      myNodeNum: 1429514792,
    });
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'live-msg',
      from: 1,
      to: 0,
      payload: 'live',
      channelIndex: 30,
      timestamp: 2_000,
    });

    const snap = buildDebugSnapshot();

    expect(snap.activeTab.uiStoreIdentityId).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(snap.activeTab.liveSession).toBe(true);
    expect(snap.sessionSummary.meshcore.liveSession).toBe(true);
    expect(snap.meshcore.sessionState).toBe('live');
    expect(snap.meshcore.liveSession).toBe(true);
    expect(snap.meshcore.hydrationSlotIsLiveSession).toBe(true);
    expect(snap.meshcore.rfTransportConnected).toBe(true);
    expect(snap.meshcore.mqttConnected).toBe(true);
    expect(snap.warnings).toEqual([]);
  });

  it('keeps connected primary when offline bucket has stale hydration', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-connected-live';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:live',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'ble-live' },
        },
      ],
      createdAt: 50,
      lastSeenAt: 50,
    });
    setActiveIdentity(connectedId);
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'offline-stale',
      from: 1,
      to: 0,
      payload: 'old',
      channelIndex: 30,
      timestamp: 1_000,
    });
    upsertMessage(connectedId, {
      id: 'live-1',
      from: 2,
      to: 0,
      payload: 'new',
      channelIndex: 30,
      timestamp: 2_000,
    });

    const snap = buildDebugSnapshot();
    expect(snap.meshcore.uiStoreIdentityId).toBe(connectedId);
    expect(snap.meshcore.identitySplit).toBe(false);
    expect(snap.warnings).toEqual([]);
  });

  it('populates connection fields for resolved identity', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-conn';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:conn',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setActiveIdentity(connectedId);
    setConnection(connectedId, {
      status: 'configured',
      connectionType: 'ble',
      mqttStatus: 'connected',
      myNodeNum: 42,
      connectionLoss: false,
    });

    const snap = buildDebugSnapshot();
    expect(snap.meshcore.connection).toEqual({
      status: 'configured',
      mqttStatus: 'connected',
      connectionType: 'ble',
      myNodeNum: 42,
      connectionLoss: false,
    });
    expect(snap.meshcore.sessionState).toBe('live');
    expect(snap.meshcore.mqttConnected).toBe(true);
  });

  it('includes ui context and lastRead watermark counts', () => {
    ensureOfflineProtocolIdentities();
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshcore');
    localStorage.setItem(
      lastReadStorageKey('meshcore'),
      JSON.stringify({ 'ch:0': 100, 'dm:1': 200 }),
    );
    setDebugSnapshotUiContext({
      activePanelIndex: 3,
      chatTabVisited: true,
      chatPanelFrozen: true,
      frozenMessageCount: 10,
      liveResolvedMessageCount: 25,
      activeProtocol: 'meshcore',
    });

    const snap = buildDebugSnapshot();
    expect(snap.storedProtocol).toBe('meshcore');
    expect(snap.ui).toEqual(getDebugSnapshotUiContext());
    expect(snap.meshcore.lastReadWatermarkCount).toBe(2);
    expect(snap.meshcore.lastReadByViewKey).toEqual({ 'ch:0': 100, 'dm:1': 200 });
  });

  it('includes channel last-read triage and flags suppressed unread on poisoned watermark', () => {
    ensureOfflineProtocolIdentities();
    vi.useFakeTimers();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshcore');
    const botTs = nowMs - 120_000;
    localStorage.setItem(lastReadStorageKey('meshcore'), JSON.stringify({ 'ch:4': nowMs }));
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      mqttStatus: 'disconnected',
      connectionType: 'ble',
      myNodeNum: 279817148,
      connectionLoss: false,
    });
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'mc-bot-1',
      from: 2706664648,
      senderName: 'RunrBot',
      payload: 'path update',
      channelIndex: 4,
      timestamp: botTs,
      to: 0,
      status: 'acked',
    });

    const snap = buildDebugSnapshot();
    const ch4 = snap.meshcore.channelLastReadTriage.find((r) => r.channelIndex === 4);
    expect(ch4?.lastReadWatermark).toBe(nowMs);
    expect(ch4?.watermarkAheadOfNewestInboundMs).toBeGreaterThan(0);
    expect(ch4?.unreadEstimate).toBe(0);
    expect(snap.warnings.some((w) => w.code === 'lastReadSuppressesChannelUnread')).toBe(true);
    vi.useRealTimers();
  });
});

describe('analyzeDebugSnapshot', () => {
  it('flags identitySplit and staleResolvedBucket for old bad shape', () => {
    const connectedId = 'id-mc-split';
    const snap = makeSyntheticSnapshot({
      meshcore: makeBucketOverrides({
        hydrationSlotId: OFFLINE_MESHCORE_IDENTITY_ID,
        connectIdentityId: connectedId,
        uiStoreIdentityId: OFFLINE_MESHCORE_IDENTITY_ID,
        identitySplit: true,
        primaryTransportStatuses: ['connected'],
        hydrationSlotMessageCount: 512,
        connectMessageCount: 3,
        hydrationSlotNewestMessageTs: 1_000,
        connectNewestMessageTs: 2_000,
      }),
    });

    expect(snap.warnings.map((w) => w.code)).toContain('identitySplit');
    expect(snap.warnings.map((w) => w.code)).toContain('staleResolvedBucket');
  });

  it('includes meshcore drain congestion fields from ui context', () => {
    setDebugSnapshotUiContext({
      meshcoreDrain: {
        meshcoreCompanionRepeaterRfBusy: true,
        meshcoreCliReplyHoldCount: 1,
        meshcoreAdminRpcInFlightCount: 2,
        meshcoreTraceRpcInFlightCount: 0,
        meshcoreTraceResponsesInFlightCount: 0,
        meshcoreSilentBulkSkipped: true,
        meshcoreSilentBulkTimeoutStreak: 2,
      },
    });
    expect(getDebugSnapshotUiContext().meshcoreDrain).toMatchObject({
      meshcoreCompanionRepeaterRfBusy: true,
      meshcoreSilentBulkSkipped: true,
      meshcoreSilentBulkTimeoutStreak: 2,
    });
  });

  it('flags chatPanelFrozen when frozen count lags live store', () => {
    const snap = makeSyntheticSnapshot({
      ui: {
        activePanelIndex: 2,
        chatTabVisited: true,
        chatPanelFrozen: true,
        frozenMessageCount: 10,
        liveResolvedMessageCount: 25,
        activeProtocol: 'meshcore',
        waitingMessagesSilentDrainActive: false,
        waitingMessagesDrainDeferred: false,
      },
    });

    expect(snap.warnings.some((w) => w.code === 'chatPanelFrozen')).toBe(true);
  });

  it('flags connectedNoPrimaryMessages when primary store is empty', () => {
    const connectedId = 'id-mc-empty-primary';
    const snap = makeSyntheticSnapshot({
      meshcore: makeBucketOverrides({
        connectIdentityId: connectedId,
        uiStoreIdentityId: connectedId,
        primaryTransportStatuses: ['connected'],
        connectMessageCount: 0,
        hydrationSlotMessageCount: 100,
      }),
    });

    expect(snap.warnings.some((w) => w.code === 'connectedNoPrimaryMessages')).toBe(true);
  });

  it('flags sidecarNotRunning when identity is configured but sidecar is down', () => {
    const snap = makeSyntheticSnapshot({
      reticulum: makeReticulumSnapshot({
        sidecar: { running: false, port: 0, pid: null, lastError: 'health poll timeout' },
        stack: {
          identityStatus: { configured: true, identity_hash: 'aa', lxmf_hash: 'bb' },
        },
      }),
    });

    expect(snap.warnings.some((w) => w.code === 'sidecarNotRunning')).toBe(true);
  });

  it('flags windowHiddenOnChat', () => {
    const snap = makeSyntheticSnapshot({
      windowHidden: true,
      ui: {
        activePanelIndex: 1,
        chatTabVisited: true,
        chatPanelFrozen: false,
        frozenMessageCount: null,
        liveResolvedMessageCount: 0,
        activeProtocol: 'meshtastic',
        waitingMessagesSilentDrainActive: false,
        waitingMessagesDrainDeferred: false,
      },
    });

    expect(snap.warnings.some((w) => w.code === 'windowHiddenOnChat')).toBe(true);
  });
});

describe('buildDebugSnapshotAsync', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    resetDebugSnapshotUiContext();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockReset();
  });

  it('includes live sidecar stack payload when running', async () => {
    ensureOfflineProtocolIdentities();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 7,
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue({
      status: 'ok',
      rns_ready: true,
      lxmf_ready: false,
    });

    const snap = await buildDebugSnapshotAsync();

    expect(snap.reticulum.sidecar.running).toBe(true);
    expect(snap.reticulum.stack?.status).toMatchObject({ rns_ready: true });
  });

  it('includes mainLiveness from getRendererLiveness', async () => {
    ensureOfflineProtocolIdentities();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: false,
      port: 0,
      pid: null,
    });
    vi.mocked(window.electronAPI.app.getRendererLiveness).mockResolvedValue({
      mainUptimeSec: 3600,
      lastRendererHeartbeatAgeMs: 12_000,
      rendererUnresponsiveSeen: true,
      rss: 100,
      heapUsed: 50,
    });

    const snap = await buildDebugSnapshotAsync();

    expect(snap.mainLiveness).toEqual({
      mainUptimeSec: 3600,
      lastRendererHeartbeatAgeMs: 12_000,
      rendererUnresponsiveSeen: true,
      rss: 100,
      heapUsed: 50,
    });
  });
});

describe('copyDebugSnapshotToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses electronAPI.clipboard.writeText instead of navigator.clipboard', async () => {
    ensureOfflineProtocolIdentities();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', {
      ...window.electronAPI,
      clipboard: { writeText },
    });
    const navigatorWrite = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: navigatorWrite },
      writable: true,
      configurable: true,
    });

    const copied = await copyDebugSnapshotToClipboard();

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(navigatorWrite).not.toHaveBeenCalled();
    const parsed = JSON.parse(String(writeText.mock.calls[0]?.[0])) as DebugSnapshot;
    expect(parsed.warnings).toBeDefined();
    expect(parsed.ui).toBeDefined();
  });
});
