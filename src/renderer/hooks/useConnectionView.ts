import { useMemo } from 'react';

import type { DeviceState, IdentityId, MQTTStatus } from '../lib/types';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';

function deviceStateFromStore(record: ConnectionRecord): DeviceState {
  return {
    status: record.status,
    connectionLoss: record.connectionLoss,
    myNodeNum: record.myNodeNum,
    connectionType: record.connectionType,
    reconnectAttempt: record.reconnectAttempt,
    lastDataReceived: record.lastDataReceivedAt?.getTime(),
    firmwareVersion: record.firmwareVersion,
    deviceHasWifi: record.deviceHasWifi,
    deviceHasEthernet: record.deviceHasEthernet,
    manufacturerModel: record.manufacturerModel,
    batteryPercent: record.batteryPercent,
    batteryCharging: record.batteryCharging,
  };
}

const DISCONNECTED_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

/**
 * Identity-scoped connection reads from the connection store ([#377]).
 */
export function useConnectionView(identityId: IdentityId | null): {
  state: DeviceState;
  mqttStatus: MQTTStatus;
} {
  const storeConn = useConnectionStore((s) =>
    identityId ? (s.connections[identityId] ?? null) : null,
  );

  return useMemo(() => {
    if (!identityId || !storeConn) {
      return { state: DISCONNECTED_STATE, mqttStatus: 'disconnected' };
    }
    return {
      state: deviceStateFromStore(storeConn),
      mqttStatus: storeConn.mqttStatus ?? 'disconnected',
    };
  }, [identityId, storeConn]);
}
