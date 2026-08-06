import type { RendererLivenessSnapshot } from '@/shared/electron-api.types';

import { isMeshcoreRoomChatMessage } from '../hooks/meshcore/meshcoreHookPreamble';
import type { ConnectionStatus } from '../stores/connectionStore';
import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  getSanitizedMeshcoreChatLastRead,
  getSanitizedMeshcoreRoomsLastRead,
  lastReadStorageKey,
  loadPersistedLastReadInitial,
  loadPersistedRoomsLastRead,
} from './chatPanelProtocolStorage';
import { computeChannelUnreadCounts, filterRegularChatMessages } from './chatUnreadCounts';
import {
  type DebugSnapshotMeshtasticChannelConfigSummary,
  type DebugSnapshotMeshtasticChannelPill,
  getDebugSnapshotMeshtasticContext,
  setDebugSnapshotMeshtasticContext,
} from './debugSnapshotMeshtasticContext';
import { getDebugSnapshotUiContext } from './debugSnapshotUiContext';
import { errLikeToLogString } from './errLikeToLogString';
import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from './identityByProtocol';
import {
  fetchMeshcoreContactPathDiagnostics,
  type MeshcoreContactPathDiagnosticRow,
} from './meshcoreContactPathDiagnostics';
import { meshcoreRoomServerIdsFromNodes } from './meshcoreDbCacheHydration';
import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
import { totalRoomsUnreadCount } from './meshcoreRoomsUnread';
import { effectiveMessageTimestampMs, isUnreasonablyFutureMessageTimestampMs } from './nodeStatus';
import { getOfflineIdentityIdForProtocol } from './offlineProtocolIdentities';
import { parseStoredJson } from './parseStoredJson';
import { getProtocolRegistration } from './protocols/protocolRegistry';
import {
  buildReticulumDiagnosticSnapshotSync,
  fetchReticulumDiagnosticSnapshot,
  type ReticulumDiagnosticSidecarSnapshot,
} from './reticulum/reticulumDiagnosticSnapshot';
import { getStoredMeshProtocol } from './storedMeshProtocol';
import { messageRecordsToChatMessages, nodeRecordToMeshNode } from './storeRecordAdapters';
import type { ChatMessage, IdentityId, MeshProtocol, MQTTStatus } from './types';
import { writeClipboardText } from './writeClipboardText';

export const DEBUG_SNAPSHOT_ID_LEGEND =
  'Ids prefixed offline-* are internal store keys for the pre-connect hydration slot. When sessionSummary.liveSession is true, the device is connected even if ids contain offline-.';

export interface DebugConnectionSnapshot {
  status: ConnectionStatus;
  mqttStatus: MQTTStatus;
  connectionType: string | null;
  myNodeNum: number;
  connectionLoss: boolean;
}

/** Whether the protocol has a live RF/MQTT session vs DB-hydrated-only store. */
export type DebugSessionState = 'live' | 'hydratedOnly' | 'empty';

export interface DebugSessionSummary {
  sessionState: DebugSessionState;
  liveSession: boolean;
  rfTransportConnected: boolean;
  mqttConnected: boolean;
  uiStoreIdentityId: IdentityId | null;
}

export interface DebugActiveTabSummary {
  protocol: MeshProtocol;
  uiStoreIdentityId: IdentityId | null;
  sessionState: DebugSessionState;
  liveSession: boolean;
}

