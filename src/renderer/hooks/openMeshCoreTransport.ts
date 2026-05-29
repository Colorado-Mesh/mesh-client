import type { Connection } from '@liamcottle/meshcore.js';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { meshcoreTransportParams } from '../lib/meshIdentityBridge';
import type { IdentityId } from '../lib/types';

export interface OpenMeshCoreTransportResult {
  conn: Connection;
  driverIdentityId: IdentityId;
}

/**
 * Opens a MeshCore transport via `ConnectionDriver.connect` (protocol subscribe → PacketRouter).
 * Post-connect handshake (`initConn`) and hook-only listeners remain in `useMeshcoreRuntime`.
 */
export async function openMeshCoreTransport(
  type: 'ble' | 'serial' | 'tcp',
  opts: {
    blePeripheralId?: string;
    host?: string;
    portSignature?: string | null;
  },
): Promise<OpenMeshCoreTransportResult> {
  const params = meshcoreTransportParams(type, {
    peripheralId: opts.blePeripheralId,
    host: opts.host,
    portSignature: opts.portSignature ?? undefined,
  });
  const identityId = await connectionDriver.connect('meshcore', params);
  const conn = connectionDriver.getHandle(identityId);
  if (!conn) {
    await connectionDriver.disconnect(identityId).catch(() => {});
    throw new Error('[openMeshCoreTransport] ConnectionDriver.connect returned no handle');
  }
  return { conn: conn as Connection, driverIdentityId: identityId };
}
