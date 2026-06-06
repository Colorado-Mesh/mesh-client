import { create } from 'zustand';

import type { ConnectionType, IdentityId, MQTTStatus } from '../lib/types';
import { omitRecordKey } from './storeUtils';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'configured'
  | 'stale'
  | 'reconnecting';

export interface ConnectionRecord {
  identityId: IdentityId;
  status: ConnectionStatus;
  connectionType: ConnectionType | null;
  mqttStatus: MQTTStatus;
  /** True when the last drop was unexpected (not manual disconnect). */
  connectionLoss?: boolean;
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

interface ConnectionStoreState {
  connections: Record<IdentityId, ConnectionRecord>;
}

const defaultState: ConnectionStoreState = {
  connections: {},
};

/** Imperative store: use module-level setters and always subscribe with selectors (never bare useConnectionStore()). */
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

/** Mirrors MQTT IPC status into the identity-scoped connection store. */
export function mirrorMqttStatusToConnection(
  identityId: IdentityId | null,
  status: MQTTStatus,
): void {
  if (identityId) {
    setConnection(identityId, { mqttStatus: status });
  }
}