export interface DebugIdentityBucketSnapshot {
  /** Internal pre-connect bucket id; often reused as the live session store key. */
  hydrationSlotId: IdentityId;
  /** Connected identity before offline fallback (may equal hydrationSlotId). */
  connectIdentityId: IdentityId | null;
  /** Identity bucket Chat / UI reads from. */
  uiStoreIdentityId: IdentityId | null;
  identitySplit: boolean;
  identityCount: number;
  primaryTransportStatuses: string[];
  sessionState: DebugSessionState;
  liveSession: boolean;
  rfTransportConnected: boolean;
  mqttConnected: boolean;
  /** True when live session uses the hydration slot id (connect === hydration); not disconnected. */
  hydrationSlotIsLiveSession: boolean;
  hydrationSlotMessageCount: number;
  connectMessageCount: number;
  uiStoreMessageCount: number;
  hydrationSlotNodeCount: number;
  connectNodeCount: number;
  uiStoreNodeCount: number;
  hydrationSlotNewestMessageTs: number | null;
  connectNewestMessageTs: number | null;
  uiStoreNewestMessageTs: number | null;
  lastReadWatermarkCount: number;
  /** Raw last-read map from localStorage (for badge triage; compare viewKey watermarks to newest inbound). */
  lastReadByViewKey: Record<string, number>;
  /** MeshCore one-time sanitize flag (`mesh-client:lastReadSanitized:meshcore`). */
  lastReadSanitizedFlag: string | null;
  /** Per-channel unread triage: watermark vs newest non-self inbound (top channels by volume). */
  channelLastReadTriage: DebugChannelLastReadTriageRow[];
  connection: DebugConnectionSnapshot | null;
  /** MeshCore Rooms badge triage (only populated for the meshcore bucket). */
  roomNodeCount?: number;
  roomMessageCount?: number;
  roomsUnreadEstimate?: number;
  orphanRoomMessageCount?: number;
  roomsLastReadKeyCount?: number;
}

/** Meshtastic bucket adds channel layout for inbound/outbound channel triage (no PSK). */
export interface DebugMeshtasticBucketSnapshot extends DebugIdentityBucketSnapshot {
  channelPills: DebugSnapshotMeshtasticChannelPill[];
  channelConfigsSummary: DebugSnapshotMeshtasticChannelConfigSummary[];
  mqttChannelKeyEntryCount: number | null;
  /** Main MQTTManager topic→slot map (no PSKs). */
  mqttChannelNameToIndex: Record<string, number> | null;
}

export interface DebugChannelLastReadTriageRow {
  viewKey: string;
  channelIndex: number;
  /** Raw value from `mesh-client:lastRead:protocol` localStorage. */
  lastReadWatermark: number;
  /** Sanitized watermark used for unread badge math (MeshCore only). */
  lastReadWatermarkEffective: number;
  newestInboundEffectiveTs: number | null;
  watermarkAheadOfNewestInboundMs: number | null;
  unreadEstimate: number;
  hasFuturePoisonInbound: boolean;
}

export type DebugSnapshotWarningCode =
  | 'identitySplit'
  | 'staleResolvedBucket'
  | 'chatPanelFrozen'
  | 'connectedNoPrimaryMessages'
  | 'windowHiddenOnChat'
  | 'lastReadSuppressesChannelUnread'
  | 'sidecarNotRunning';

export interface DebugReticulumSnapshot extends ReticulumDiagnosticSidecarSnapshot {
  bucket: DebugIdentityBucketSnapshot;
}

export interface DebugSnapshotWarning {
  code: DebugSnapshotWarningCode;
  protocol?: MeshProtocol;
  detail: string;
}

export interface DebugSnapshot {
  capturedAt: string;
  legend: string;
  sessionSummary: {
    meshtastic: DebugSessionSummary;
    meshcore: DebugSessionSummary;
    reticulum: DebugSessionSummary;
  };
  activeTab: DebugActiveTabSummary;
  storedProtocol: MeshProtocol;
  windowHidden: boolean;
  ui: ReturnType<typeof getDebugSnapshotUiContext>;
  meshtastic: DebugMeshtasticBucketSnapshot;
  meshcore: DebugIdentityBucketSnapshot;
  reticulum: DebugReticulumSnapshot;
  /** Main-process uptime / heartbeat age (export path only). */
  mainLiveness?: RendererLivenessSnapshot | null;
  /** MeshCore SQLite contact hops + best path history bytes (redacted pubkeys). */
  meshcoreContactPathDiagnostics?: MeshcoreContactPathDiagnosticRow[];
  warnings: DebugSnapshotWarning[];
}

