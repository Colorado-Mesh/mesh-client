import type { ReticulumSidecarEvent } from '../../shared/reticulum-types';
import type {
  ChatMessage,
  DeviceState,
  IdentityId,
  MeshNode,
  MeshWaypoint,
  NeighborInfoRecord,
} from '../lib/types';

/** Device queue depth from radio/SDK when available. */
export interface ProtocolRuntimeQueueStatus {
  free: number;
  maxlen: number;
  res: number;
}

export interface ProtocolRuntimeDeviceOwner {
  longName?: string;
  shortName?: string;
  isLicensed?: boolean;
}

export interface ProtocolRuntimeDeviceLog {
  message: string;
  time: number;
  source: string;
  level: number;
}

/**
 * Minimal shared surface for App orchestration and panel facades ([#543]).
 * Protocol-specific fields stay optional; gate UI with ProtocolCapabilities.
 */
export interface ProtocolRuntime {
  state: DeviceState;
  identityId: IdentityId | null;
  selfNodeId: string | number | null;
  mqttStatus: string | null;
  mqttConnectionLoss: string | null | boolean;
  messages: ChatMessage[];
  nodes: Map<number, MeshNode>;
  deviceOwner: ProtocolRuntimeDeviceOwner | null;
  deviceLogs: ProtocolRuntimeDeviceLog[] | unknown[];
  rawPackets: unknown[];
  queueStatus: ProtocolRuntimeQueueStatus | null;
  ourPosition: unknown;
  gpsLoading: boolean;
  telemetry: unknown;
  signalTelemetry: unknown;
  environmentTelemetry: unknown;
  traceRouteResults: Map<number, unknown>;
  neighborInfo: Map<number, unknown>;
  channels: unknown[];
  channelConfigs: unknown[];
  moduleConfigs: Record<string, unknown>;
  waypoints: unknown[] | Map<number, MeshWaypoint>;
  telemetryEnabled: boolean | null;
  telemetryDeviceUpdateInterval: number | undefined;

  connect: (...args: never[]) => Promise<void>;
  connectAutomatic: () => Promise<void>;
  disconnect: () => Promise<void>;
  onPowerSuspend: () => void;
  onPowerResume: () => void;
  prepareRfConnect: (...args: never[]) => Promise<void>;
  attachRfSession: (...args: never[]) => Promise<void>;
  handleRfConnectFailure: (...args: never[]) => void | Promise<void>;
  finalizeDriverDisconnect: () => Promise<void>;

  sendMessage: (...args: never[]) => Promise<void>;
  setNodeFavorited: (nodeId: number, favorited: boolean) => Promise<void>;
  refreshNodesFromDb: () => Promise<void>;
  refreshMessagesFromDb: () => Promise<void>;
  requestRefresh: () => Promise<void>;
  getNodes: () => MeshNode[];
  getFullNodeLabel: (nodeId: number) => string;
  getPickerStyleNodeLabel: (nodeId: number) => string;

  sendReaction?: (glyph: string, replyId: number, channel: number) => Promise<void>;
  sendAttachment?: (file: File, to: number | string) => Promise<void>;
  sendPositionToDevice?: (...args: never[]) => Promise<void>;
  traceRoute?: (nodeId: number) => Promise<void>;
  reboot?: () => Promise<void>;
  deleteNode?: (nodeId: number) => Promise<void>;
  clearRawPackets?: () => void;
  getRemoteAdminKeyForNode?: (nodeId: number) => string | null;
  setRemoteAdminKeyForNode?: (nodeId: number, key: string) => void;
  refreshOurPosition?: () => Promise<void>;
  updateGpsInterval?: (...args: never[]) => void;

  /** Reticulum sidecar WebSocket events (optional — Reticulum runtime only). */
  handleSidecarEvent?: (event: ReticulumSidecarEvent) => void;

  setConfig?: (...args: never[]) => Promise<void>;
  commitConfig?: (...args: never[]) => Promise<void>;
  setDeviceChannel?: (...args: never[]) => Promise<void>;
  clearChannel?: (...args: never[]) => Promise<void>;
  setOwner?: (...args: never[]) => Promise<void>;
  shutdown?: () => Promise<void>;
  factoryReset?: () => Promise<void>;
  resetNodeDb?: () => Promise<void>;
  rebootOta?: () => Promise<void>;
  enterDfuMode?: () => Promise<void>;
  factoryResetConfig?: () => Promise<void>;
  sendWaypoint?: (...args: never[]) => Promise<void>;
  deleteWaypoint?: (...args: never[]) => Promise<void>;
  requestPosition?: (...args: never[]) => Promise<void>;
  setModuleConfig?: (...args: never[]) => Promise<void>;
  setCannedMessages?: (...args: never[]) => Promise<void>;

  // Meshtastic remote admin / config slices (optional)
  meshtasticConfigSlices?: Record<string, unknown>;
  loraConfig?: unknown;
  securityConfig?: unknown;
  deviceFixedPosition?: unknown;
  remoteConfigSnapshot?: {
    channelConfigs?: unknown[];
    loraConfig?: unknown;
    moduleConfigs?: Record<string, unknown>;
    configSlices?: Record<string, unknown>;
    securityConfig?: unknown;
    deviceOwner?: ProtocolRuntimeDeviceOwner | null;
    deviceFixedPosition?: unknown;
    failedChannelIndices?: number[];
  } | null;
}

export type { NeighborInfoRecord };
