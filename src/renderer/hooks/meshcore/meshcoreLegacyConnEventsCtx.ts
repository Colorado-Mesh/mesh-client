import type { Dispatch, RefObject, SetStateAction } from 'react';

import type {
  DeviceLogEntry,
  MeshCoreConnection,
  MeshCoreContactRaw,
  MeshCoreSelfInfo,
  RxPacketEntry,
} from '../../lib/meshcore/meshcoreHookTypes';
import type { MeshcoreAutoaddWireState } from '../../lib/meshcoreContactAutoAdd';
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
}

export interface MeshcoreLegacyConnEventsCtx {
  meshcoreIdentityIdRef: RefObject<string | null>;
  meshcoreDriverConnectedRef: RefObject<boolean>;
  connRef: RefObject<MeshCoreConnection | null>;
  lastPacketLogAtRef: RefObject<number>;
  lastPacketLogPublishFailureLogAtRef: RefObject<number>;
  meshcoreContactsRefreshTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  meshcoreHookMountedRef: RefObject<boolean>;
  meshcorePathUpdatePendingRef: RefObject<Set<number>>;
  meshcoreSessionPathUpdatedNodeIdsRef: RefObject<Set<number>>;
  meshcoreWaitingMessagesPollRef: RefObject<ReturnType<typeof setInterval> | null>;
  meshcoreConnectTypeRef: RefObject<'ble' | 'serial' | 'tcp'>;
  messagesRef: RefObject<ChatMessage[]>;
  mqttStatusRef: RefObject<MQTTStatus>;
  myNodeNumRef: RefObject<number>;
  nicknameMapRef: RefObject<Map<number, string>>;
  nodesRef: RefObject<Map<number, MeshNode>>;
  outPathMapRef: RefObject<Map<number, Uint8Array>>;
  pendingAcksRef: RefObject<Map<number, PendingDmAckEntry>>;
  processWaitingMessagesRef: RefObject<
    ((options?: ProcessWaitingMessagesOptions) => Promise<void>) | null
  >;
  pubKeyMapRef: RefObject<Map<number, Uint8Array>>;
  pubKeyPrefixMapRef: RefObject<Map<string, number>>;
  rawPacketsRef: RefObject<RxPacketEntry[]>;
  repeaterCommandServiceRef: RefObject<RepeaterCommandService | null>;
  selfInfoRef: RefObject<MeshCoreSelfInfo | null>;
  buildNodesFromContactsRef: RefObject<
    | ((
        contacts: MeshCoreContactRaw[],
        opts?: {
          self?: MeshCoreSelfInfo | null;
          myNodeId?: number;
          previousNodes?: Map<number, MeshNode>;
        },
      ) => Promise<Map<number, MeshNode>>)
    | null
  >;
  setDeviceLogs: Dispatch<SetStateAction<DeviceLogEntry[]>>;
  setMeshcoreAutoadd: Dispatch<SetStateAction<MeshcoreAutoaddWireState | null>>;
  setMeshcoreContactsForTelemetry: Dispatch<SetStateAction<MeshCoreContactRaw[]>>;
  setMeshcorePingRouteReadyEpoch: Dispatch<SetStateAction<number>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setNodes: Dispatch<SetStateAction<Map<number, MeshNode>>>;
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
  addMessage: (msg: ChatMessage) => void;
  addCliHistoryEntry: (nodeId: number, entry: CliHistoryEntry) => void;
  teardownMeshcoreConnEventListeners: (opts?: { driverDisconnect?: boolean }) => void;
  meshcorePreviousNodesBaselineForBuild: () => Map<number, MeshNode>;
  handleConnectionLostRef: RefObject<() => void>;
  meshcoreExplicitDisconnectRef: RefObject<boolean>;
  bumpLastDataReceived?: () => void;
}