function newestMessageTimestamp(identityId: IdentityId | null): number | null {
  if (!identityId) return null;
  const bucket = useMessageStore.getState().messages[identityId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!bucket) return null;
  let max = 0;
  for (const row of Object.values(bucket)) {
    if (row.timestamp > max) max = row.timestamp;
  }
  return max > 0 ? max : null;
}

function loadLastReadByViewKey(protocol: MeshProtocol): Record<string, number> {
  return loadPersistedLastReadInitial(protocol);
}

function loadLastReadSanitizedFlag(protocol: MeshProtocol): string | null {
  if (protocol !== 'meshcore') return null;
  return localStorage.getItem('mesh-client:lastReadSanitized:meshcore');
}

function listChatMessagesForIdentity(identityId: IdentityId | null): ChatMessage[] {
  if (!identityId) return [];
  const bucket = useMessageStore.getState().messages[identityId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!bucket) return [];
  return messageRecordsToChatMessages(Object.values(bucket));
}

function buildChannelLastReadTriage(
  protocol: MeshProtocol,
  identityId: IdentityId | null,
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeId: number,
): DebugChannelLastReadTriageRow[] {
  const nowMs = Date.now();
  const ownNodeIds = ownNodeId > 0 ? new Set([ownNodeId]) : new Set<number>();
  const messages = listChatMessagesForIdentity(identityId);
  const sanitizedLastRead =
    protocol === 'meshcore' ? getSanitizedMeshcoreChatLastRead(messages) : persistedLastRead;
  const unreadByChannel = computeChannelUnreadCounts(
    messages,
    sanitizedLastRead,
    ownNodeIds,
    protocol,
    nowMs,
  );

  const volumeByChannel = new Map<number, number>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (msg.channel < 0 || msg.to) continue;
    volumeByChannel.set(msg.channel, (volumeByChannel.get(msg.channel) ?? 0) + 1);
  }

  const topChannels = [...volumeByChannel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ch]) => ch);

  const rows: DebugChannelLastReadTriageRow[] = [];
  for (const channelIndex of topChannels) {
    const viewKey = `ch:${channelIndex}`;
    const lastReadWatermark = persistedLastRead[viewKey] ?? 0;
    const lastReadWatermarkEffective = sanitizedLastRead[viewKey] ?? 0;
    let newestInboundEffectiveTs: number | null = null;
    let hasFuturePoisonInbound = false;
    for (const msg of regular) {
      if (msg.channel !== channelIndex) continue;
      if (ownNodeIds.has(msg.sender_id)) continue;
      if (msg.to) continue;
      if (msg.isHistory) continue;
      if (isUnreasonablyFutureMessageTimestampMs(msg.timestamp, nowMs)) {
        hasFuturePoisonInbound = true;
        continue;
      }
      const ts = effectiveMessageTimestampMs(msg.timestamp, nowMs);
      if (newestInboundEffectiveTs == null || ts > newestInboundEffectiveTs) {
        newestInboundEffectiveTs = ts;
      }
    }
    rows.push({
      viewKey,
      channelIndex,
      lastReadWatermark,
      lastReadWatermarkEffective,
      newestInboundEffectiveTs,
      watermarkAheadOfNewestInboundMs:
        newestInboundEffectiveTs != null && lastReadWatermark >= newestInboundEffectiveTs
          ? lastReadWatermark - newestInboundEffectiveTs
          : null,
      unreadEstimate: unreadByChannel.get(channelIndex) ?? 0,
      hasFuturePoisonInbound,
    });
  }
  return rows;
}

function countLastReadWatermarks(protocol: MeshProtocol): number {
  const raw = localStorage.getItem(lastReadStorageKey(protocol));
  if (!raw) return 0;
  const parsed = parseStoredJson<unknown>(raw, 'debugSnapshot lastRead');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed).length;
  }
  return 0;
}

