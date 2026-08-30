import type { Dispatch, RefObject, SetStateAction } from 'react';

import type {
  DeviceLogEntry,
  MeshCoreConnection,
  MeshCoreSelfInfo,
  RxPacketEntry,
} from '../../lib/meshcore/meshcoreHookTypes';
import type { CliHistoryEntry, RepeaterCommandService } from '../../lib/repeaterCommandService';
import type {
  ChatMessage,
  DeviceState,
  MeshNode,
  MQTTStatus,
  TelemetryPoint,
} from '../../lib/types';
import type { PendingDmAckEntry } from './meshcoreHookPreamble';

export interface ProcessWaitingMessagesOptions {
  /** When false, drain the radio queue without the ChatPanel sync spinner (proactive/periodic). */
  showSyncBanner?: boolean;
  /**
   * When true, run the drain even if companion RF/trace would normally defer silent drains.
   * Used while awaiting a 0-hop CLI_DATA reply that arrives as a waiting message.
   */
  force?: boolean;
  /**
   * When true, skip bulk `getWaitingMessages` and only use `syncNextMessage`.
   * Required for CLI reply polling — bulk often hangs 45s while CLI times out at 30s.
   */
  incrementalOnly?: boolean;
}

/**
 * Runtime state needed by the MeshCore `DomainEvent` side-effect listener
 * ({@link attachMeshcoreConnSideEffects}). Everything here is owned by
 * `useMeshcoreRuntime`; the listener only reads refs and calls setters.
 */
export interface MeshcoreConnSideEffectsCtx {
  /** Identity the listener accepts events for (pending driver identity before configure). */
  resolveIdentityId: () => string | null;
  meshcoreIdentityIdRef: RefObject<string | null>;
  meshcoreDriverConnectedRef: RefObject<boolean>;
  connRef: RefObject<MeshCoreConnection | null>;
  lastPacketLogPublishFailureLogAtRef: RefObject<number>;
  meshcoreContactsRefreshTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  meshcoreHookMountedRef: RefObject<boolean>;
  meshcoreSessionPathUpdatedNodeIdsRef: RefObject<Set<number>>;
  meshcoreWaitingMessagesPollRef: RefObject<ReturnType<typeof setInterval> | null>;
  meshcoreConnectTypeRef: RefObject<'ble' | 'serial' | 'tcp'>;
  mqttStatusRef: RefObject<MQTTStatus>;
  myNodeNumRef: RefObject<number>;
  nicknameMapRef: RefObject<Map<number, string>>;
  /** Identity-scoped `nodeStore` snapshot — the runtime no longer keeps a node mirror. */
  readNodes: () => Map<number, MeshNode>;
  pendingAcksRef: RefObject<Map<number, PendingDmAckEntry>>;
  processWaitingMessagesRef: RefObject<
    ((options?: ProcessWaitingMessagesOptions) => Promise<void>) | null
  >;
  pubKeyMapRef: RefObject<Map<number, Uint8Array>>;
  pubKeyPrefixMapRef: RefObject<Map<string, number>>;
  rawPacketsRef: RefObject<RxPacketEntry[]>;
  repeaterCommandServiceRef: RefObject<RepeaterCommandService | null>;
  selfInfoRef: RefObject<MeshCoreSelfInfo | null>;
  setDeviceLogs: Dispatch<SetStateAction<DeviceLogEntry[]>>;
  setMeshcorePingRouteReadyEpoch: Dispatch<SetStateAction<number>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setQueueStatus: Dispatch<SetStateAction<{ free: number; maxlen: number; res: number } | null>>;
  setRawPackets: Dispatch<SetStateAction<RxPacketEntry[]>>;
  setSignalTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setState: Dispatch<SetStateAction<DeviceState>>;
  setWaitingMessagesCount: Dispatch<SetStateAction<number>>;
  setWaitingMessagesSyncActive: Dispatch<SetStateAction<boolean>>;
  setWaitingMessagesSyncProgress: Dispatch<
    SetStateAction<{ processed: number; total: number } | null>
  >;
  setWaitingMessagesSilentDrainActive: Dispatch<SetStateAction<boolean>>;
  setWaitingMessagesDrainDeferred: Dispatch<SetStateAction<boolean>>;
  addMessagesBatch: (msgs: ChatMessage[]) => void;
  addCliHistoryEntry: (nodeId: number, entry: CliHistoryEntry) => void;
  teardownMeshcoreConnEventListeners: (opts?: { driverDisconnect?: boolean }) => void;
  handleConnectionLostRef: RefObject<() => void>;
  meshcoreExplicitDisconnectRef: RefObject<boolean>;
  bumpLastDataReceived?: () => void;
}
