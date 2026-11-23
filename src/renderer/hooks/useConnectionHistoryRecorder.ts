import { useEffect, useRef } from 'react';

import {
  isConnectionHistoryProtocol,
  isValidLastConnectionForHistory,
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
  const rawLast = loadLastConnection(protocol);
  const last = rawLast && isValidLastConnectionForHistory(rawLast) ? rawLast : null;
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
  // Prefer dedicated resolver; never read httpAddress from an invalid lastConnection.
  const httpAddress = resolveLastHttpAddress(protocol);
  if (!httpAddress || typeof httpAddress !== 'string') return null;
  return { type: connectionType, httpAddress };
}

/**
 * Protocol-independent history writer: whenever any LoRa identity reaches `configured`,
 * upsert the remembered endpoint even if ConnectionPanel shows a different protocol.
 */
export function useConnectionHistoryRecorder(): void {
  const prevStatusByIdRef = useRef<Record<IdentityId, ConnectionStatus>>({});

  useEffect(() => {
    const sync = () => {
      const identities = useIdentityStore.getState().identities;
      const connections = useConnectionStore.getState().connections;
      const seen = new Set<IdentityId>();
      for (const [rawId, rec] of Object.entries(connections)) {
        const identityId = rawId;
        seen.add(identityId);
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
      const retained: Record<IdentityId, ConnectionStatus> = {};
      for (const [id, status] of Object.entries(prevStatusByIdRef.current)) {
        if (seen.has(id)) retained[id] = status;
      }
      prevStatusByIdRef.current = retained;
    };
    sync();
    return useConnectionStore.subscribe(sync);
  }, []);
}