function countIdentitiesForProtocol(
  identities: ReturnType<typeof useIdentityStore.getState>['identities'],
  protocol: MeshProtocol,
): number {
  return Object.values(identities).filter((i) => i.protocol.type === protocol).length;
}

function buildConnectionSnapshot(
  uiStoreIdentityId: IdentityId | null,
): DebugConnectionSnapshot | null {
  if (!uiStoreIdentityId) return null;
  const conn = getConnection(uiStoreIdentityId);
  if (!conn) return null;
  return {
    status: conn.status,
    mqttStatus: conn.mqttStatus,
    connectionType: conn.connectionType,
    myNodeNum: conn.myNodeNum,
    connectionLoss: conn.connectionLoss ?? false,
  };
}

function deriveSessionFields(
  hydrationSlotId: IdentityId,
  connectIdentityId: IdentityId | null,
  primaryTransportStatuses: string[],
  connection: DebugConnectionSnapshot | null,
  hydrationSlotMessageCount: number,
): Pick<
  DebugIdentityBucketSnapshot,
  | 'sessionState'
  | 'liveSession'
  | 'rfTransportConnected'
  | 'mqttConnected'
  | 'hydrationSlotIsLiveSession'
> {
  const rfTransportConnected = primaryTransportStatuses.includes('connected');
  const mqttConnected = connection?.mqttStatus === 'connected';
  const rfConfigured =
    connection?.status === 'configured' ||
    connection?.status === 'connected' ||
    connection?.status === 'connecting';
  const liveSession = rfTransportConnected || mqttConnected || rfConfigured;
  let sessionState: DebugSessionState = 'empty';
  if (liveSession) sessionState = 'live';
  else if (hydrationSlotMessageCount > 0) sessionState = 'hydratedOnly';
  return {
    sessionState,
    liveSession,
    rfTransportConnected,
    mqttConnected,
    hydrationSlotIsLiveSession: Boolean(
      connectIdentityId && connectIdentityId === hydrationSlotId && liveSession,
    ),
  };
}

function toSessionSummary(bucket: DebugIdentityBucketSnapshot): DebugSessionSummary {
  return {
    sessionState: bucket.sessionState,
    liveSession: bucket.liveSession,
    rfTransportConnected: bucket.rfTransportConnected,
    mqttConnected: bucket.mqttConnected,
    uiStoreIdentityId: bucket.uiStoreIdentityId,
  };
}

function buildProtocolBucketSnapshot(protocol: MeshProtocol): DebugIdentityBucketSnapshot {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  const hydrationSlotId = getOfflineIdentityIdForProtocol(protocol);
  const connectIdentityId = resolvePrimaryIdentityIdForProtocol(
    identities,
    activeIdentityId,
    protocol,
  );
  const uiStoreIdentityId = resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const messages = useMessageStore.getState().messages;
  const nodes = useNodeStore.getState().nodes;
  const connectRec = connectIdentityId ? identities[connectIdentityId] : undefined;
  const hydrationSlotMessageCount = Object.keys(messages[hydrationSlotId] ?? {}).length;
  const connection = buildConnectionSnapshot(uiStoreIdentityId);
  const primaryTransportStatuses = connectRec?.transports.map((t) => t.status) ?? [];
  const lastReadByViewKey = loadLastReadByViewKey(protocol);
  const ownNodeId = connection?.myNodeNum ?? 0;
  const roomsTriage = getProtocolRegistration(protocol)?.capabilities.hasRoomServersPanel
    ? buildMeshcoreRoomsTriage(uiStoreIdentityId, ownNodeId)
    : undefined;

  return {
    hydrationSlotId,
    connectIdentityId,
    uiStoreIdentityId,
    identitySplit: Boolean(
      connectIdentityId && uiStoreIdentityId && connectIdentityId !== uiStoreIdentityId,
    ),
    identityCount: countIdentitiesForProtocol(identities, protocol),
    primaryTransportStatuses,
    ...deriveSessionFields(
      hydrationSlotId,
      connectIdentityId,
      primaryTransportStatuses,
      connection,
      hydrationSlotMessageCount,
    ),
    hydrationSlotMessageCount,
    connectMessageCount: connectIdentityId
      ? Object.keys(messages[connectIdentityId] ?? {}).length
      : 0,
    uiStoreMessageCount: uiStoreIdentityId
      ? Object.keys(messages[uiStoreIdentityId] ?? {}).length
      : 0,
    hydrationSlotNodeCount: Object.keys(nodes[hydrationSlotId] ?? {}).length,
    connectNodeCount: connectIdentityId ? Object.keys(nodes[connectIdentityId] ?? {}).length : 0,
    uiStoreNodeCount: uiStoreIdentityId ? Object.keys(nodes[uiStoreIdentityId] ?? {}).length : 0,
    hydrationSlotNewestMessageTs: newestMessageTimestamp(hydrationSlotId),
    connectNewestMessageTs: newestMessageTimestamp(connectIdentityId),
    uiStoreNewestMessageTs: newestMessageTimestamp(uiStoreIdentityId),
    lastReadWatermarkCount: countLastReadWatermarks(protocol),
    lastReadByViewKey,
    lastReadSanitizedFlag: loadLastReadSanitizedFlag(protocol),
    channelLastReadTriage: buildChannelLastReadTriage(
      protocol,
      uiStoreIdentityId,
      lastReadByViewKey,
      ownNodeId,
    ),
    connection,
    ...roomsTriage,
  };
}

