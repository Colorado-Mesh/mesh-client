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

export interface MeshcoreLegacyConnEventsCtx {
  meshcoreIdentityIdRef: RefObject<string | null>;
  connRef: RefObject<MeshCoreConnection | null>;
  lastPacketLogAtRef: RefObject<number>;
  lastPacketLogPublishFailureLogAtRef: RefObject<number>;
  meshcoreContactsRefreshTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  meshcoreHookMountedRef: RefObject<boolean>;
  meshcorePathUpdatePendingRef: RefObject<Set<number>>;
  meshcoreSessionPathUpdatedNodeIdsRef: RefObject<Set<number>>;
  meshcoreWaitingMessagesPollRef: RefObject<ReturnType<typeof setInterval> | null>;
  messagesRef: RefObject<ChatMessage[]>;
  mqttStatusRef: RefObject<MQTTStatus>;
  myNodeNumRef: RefObject<number>;
  nicknameMapRef: RefObject<Map<number, string>>;
  nodesRef: RefObject<Map<number, MeshNode>>;
  outPathMapRef: RefObject<Map<number, Uint8Array>>;
  pendingAcksRef: RefObject<Map<number, PendingDmAckEntry>>;
  processWaitingMessagesRef: RefObject<(() => Promise<void>) | null>;
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
  addMessage: (msg: ChatMessage) => void;
  addCliHistoryEntry: (nodeId: number, entry: CliHistoryEntry) => void;
  teardownMeshcoreConnEventListeners: (opts?: { driverDisconnect?: boolean }) => void;
  meshcorePreviousNodesBaselineForBuild: () => Map<number, MeshNode>;
  handleConnectionLostRef: RefObject<() => void>;
}
