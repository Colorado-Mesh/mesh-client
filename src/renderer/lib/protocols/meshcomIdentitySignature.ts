import type { TransportParams } from '../types';
import { UnsupportedOperation } from './Protocol';

/** Stable MeshCom identity key from transport params (no codec / device deps). */
export function meshcomIdentitySignature(params: TransportParams): string {
  switch (params.type) {
    case 'udp':
      return `meshcom:udp:${params.host}`;
    case 'serial':
      return `meshcom:serial:${params.portSignature ?? 'unknown'}`;
    case 'ble':
      return `meshcom:ble:${params.peripheralId ?? 'unknown'}`;
    case 'tcp':
      return `meshcom:tcp:${params.host}`;
    case 'http':
      return `meshcom:http:${params.host}`;
    case 'netconsole':
      return `meshcom:netconsole:${params.host}`;
    case 'mqtt':
      return `meshcom:mqtt:${params.broker}`;
    default: {
      const _exhaustive: never = params;
      throw new UnsupportedOperation(
        `meshcom signature for ${(_exhaustive as TransportParams).type}`,
      );
    }
  }
}
