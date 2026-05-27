import { useCallback, useMemo } from 'react';

import type { ConnectionType, DeviceState, MeshProtocol, MQTTStatus } from '../lib/types';
import type { UseDeviceReturn, UseMeshCoreReturn } from './legacyHookTypes';
import { useConnect } from './useConnect';
import { useDisconnect } from './useDisconnect';

export interface ProtocolConnectionActions {
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

function meshcoreConnectType(type: ConnectionType): 'ble' | 'serial' | 'tcp' {
  return type === 'http' ? 'tcp' : type;
}

/**
 * RF connect entry points. Delegates to legacy hooks (wire subscriptions + configure)
 * until ingest is fully driver-owned ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 * `useConnect` is retained for future driver-only paths.
 */
export function useProtocolConnect(meshtastic: UseDeviceReturn, meshcore: UseMeshCoreReturn) {
  const driverConnect = useConnect();
  void driverConnect;
  return useCallback(
    (
      protocol: MeshProtocol,
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
    ) => {
      if (protocol === 'meshcore') {
        return meshcore.connect(meshcoreConnectType(type), httpAddress, blePeripheralId);
      }
      return meshtastic.connect(type, httpAddress, blePeripheralId);
    },
    [meshtastic, meshcore],
  );
}

/** RF disconnect; legacy hooks also call {@link useDisconnect} via ConnectionDriver. */
export function useProtocolDisconnect(meshtastic: UseDeviceReturn, meshcore: UseMeshCoreReturn) {
  const driverDisconnect = useDisconnect();
  void driverDisconnect;
  return useCallback(
    (protocol: MeshProtocol) => {
      return protocol === 'meshcore' ? meshcore.disconnect() : meshtastic.disconnect();
    },
    [meshtastic, meshcore],
  );
}

export function createProtocolConnectionActions(
  protocol: MeshProtocol,
  meshtastic: UseDeviceReturn,
  meshcore: UseMeshCoreReturn,
  connect: ReturnType<typeof useProtocolConnect>,
  disconnect: ReturnType<typeof useProtocolDisconnect>,
): ProtocolConnectionActions {
  return {
    state: protocol === 'meshcore' ? meshcore.state : meshtastic.state,
    mqttStatus: protocol === 'meshcore' ? meshcore.mqttStatus : meshtastic.mqttStatus,
    connect: (type, httpAddress, blePeripheralId) =>
      connect(protocol, type, httpAddress, blePeripheralId),
    connectAutomatic: (type, httpAddress, lastSerialPortId, blePeripheralId) => {
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
    disconnect: () => disconnect(protocol),
  };
}

/** ConnectionPanel + header state for one protocol tab (injected legacy instances). */
export function useProtocolConnectionActions(
  protocol: MeshProtocol,
  meshtastic: UseDeviceReturn,
  meshcore: UseMeshCoreReturn,
): ProtocolConnectionActions {
  const connect = useProtocolConnect(meshtastic, meshcore);
  const disconnect = useProtocolDisconnect(meshtastic, meshcore);

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

  const connectForProtocol = useCallback(
    (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) =>
      connect(protocol, type, httpAddress, blePeripheralId),
    [connect, protocol],
  );

  const disconnectForProtocol = useCallback(() => disconnect(protocol), [disconnect, protocol]);

  return useMemo(
    () => ({
      state: protocol === 'meshcore' ? meshcore.state : meshtastic.state,
      mqttStatus: protocol === 'meshcore' ? meshcore.mqttStatus : meshtastic.mqttStatus,
      connect: connectForProtocol,
      connectAutomatic,
      disconnect: disconnectForProtocol,
    }),
    [
      protocol,
      meshtastic.state,
      meshcore.state,
      meshtastic.mqttStatus,
      meshcore.mqttStatus,
      connectForProtocol,
      connectAutomatic,
      disconnectForProtocol,
    ],
  );
}
