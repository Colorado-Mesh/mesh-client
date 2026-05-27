import { useMemo } from 'react';

import type { DeviceState, IdentityId, MQTTStatus } from '../lib/types';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import type { UseDeviceReturn, UseMeshCoreReturn } from './legacyHookTypes';

function deviceStateFromStore(
  record: ConnectionRecord,
  legacy: UseDeviceReturn | UseMeshCoreReturn,
): DeviceState {
  return {
    status: record.status,
    connectionLoss: legacy.state.connectionLoss,
    myNodeNum: record.myNodeNum > 0 ? record.myNodeNum : legacy.state.myNodeNum,
    connectionType: record.connectionType ?? legacy.state.connectionType,
    reconnectAttempt: record.reconnectAttempt ?? legacy.state.reconnectAttempt,
    lastDataReceived: record.lastDataReceivedAt?.getTime() ?? legacy.state.lastDataReceived,
    firmwareVersion: record.firmwareVersion ?? legacy.state.firmwareVersion,
    manufacturerModel: record.manufacturerModel ?? legacy.state.manufacturerModel,
    batteryPercent: record.batteryPercent ?? legacy.state.batteryPercent,
    batteryCharging: record.batteryCharging ?? legacy.state.batteryCharging,
  };
}

/**
 * Merges identity-scoped connection store reads with legacy hook state. Legacy remains
 * authoritative for `connectionLoss` until fully mirrored in the store.
 */
export function useLegacyConnectionView(
  identityId: IdentityId | null,
  legacy: UseDeviceReturn | UseMeshCoreReturn,
): { state: DeviceState; mqttStatus: MQTTStatus } {
  const storeConn = useConnectionStore((s) =>
    identityId ? (s.connections[identityId] ?? null) : null,
  );

  return useMemo(() => {
    if (!identityId || !storeConn) {
      return { state: legacy.state, mqttStatus: legacy.mqttStatus };
    }
    return {
      state: deviceStateFromStore(storeConn, legacy),
      mqttStatus: storeConn.mqttStatus ?? legacy.mqttStatus,
    };
  }, [identityId, storeConn, legacy]);
}
