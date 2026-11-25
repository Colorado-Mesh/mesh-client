import { useCallback, useMemo } from 'react';

import { isMeshtasticAttachSupersededError } from '../lib/meshtastic/meshtasticAttachSuperseded';
import { meshcoreConnectionType, protocolTransportParams } from '../lib/protocolTransportParams';
import type { RfConnectAutomaticFn, RfConnectFn } from '../lib/rfConnectionTypes';
import { rfConnectionTransportOpts } from '../lib/rfConnectionTypes';
import { getMeshcomSession } from '../lib/sessions/meshcomSession';
import { getMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { getMeshtasticSession } from '../lib/sessions/meshtasticSession';
import { getReticulumSession } from '../lib/sessions/reticulumSession';
import type { ConnectionType, DeviceState, MeshProtocol, MQTTStatus } from '../lib/types';
import { useConnect } from './useConnect';
import { useConnectionByProtocol } from './useConnectionByProtocol';

const INITIAL_DEVICE_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

export interface ProtocolConnectionActions {
  state: DeviceState;
  mqttStatus: MQTTStatus;
  connect: RfConnectFn;
  connectAutomatic: RfConnectAutomaticFn;
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
    serialNeedsReselect: conn.serialNeedsReselect,
  };
}

/**
 * RF connect: MeshCore uses the runtime session `connect()` (full success path including TCP
 * burst-complete deferred reconnect). Meshtastic keeps prepare → ConnectionDriver → attach
 * ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
export function useProtocolConnect(): (
  protocol: MeshProtocol,
  type: ConnectionType,
  httpAddress?: string,
  blePeripheralId?: string,
) => Promise<void> {
  const driverConnect = useConnect();

  return useCallback(
    async (
      protocol: MeshProtocol,
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
    ) => {
      if (protocol === 'meshcore') {
        // Delegate to runtime connect — do not reassemble prepare/driver/attach here (Neal OpenHop:
        // that skipped session params + TCP deferred-reconnect after #792 / burst-complete).
        const mcType = meshcoreConnectionType(type);
        await getMeshcoreSession().connect(mcType, httpAddress, blePeripheralId);
        return;
      }

      if (protocol === 'meshcom') {
        // Pass UI types through: `http` = KISS, `netconsole` = NET Console :2323.
        // Do not map via meshcomConnectionType (that collapses http→tcp for TransportParams).
        if (
          type !== 'ble' &&
          type !== 'serial' &&
          type !== 'http' &&
          type !== 'tcp' &&
          type !== 'udp' &&
          type !== 'netconsole'
        ) {
          throw new Error(`meshcom connect: unsupported type ${type}`);
        }
        await getMeshcomSession().connect(type, httpAddress, blePeripheralId);
        return;
      }

      if (protocol === 'reticulum') {
        await getReticulumSession().connect();
        return;
      }

      const params = protocolTransportParams(
        protocol,
        rfConnectionTransportOpts(type, { httpAddress, blePeripheralId }),
      );
      const meshtastic = getMeshtasticSession();
      const attemptGeneration = await meshtastic.prepareRfConnect(
        type,
        httpAddress,
        blePeripheralId,
      );
      let driverIdentityId: string | undefined;
      try {
        driverIdentityId = await driverConnect('meshtastic', params);
        await meshtastic.attachRfSession(driverIdentityId, type, undefined, attemptGeneration);
      } catch (err) {
        if (isMeshtasticAttachSupersededError(err)) {
          // Match connect/connectAutomatic: stale attach must not report failure or tear down
          // the live session. attachRfSession already left the owning device on deviceRef;
          // ConnectionDriver may still hold this attempt's handle until the owner reconnects.
          console.debug(
            '[useProtocolConnect] Meshtastic attach superseded by a newer session — skipping failure teardown',
          );
          return;
        }
        await meshtastic.handleRfConnectFailure(driverIdentityId, err);
        throw err;
      }
    },
    [driverConnect],
  );
}

/** RF disconnect: runtime session cleanup, then driver transport teardown. */
export function useProtocolDisconnect() {
  return useCallback(async (protocol: MeshProtocol) => {
    if (protocol === 'meshcore') {
      await getMeshcoreSession().finalizeDriverDisconnect({ disconnectDriver: true });
    } else if (protocol === 'meshcom') {
      await getMeshcomSession().finalizeDriverDisconnect({ disconnectDriver: true });
    } else if (protocol === 'reticulum') {
      await getReticulumSession().finalizeDriverDisconnect();
    } else {
      await getMeshtasticSession().finalizeDriverDisconnect({ disconnectDriver: true });
    }
  }, []);
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
      if (protocol === 'meshcom') {
        if (
          type !== 'ble' &&
          type !== 'serial' &&
          type !== 'http' &&
          type !== 'udp' &&
          type !== 'tcp'
        ) {
          return Promise.reject(new Error(`MeshCom connectAutomatic: unsupported type ${type}`));
        }
        return getMeshcomSession().connectAutomatic(
          type,
          httpAddress,
          lastSerialPortId ?? null,
          blePeripheralId,
        );
      }
      if (protocol === 'reticulum') {
        return getReticulumSession().connectAutomatic();
      }
      return getMeshtasticSession().connectAutomatic(
        type,
        httpAddress,
        lastSerialPortId ?? null,
        blePeripheralId,
      );
    },
    [protocol],
  ) as RfConnectAutomaticFn;

  const connectForProtocol = useCallback(
    (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) =>
      connect(protocol, type, httpAddress, blePeripheralId),
    [connect, protocol],
  ) as RfConnectFn;

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
