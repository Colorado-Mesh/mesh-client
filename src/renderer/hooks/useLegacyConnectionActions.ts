import { useCallback, useMemo } from 'react';

import type { ConnectionType, DeviceState, MeshProtocol, MQTTStatus } from '../lib/types';
import { useDevice } from './useDevice';
import { useMeshCore } from './useMeshCore';

export interface LegacyConnectionActions {
  state: DeviceState;
  mqttStatus: MQTTStatus;
  connect: (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) => Promise<void>;
  connectAutomatic: (
    type: ConnectionType,
    httpAddress?: string,
    lastSerialPortId?: string | null,
    blePeripheralId?: string,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Legacy RF connect/disconnect for ConnectionPanel until all transports are
 * panel-driven via {@link useConnect} only ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
export function useLegacyConnectionActions(protocol: MeshProtocol): LegacyConnectionActions {
  const meshtastic = useDevice();
  const meshcore = useMeshCore();

  const connect = useCallback(
    (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) => {
      if (protocol === 'meshcore') {
        const meshType = type === 'http' ? 'tcp' : type;
        return meshcore.connect(meshType, httpAddress, blePeripheralId);
      }
      return meshtastic.connect(type, httpAddress, blePeripheralId);
    },
    [protocol, meshtastic, meshcore],
  );

  const connectAutomatic = useCallback(
    (
      type: ConnectionType,
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      if (protocol === 'meshcore') {
        const meshType = type === 'http' ? 'http' : type;
        if (meshType !== 'ble' && meshType !== 'serial' && meshType !== 'http') {
          return Promise.reject(new Error(`MeshCore connectAutomatic: unsupported type ${type}`));
        }
        return meshcore.connectAutomatic(meshType, httpAddress, lastSerialPortId ?? null);
      }
      return meshtastic.connectAutomatic(
        type,
        httpAddress,
        lastSerialPortId ?? null,
        blePeripheralId,
      );
    },
    [protocol, meshtastic, meshcore],
  );

  const disconnect = useCallback(() => {
    return protocol === 'meshcore' ? meshcore.disconnect() : meshtastic.disconnect();
  }, [protocol, meshtastic, meshcore]);

  return useMemo(
    () => ({
      state: protocol === 'meshcore' ? meshcore.state : meshtastic.state,
      mqttStatus: protocol === 'meshcore' ? meshcore.mqttStatus : meshtastic.mqttStatus,
      connect,
      connectAutomatic,
      disconnect,
    }),
    [
      protocol,
      meshtastic.state,
      meshcore.state,
      meshtastic.mqttStatus,
      meshcore.mqttStatus,
      connect,
      connectAutomatic,
      disconnect,
    ],
  );
}
