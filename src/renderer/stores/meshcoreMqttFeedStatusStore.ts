import { create } from 'zustand';

import type { MQTTStatus } from '../lib/types';

/** Per-connection MeshCore MQTT status (chat + analyzer feeds), keyed by connection id. */
export interface MeshcoreMqttFeedStatusState {
  statuses: Record<string, MQTTStatus>;
  setStatus: (connectionId: string, status: MQTTStatus) => void;
  clear: (connectionId: string) => void;
  reset: () => void;
}

export const useMeshcoreMqttFeedStatusStore = create<MeshcoreMqttFeedStatusState>((set) => ({
  statuses: {},
  setStatus: (connectionId, status) => {
    set((state) =>
      state.statuses[connectionId] === status
        ? state
        : { statuses: { ...state.statuses, [connectionId]: status } },
    );
  },
  clear: (connectionId) => {
    set((state) => {
      if (!(connectionId in state.statuses)) return state;
      return {
        statuses: Object.fromEntries(
          Object.entries(state.statuses).filter(([id]) => id !== connectionId),
        ),
      };
    });
  },
  reset: () => {
    set({ statuses: {} });
  },
}));

/**
 * Status-bar aggregate: connected if any broker is up, then connecting, then error. Chat send
 * availability still checks the chat connection alone.
 */
/** True when the chat broker or any analyzer feed can accept packet-log publishes. */
export function isMeshcoreMqttPublishEligible(): boolean {
  return (
    aggregateMeshcoreMqttStatus(useMeshcoreMqttFeedStatusStore.getState().statuses) === 'connected'
  );
}

export function aggregateMeshcoreMqttStatus(statuses: Record<string, MQTTStatus>): MQTTStatus {
  const values = Object.values(statuses);
  if (values.includes('connected')) return 'connected';
  if (values.includes('connecting')) return 'connecting';
  if (values.includes('error')) return 'error';
  return 'disconnected';
}
