import type { ConnectionStatus } from '../stores/connectionStore';
import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { lastReadStorageKey } from './chatPanelProtocolStorage';
import { getDebugSnapshotUiContext } from './debugSnapshotUiContext';
import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from './identityByProtocol';
import {
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from './offlineProtocolIdentities';
import { parseStoredJson } from './parseStoredJson';
import { getStoredMeshProtocol } from './storedMeshProtocol';
import type { IdentityId, MeshProtocol, MQTTStatus } from './types';
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
  connection: DebugConnectionSnapshot | null;
}

export type DebugSnapshotWarningCode =
  | 'identitySplit'
  | 'staleResolvedBucket'
  | 'chatPanelFrozen'
  | 'connectedNoPrimaryMessages'
  | 'windowHiddenOnChat';

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
  };
  activeTab: DebugActiveTabSummary;
  storedProtocol: MeshProtocol;
  windowHidden: boolean;
  ui: ReturnType<typeof getDebugSnapshotUiContext>;
  meshtastic: DebugIdentityBucketSnapshot;
  meshcore: DebugIdentityBucketSnapshot;
  warnings: DebugSnapshotWarning[];
}

function newestMessageTimestamp(identityId: IdentityId | null): number | null {
  if (!identityId) return null;
  const bucket = useMessageStore.getState().messages[identityId];
  if (!bucket) return null;
  let max = 0;
  for (const row of Object.values(bucket)) {
    if (row.timestamp > max) max = row.timestamp;
  }
  return max > 0 ? max : null;
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
  const hydrationSlotId =
    protocol === 'meshtastic' ? OFFLINE_MESHTASTIC_IDENTITY_ID : OFFLINE_MESHCORE_IDENTITY_ID;
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
    connection,
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

  return warnings;
}

/** Pure triage helper — flags common stuck-chat / UI failure signatures. */
export function analyzeDebugSnapshot(
  snap: Omit<DebugSnapshot, 'warnings'>,
): DebugSnapshotWarning[] {
  const warnings: DebugSnapshotWarning[] = [
    ...analyzeProtocolBucket('meshtastic', snap.meshtastic),
    ...analyzeProtocolBucket('meshcore', snap.meshcore),
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

/** Renderer-side support snapshot for bug reports (identity buckets + store counts). */
export function buildDebugSnapshot(): DebugSnapshot {
  const meshtastic = buildProtocolBucketSnapshot('meshtastic');
  const meshcore = buildProtocolBucketSnapshot('meshcore');
  const storedProtocol = getStoredMeshProtocol();
  const activeBucket = storedProtocol === 'meshcore' ? meshcore : meshtastic;
  const base = {
    capturedAt: new Date().toISOString(),
    legend: DEBUG_SNAPSHOT_ID_LEGEND,
    sessionSummary: {
      meshtastic: toSessionSummary(meshtastic),
      meshcore: toSessionSummary(meshcore),
    },
    activeTab: {
      protocol: storedProtocol,
      uiStoreIdentityId: activeBucket.uiStoreIdentityId,
      sessionState: activeBucket.sessionState,
      liveSession: activeBucket.liveSession,
    },
    storedProtocol,
    windowHidden: typeof document !== 'undefined' ? document.hidden : false,
    ui: getDebugSnapshotUiContext(),
    meshtastic,
    meshcore,
  };
  return {
    ...base,
    warnings: analyzeDebugSnapshot(base),
  };
}

export async function copyDebugSnapshotToClipboard(): Promise<boolean> {
  const text = JSON.stringify(buildDebugSnapshot(), null, 2);
  await writeClipboardText(text);
  return true;
}
