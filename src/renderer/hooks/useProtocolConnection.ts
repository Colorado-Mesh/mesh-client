import { useCallback, useMemo } from 'react';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { meshcoreConnectionType, protocolTransportParams } from '../lib/protocolTransportParams';
import { getMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { getMeshtasticSession } from '../lib/sessions/meshtasticSession';
import type { ConnectionType, DeviceState, MeshProtocol, MQTTStatus } from '../lib/types';
import { useConnect } from './useConnect';
import { useConnectionByProtocol } from './useConnectionByProtocol';
import { useDisconnect } from './useDisconnect';

const INITIAL_DEVICE_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

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

function deviceStateFromConnection(conn: ReturnType<typeof useConnectionByProtocol>): DeviceState {
  if (!conn) return INITIAL_DEVICE_STATE;
  return {
    status: conn.status,
    myNodeNum: conn.myNodeNum,
    connectionType: conn.connectionType,
    reconnectAttempt: conn.reconnectAttempt,
    lastDataReceived: conn.lastDataReceivedAt?.getTime(),
    firmwareVersion: conn.firmwareVersion,
    manufacturerModel: conn.manufacturerModel,
    batteryPercent: conn.batteryPercent,
    batteryCharging: conn.batteryCharging,
    connectionLoss: conn.connectionLoss,
  };
}

/**
 * RF connect: `ConnectionDriver` opens the transport; protocol runtime attaches wire listeners,
 * configure/initConn, and reconnect state ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
export function useProtocolConnect() {
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
        const meshcore = getMeshcoreSession();
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

      const meshtastic = getMeshtasticSession();
      await meshtastic.prepareRfConnect(type, httpAddress, blePeripheralId);
      try {
        const identityId = await driverConnect('meshtastic', params);
        await meshtastic.attachRfSession(identityId, type);
      } catch (err) {
        await meshtastic.handleRfConnectFailure();
        throw err;
      }
    },
    [driverConnect],
  );
}

/** RF disconnect: runtime session cleanup, then driver transport teardown. */
export function useProtocolDisconnect() {
  const driverDisconnect = useDisconnect();

  return useCallback(
    async (protocol: MeshProtocol) => {
      const identityId = getIdentityIdForProtocol(protocol);
      if (protocol === 'meshcore') {
        await getMeshcoreSession().finalizeDriverDisconnect();
      } else {
        await getMeshtasticSession().finalizeDriverDisconnect();
      }
      if (identityId) {
        await driverDisconnect(identityId);
      }
    },
    [driverDisconnect],
  );
}

/** ConnectionPanel + header state for one protocol tab. */
export function useProtocolConnectionActions(protocol: MeshProtocol): ProtocolConnectionActions {
  const connect = useProtocolConnect();
  const disconnect = useProtocolDisconnect();
  const storeConn = useConnectionByProtocol(protocol);

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
        return getMeshcoreSession().connectAutomatic(
          meshType,
          httpAddress,
          lastSerialPortId ?? null,
        );
      }
      return getMeshtasticSession().connectAutomatic(
        type,
        httpAddress,
        lastSerialPortId ?? null,
        blePeripheralId,
      );
    },
    [protocol],
  );

  const connectForProtocol = useCallback(
    (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) =>
      connect(protocol, type, httpAddress, blePeripheralId),
    [connect, protocol],
  );

  const disconnectForProtocol = useCallback(() => disconnect(protocol), [disconnect, protocol]);

  const state = useMemo(() => deviceStateFromConnection(storeConn), [storeConn]);

  const mqttStatus: MQTTStatus = storeConn?.mqttStatus ?? 'disconnected';

  return useMemo(
    () => ({
      state,
      mqttStatus,
      connect: connectForProtocol,
      connectAutomatic,
      disconnect: disconnectForProtocol,
    }),
    [state, mqttStatus, connectForProtocol, connectAutomatic, disconnectForProtocol],
  );
}
