import { create } from 'zustand';

import type { ConnectionStatus, ConnectionType, IdentityId, MQTTStatus } from '../lib/types';
import { omitRecordKey } from './storeUtils';

export type { ConnectionStatus };

export interface ConnectionRecord {
  identityId: IdentityId;
  status: ConnectionStatus;
  connectionType: ConnectionType | null;
  mqttStatus: MQTTStatus;
  /** True when the last drop was unexpected (not manual disconnect). */
  connectionLoss?: boolean;
  /** Serial auto-reconnect exhausted; user must pick the port again via requestPort(). */
  serialNeedsReselect?: boolean;
  /** MeshCore: reconnecting after a user-requested companion reboot (not a link failure). */
  plannedReboot?: boolean;
  reconnectAttempt: number;
  myNodeNum: number;
  lastDataReceivedAt?: Date;
  firmwareVersion?: string;
  /** Meshtastic DeviceMetadata.hasWifi — native Wi-Fi on the radio MCU/board. */
  deviceHasWifi?: boolean;
  /** Meshtastic DeviceMetadata.hasEthernet — native Ethernet on the radio. */
  deviceHasEthernet?: boolean;
  manufacturerModel?: string;
  batteryPercent?: number;
  batteryCharging?: boolean;
  queueFree?: number;
  queueMax?: number;
  // Telemetry/GPS/identity-related state previously held inside useMeshtasticRuntime.
  telemetryEnabled?: boolean;
  gpsLoading?: boolean;
  gpsIntervalMs?: number;
  /** Locally-generated identity address used by Meshtastic before the radio reports its real node num. */
  virtualNodeId?: number;
  /** Last node num seen on the RF side (distinct from MQTT-only sightings). */
  lastRfSelfNodeNum?: number;
}

export interface ConnectionStoreState {
  connections: Record<IdentityId, ConnectionRecord>;
}

const defaultState: ConnectionStoreState = {
  connections: {},
};

/**
 * Identity-scoped connection state. Writes go through `setConnection` / `removeConnection`.
 *
 * In React, subscribe with a selector so components re-render only when their slice
 * changes — e.g. `useConnectionStore((s) => (identityId ? (s.connections[identityId] ?? null) : null))`.
 * Avoid bare `useConnectionStore()` or `useConnectionStore((s) => s)`; those subscribe to the
 * whole store and re-render whenever any identity's connection record changes.
 *
 * `getState()` / `setState()` outside React (tests, drivers) is fine.
 */
export const useConnectionStore = create<ConnectionStoreState>()(() => defaultState);

export function setConnection(
  id: IdentityId,
  updates: Partial<Omit<ConnectionRecord, 'identityId'>>,
): void {
  useConnectionStore.setState((s) => {
    const existing = s.connections[id];
    const base: ConnectionRecord = existing ?? {
      identityId: id,
      status: 'disconnected',
      connectionType: null,
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 0,
    };
    return {
      connections: {
        ...s.connections,
        [id]: { ...base, ...updates, identityId: id },
      },
    };
  });
}

export function removeConnection(id: IdentityId): void {
  useConnectionStore.setState((s) => ({
    connections: omitRecordKey(s.connections, id),
  }));
}

export function getConnection(id: IdentityId): ConnectionRecord | undefined {
  return useConnectionStore.getState().connections[id];
}

/** Radio statuses that still hold a link (the Connection panel's "connected" set). */
const LINK_UP_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  'connected',
  'configured',
  'stale',
  'reconnecting',
]);

/** True while any protocol's radio or MQTT link is up, so quitting also disconnects something. */
export function selectAnyLinkUp(s: ConnectionStoreState): boolean {
  return Object.values(s.connections).some(
    (c) => LINK_UP_STATUSES.has(c.status) || c.mqttStatus === 'connected',
  );
}
