import { useCallback, useMemo } from 'react';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { meshcoreConnectionType, protocolTransportParams } from '../lib/protocolTransportParams';
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

/**
 * RF connect: `ConnectionDriver` opens the transport; legacy hooks attach wire listeners,
 * configure/initConn, and reconnect state ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
export function useProtocolConnect(meshtastic: UseDeviceReturn, meshcore: UseMeshCoreReturn) {
  const driverConnect = useConnect();

  return useCallback(
    async (
      protocol: MeshProtocol,
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
    ) => {
      const params = protocolTransportParams(protocol, type, {
        httpAddress,
        blePeripheralId,
      });

      if (protocol === 'meshcore') {
        const mcType = meshcoreConnectionType(type);
        await meshcore.prepareRfConnect(mcType);
        try {
          const identityId = await driverConnect('meshcore', params);
          await meshcore.attachRfSession(identityId, mcType);
        } catch (err) {
          await meshcore.handleRfConnectFailure(mcType);
          throw err;
        }
        return;
      }

      await meshtastic.prepareRfConnect(type, httpAddress, blePeripheralId);
      try {
        const identityId = await driverConnect('meshtastic', params);
        await meshtastic.attachRfSession(identityId, type);
      } catch (err) {
        await meshtastic.handleRfConnectFailure();
        throw err;
      }
    },
    [meshtastic, meshcore, driverConnect],
  );
}

/** RF disconnect: legacy session cleanup, then driver transport teardown. */
export function useProtocolDisconnect(meshtastic: UseDeviceReturn, meshcore: UseMeshCoreReturn) {
  const driverDisconnect = useDisconnect();

  return useCallback(
    async (protocol: MeshProtocol) => {
      const identityId = getIdentityIdForProtocol(protocol);
      if (protocol === 'meshcore') {
        await meshcore.finalizeDriverDisconnect();
      } else {
        await meshtastic.finalizeDriverDisconnect();
      }
      if (identityId) {
        await driverDisconnect(identityId);
      }
    },
    [meshtastic, meshcore, driverDisconnect],
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