function buildMeshcoreRoomsTriage(
  uiStoreIdentityId: IdentityId | null,
  connectionOwnNodeId: number,
): Pick<
  DebugIdentityBucketSnapshot,
  | 'roomNodeCount'
  | 'roomMessageCount'
  | 'roomsUnreadEstimate'
  | 'orphanRoomMessageCount'
  | 'roomsLastReadKeyCount'
> {
  const chatMessages = listChatMessagesForIdentity(uiStoreIdentityId);
  const nodeBucket = uiStoreIdentityId
    ? useNodeStore.getState().nodes[uiStoreIdentityId]
    : undefined;
  const meshNodes = nodeBucket ? Object.values(nodeBucket).map((r) => nodeRecordToMeshNode(r)) : [];
  const knownRoomIds = meshcoreRoomServerIdsFromNodes(meshNodes);
  const selfId = connectionOwnNodeId > 0 ? connectionOwnNodeId : loadPersistedMeshcoreSelfNodeId();
  const ownNodeIds = new Set(selfId > 0 ? [selfId] : []);
  let roomMessageCount = 0;
  let orphanRoomMessageCount = 0;
  for (const msg of chatMessages) {
    if (!isMeshcoreRoomChatMessage(msg)) continue;
    roomMessageCount += 1;
    const roomId = msg.roomServerId ?? msg.to;
    if (roomId == null || !knownRoomIds.has(roomId)) orphanRoomMessageCount += 1;
  }
  const roomsLastRead = getSanitizedMeshcoreRoomsLastRead(chatMessages);
  return {
    roomNodeCount: knownRoomIds.size,
    roomMessageCount,
    roomsUnreadEstimate: totalRoomsUnreadCount(
      chatMessages,
      roomsLastRead,
      ownNodeIds,
      undefined,
      knownRoomIds,
    ),
    orphanRoomMessageCount,
    roomsLastReadKeyCount: Object.keys(loadPersistedRoomsLastRead()).length,
  };
}

