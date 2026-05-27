import { meshcoreTransportParams, meshtasticTransportParams } from './meshIdentityBridge';
import type { ConnectionType, MeshProtocol, TransportParams } from './types';

export function meshcoreConnectionType(type: ConnectionType): 'ble' | 'serial' | 'tcp' {
  return type === 'http' ? 'tcp' : type;
}

/** Build {@link TransportParams} for {@link ConnectionDriver.connect} from UI connection type. */
export function protocolTransportParams(
  protocol: MeshProtocol,
  type: ConnectionType,
  opts: {
    httpAddress?: string;
    blePeripheralId?: string;
    lastSerialPortId?: string | null;
  },
): TransportParams {
  if (protocol === 'meshcore') {
    const mcType = meshcoreConnectionType(type);
    return meshcoreTransportParams(mcType, {
      peripheralId: opts.blePeripheralId,
      host: mcType === 'tcp' ? (opts.httpAddress ?? 'localhost') : undefined,
      portSignature: opts.lastSerialPortId ?? undefined,
    });
  }
  return meshtasticTransportParams(type, {
    peripheralId: opts.blePeripheralId,
    portSignature: opts.lastSerialPortId ?? undefined,
    host: opts.httpAddress,
  });
}
