import type { MeshProtocol } from './types';

export interface DebugSnapshotUiContext {
  activePanelIndex: number;
  chatTabVisited: boolean;
  chatPanelFrozen: boolean;
  frozenMessageCount: number | null;
  liveResolvedMessageCount: number;
  activeProtocol: MeshProtocol;
}

const defaultUiContext: DebugSnapshotUiContext = {
  activePanelIndex: 0,
  chatTabVisited: false,
  chatPanelFrozen: false,
  frozenMessageCount: null,
  liveResolvedMessageCount: 0,
  activeProtocol: 'meshtastic',
};

let uiContext: DebugSnapshotUiContext = { ...defaultUiContext };

/** Updated from App.tsx so debug snapshots capture chat-freeze / tab context. */
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