function analyzeProtocolBucket(
  protocol: MeshProtocol,
  bucket: DebugIdentityBucketSnapshot,
): DebugSnapshotWarning[] {
  const warnings: DebugSnapshotWarning[] = [];
  const connected = bucket.primaryTransportStatuses.includes('connected');

  if (bucket.identitySplit && connected) {
    warnings.push({
      code: 'identitySplit',
      protocol,
      detail: `UI store ${bucket.uiStoreIdentityId} differs from connect identity ${bucket.connectIdentityId} while transport is connected`,
    });
  }

  if (
    bucket.connectIdentityId &&
    bucket.uiStoreIdentityId &&
    bucket.connectIdentityId !== bucket.uiStoreIdentityId &&
    bucket.connectNewestMessageTs != null &&
    bucket.hydrationSlotNewestMessageTs != null &&
    bucket.connectNewestMessageTs > bucket.hydrationSlotNewestMessageTs
  ) {
    warnings.push({
      code: 'staleResolvedBucket',
      protocol,
      detail: 'Connect identity has newer messages than hydration slot but UI reads hydration slot',
    });
  }

  if (connected && bucket.connectMessageCount === 0 && bucket.hydrationSlotMessageCount > 0) {
    warnings.push({
      code: 'connectedNoPrimaryMessages',
      protocol,
      detail: 'Connect identity store empty while hydration slot has messages',
    });
  }

  for (const row of bucket.channelLastReadTriage) {
    if (
      row.watermarkAheadOfNewestInboundMs != null &&
      row.watermarkAheadOfNewestInboundMs > 0 &&
      row.unreadEstimate === 0
    ) {
      warnings.push({
        code: 'lastReadSuppressesChannelUnread',
        protocol,
        detail: `${row.viewKey} lastRead watermark is ${row.watermarkAheadOfNewestInboundMs}ms ahead of newest inbound; unread badge likely suppressed`,
      });
    }
    if (row.hasFuturePoisonInbound) {
      warnings.push({
        code: 'lastReadSuppressesChannelUnread',
        protocol,
        detail: `${row.viewKey} has future-dated inbound messages (RTC skew); last-read watermarks may be unreliable until clamped`,
      });
    }
  }

  return warnings;
}

function analyzeReticulumSnapshot(reticulum: DebugReticulumSnapshot): DebugSnapshotWarning[] {
  const warnings = analyzeProtocolBucket('reticulum', reticulum.bucket);
  const identityConfigured = reticulum.stack?.identityStatus?.configured === true;
  const hasLocalData =
    reticulum.bucket.hydrationSlotMessageCount > 0 || reticulum.bucket.uiStoreMessageCount > 0;
  const expectsSidecar = identityConfigured || hasLocalData || reticulum.bucket.liveSession;

  if (!reticulum.sidecar.running && expectsSidecar) {
    warnings.push({
      code: 'sidecarNotRunning',
      protocol: 'reticulum',
      detail: reticulum.sidecar.lastError ?? 'Reticulum sidecar is not running',
    });
  }

  return warnings;
}

function buildReticulumSnapshot(
  sidecarSnapshot: ReticulumDiagnosticSidecarSnapshot,
): DebugReticulumSnapshot {
  return {
    bucket: buildProtocolBucketSnapshot('reticulum'),
    ...sidecarSnapshot,
  };
}

function activeTabSummaryForProtocol(
  protocol: MeshProtocol,
  snap: Pick<DebugSnapshot, 'meshtastic' | 'meshcore' | 'reticulum'>,
): DebugActiveTabSummary {
  const bucket =
    protocol === 'reticulum'
      ? snap.reticulum.bucket
      : protocol === 'meshcore'
        ? snap.meshcore
        : snap.meshtastic;
  return {
    protocol,
    uiStoreIdentityId: bucket.uiStoreIdentityId,
    sessionState: bucket.sessionState,
    liveSession: bucket.liveSession,
  };
}

function buildMeshtasticBucketSnapshot(): DebugMeshtasticBucketSnapshot {
  const base = buildProtocolBucketSnapshot('meshtastic');
  const channelCtx = getDebugSnapshotMeshtasticContext();
  return {
    ...base,
    channelPills: channelCtx.channelPills,
    channelConfigsSummary: channelCtx.channelConfigsSummary,
    mqttChannelKeyEntryCount: channelCtx.mqttChannelKeyEntryCount,
    mqttChannelNameToIndex: channelCtx.mqttChannelNameToIndex,
  };
}

