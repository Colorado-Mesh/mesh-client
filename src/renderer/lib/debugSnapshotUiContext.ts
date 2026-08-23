import type { MeshProtocol } from './types';

export interface DebugSnapshotMeshcoreDrainContext {
  meshcoreCompanionRepeaterRfBusy: boolean;
  meshcoreCliReplyHoldCount: number;
  meshcoreAdminRpcInFlightCount: number;
  meshcoreTraceRpcInFlightCount: number;
  meshcoreTraceResponsesInFlightCount: number;
  meshcoreSilentBulkSkipped: boolean;
  meshcoreSilentBulkTimeoutStreak: number;
}

export interface DebugSnapshotUiContext {
  activePanelIndex: number;
  chatTabVisited: boolean;
  chatPanelFrozen: boolean;
  frozenMessageCount: number | null;
  liveResolvedMessageCount: number;
  activeProtocol: MeshProtocol;
  waitingMessagesSilentDrainActive: boolean;
  waitingMessagesDrainDeferred: boolean;
  meshcoreDrain?: DebugSnapshotMeshcoreDrainContext;
}

const defaultMeshcoreDrainContext: DebugSnapshotMeshcoreDrainContext = {
  meshcoreCompanionRepeaterRfBusy: false,
  meshcoreCliReplyHoldCount: 0,
  meshcoreAdminRpcInFlightCount: 0,
  meshcoreTraceRpcInFlightCount: 0,
  meshcoreTraceResponsesInFlightCount: 0,
  meshcoreSilentBulkSkipped: false,
  meshcoreSilentBulkTimeoutStreak: 0,
};

const defaultUiContext: DebugSnapshotUiContext = {
  activePanelIndex: 0,
  chatTabVisited: false,
  chatPanelFrozen: false,
  frozenMessageCount: null,
  liveResolvedMessageCount: 0,
  activeProtocol: 'meshtastic',
  waitingMessagesSilentDrainActive: false,
  waitingMessagesDrainDeferred: false,
  meshcoreDrain: defaultMeshcoreDrainContext,
};

let uiContext: DebugSnapshotUiContext = { ...defaultUiContext };

/** Updated from App.tsx so debug snapshots capture active tab context and waiting-message drain state. */
export function setDebugSnapshotUiContext(partial: Partial<DebugSnapshotUiContext>): void {
  uiContext = { ...uiContext, ...partial };
}

export function getDebugSnapshotUiContext(): DebugSnapshotUiContext {
  return uiContext;
}

/** Test helper — reset module state between cases. */
export function resetDebugSnapshotUiContext(): void {
  uiContext = { ...defaultUiContext };
}
