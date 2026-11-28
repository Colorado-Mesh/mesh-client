import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { meshtasticTransportParams } from '../lib/meshIdentityBridge';
import type { ConnectionType, IdentityId, TransportParams } from '../lib/types';

export interface OpenMeshComTransportResult {
  driverIdentityId: IdentityId;
  handle: unknown;
}

export type MeshcomOpenTransportType = 'ble' | 'serial' | 'tcp' | 'udp' | 'http' | 'netconsole';

function meshcomTransportParams(
  type: MeshcomOpenTransportType,
  opts: {
    blePeripheralId?: string;
    host?: string;
    portSignature?: string | null;
    /** When false, MeshCom serial auto paths must not open the Web Serial picker. */
    allowPortPicker?: boolean;
  },
): TransportParams {
  if (type === 'netconsole') {
    return { type: 'netconsole', host: opts.host ?? '' };
  }
  if (type === 'serial') {
    return {
      type: 'serial',
      portSignature: opts.portSignature ?? undefined,
      ...(opts.allowPortPicker === false ? { allowPortPicker: false } : {}),
    };
  }
  // KISS UI uses `'http'` like MeshCore companion TCP; map to `'tcp'` params.
  const connectionType: ConnectionType = type === 'http' ? 'tcp' : type;
  return meshtasticTransportParams(connectionType, {
    peripheralId: opts.blePeripheralId,
    host: opts.host,
    portSignature: opts.portSignature ?? undefined,
  });
}

/**
 * Opens a MeshCom transport via `ConnectionDriver.connect`.
 * When `MeshComProtocol.createDevice` / a dedicated MeshComTransport lands,
 * this remains the single open site the runtime session calls.
 */
export async function openMeshComTransport(
  type: MeshcomOpenTransportType,
  opts: {
    blePeripheralId?: string;
    host?: string;
    portSignature?: string | null;
    allowPortPicker?: boolean;
  } = {},
): Promise<OpenMeshComTransportResult> {
  const params = meshcomTransportParams(type, opts);
  const identityId = await connectionDriver.connect('meshcom', params);
  const handle = connectionDriver.getHandle(identityId);
  if (!handle) {
    await connectionDriver.disconnect(identityId).catch((e: unknown) => {
      console.debug('[openMeshComTransport] rollback disconnect ' + String(e));
    });
    throw new Error('[openMeshComTransport] ConnectionDriver.connect returned no handle');
  }
  return { driverIdentityId: identityId, handle };
}
