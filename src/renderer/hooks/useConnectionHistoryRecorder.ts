import { useEffect, useRef } from 'react';

import {
  isConnectionHistoryProtocol,
  upsertConnectionHistory,
} from '../lib/connectionHistoryStorage';
import {
  type LastConnection,
  loadLastConnection,
  resolveLastBlePeripheralId,
  resolveLastHttpAddress,
  resolveLastSerialPortId,
} from '../lib/lastConnectionStorage';
import type { ConnectionStatus, ConnectionType, IdentityId, MeshProtocol } from '../lib/types';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';

function buildHistoryConnection(
  protocol: MeshProtocol,
  connectionType: ConnectionType,
): LastConnection | null {
  const last = loadLastConnection(protocol);
  if (last?.type === connectionType) {
    return last;
  }
  if (connectionType === 'ble') {
    const bleDeviceId = resolveLastBlePeripheralId(protocol);
    if (!bleDeviceId) return null;
    return {
      type: 'ble',
      bleDeviceId,
      bleDeviceName: last?.bleDeviceName,
      bleMac: last?.bleMac,
      bleRssi: last?.bleRssi,
    };
  }
  if (connectionType === 'serial') {
    const serialPortId = resolveLastSerialPortId(protocol);
    if (!serialPortId) return null;
    return { type: 'serial', serialPortId };
  }
  const httpAddress = resolveLastHttpAddress(protocol) ?? last?.httpAddress;
  if (!httpAddress) return null;
  return { type: connectionType, httpAddress };
}

/**
 * Protocol-independent history writer: whenever any LoRa identity reaches `configured`,
 * upsert the remembered endpoint even if ConnectionPanel is showing a different protocol.
 */
export function useConnectionHistoryRecorder(): void {
  const prevStatusByIdRef = useRef<Record<IdentityId, ConnectionStatus>>({});

  useEffect(() => {
    const sync = () => {
      const identities = useIdentityStore.getState().identities;
      const connections = useConnectionStore.getState().connections;
      for (const [rawId, rec] of Object.entries(connections)) {
        const identityId = rawId;
        const protocolType = identities[identityId]?.protocol.type;
        if (
          protocolType !== 'meshtastic' &&
          protocolType !== 'meshcore' &&
          protocolType !== 'meshcom'
        ) {
          continue;
        }
        if (!isConnectionHistoryProtocol(protocolType)) continue;
        const prev = prevStatusByIdRef.current[identityId];
        prevStatusByIdRef.current[identityId] = rec.status;
        if (rec.status !== 'configured' || prev === 'configured') continue;
        if (!rec.connectionType) continue;
        const conn = buildHistoryConnection(protocolType, rec.connectionType);
        if (!conn) continue;
        upsertConnectionHistory(protocolType, conn);
      }
    };
    sync();
    return useConnectionStore.subscribe(sync);
  }, []);
}