function buildDebugSnapshotBase(
  reticulumSidecar: ReticulumDiagnosticSidecarSnapshot,
): Omit<DebugSnapshot, 'warnings'> {
  const meshtastic = buildMeshtasticBucketSnapshot();
  const meshcore = buildProtocolBucketSnapshot('meshcore');
  const reticulum = buildReticulumSnapshot(reticulumSidecar);
  const ui = getDebugSnapshotUiContext();
  const storedProtocol = getStoredMeshProtocol();

  return {
    capturedAt: new Date().toISOString(),
    legend: DEBUG_SNAPSHOT_ID_LEGEND,
    sessionSummary: {
      meshtastic: toSessionSummary(meshtastic),
      meshcore: toSessionSummary(meshcore),
      reticulum: toSessionSummary(reticulum.bucket),
    },
    activeTab: activeTabSummaryForProtocol(ui.activeProtocol, {
      meshtastic,
      meshcore,
      reticulum,
    }),
    storedProtocol,
    windowHidden: typeof document !== 'undefined' ? document.hidden : false,
    ui,
    meshtastic,
    meshcore,
    reticulum,
  };
}

/** Pure triage helper — flags common stuck-chat / UI failure signatures. */
export function analyzeDebugSnapshot(
  snap: Omit<DebugSnapshot, 'warnings'>,
): DebugSnapshotWarning[] {
  const warnings: DebugSnapshotWarning[] = [
    ...analyzeProtocolBucket('meshtastic', snap.meshtastic),
    ...analyzeProtocolBucket('meshcore', snap.meshcore),
    ...analyzeReticulumSnapshot(snap.reticulum),
  ];

  const { ui } = snap;
  if (
    ui.chatPanelFrozen &&
    ui.frozenMessageCount != null &&
    ui.frozenMessageCount < ui.liveResolvedMessageCount
  ) {
    warnings.push({
      code: 'chatPanelFrozen',
      detail: `Chat panel frozen with ${ui.frozenMessageCount} messages but live store has ${ui.liveResolvedMessageCount}`,
    });
  }

  if (snap.windowHidden && ui.activePanelIndex === 1) {
    warnings.push({
      code: 'windowHiddenOnChat',
      detail: 'Window hidden while Chat panel is active',
    });
  }

  return warnings;
}

/** Renderer-side support snapshot (sync — sidecar APIs omitted; use buildDebugSnapshotAsync for exports). */
export function buildDebugSnapshot(): DebugSnapshot {
  const base = buildDebugSnapshotBase(buildReticulumDiagnosticSnapshotSync());
  return {
    ...base,
    warnings: analyzeDebugSnapshot(base),
  };
}

/** Full support snapshot including live Reticulum sidecar state for GitHub/developer bundles. */
export async function buildDebugSnapshotAsync(): Promise<DebugSnapshot> {
  const reticulumSidecar = await fetchReticulumDiagnosticSnapshot();
  try {
    const map = await window.electronAPI.mqtt.getChannelNameToIndex();
    setDebugSnapshotMeshtasticContext({ mqttChannelNameToIndex: map });
  } catch (e: unknown) {
    console.warn('[debugSnapshot] mqtt.getChannelNameToIndex failed ' + errLikeToLogString(e));
  }
  let mainLiveness: RendererLivenessSnapshot | null = null;
  try {
    mainLiveness = await window.electronAPI.app.getRendererLiveness();
  } catch (e: unknown) {
    console.warn('[debugSnapshot] getRendererLiveness failed ' + errLikeToLogString(e));
  }
  const base = buildDebugSnapshotBase(reticulumSidecar);
  const meshcoreContactPathDiagnostics = await fetchMeshcoreContactPathDiagnostics();
  return {
    ...base,
    mainLiveness,
    meshcoreContactPathDiagnostics,
    warnings: analyzeDebugSnapshot(base),
  };
}

export async function copyDebugSnapshotToClipboard(): Promise<boolean> {
  const text = JSON.stringify(await buildDebugSnapshotAsync(), null, 2);
  await writeClipboardText(text);
  return true;
}
