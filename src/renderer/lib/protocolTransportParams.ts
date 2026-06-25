import { meshcoreTransportParams, meshtasticTransportParams } from './meshIdentityBridge';
import type { RfConnectionTransportOpts } from './rfConnectionTypes';
import type { ConnectionType, MeshProtocol, TransportParams } from './types';

export function meshcoreConnectionType(type: ConnectionType): 'ble' | 'serial' | 'tcp' {
  return type === 'http' ? 'tcp' : type;
}

/** Build {@link TransportParams} for {@link ConnectionDriver.connect} from UI connection type. */
export function protocolTransportParams(
  protocol: MeshProtocol,
  opts: RfConnectionTransportOpts,
): TransportParams {
  if (protocol === 'meshcore') {
    const mcType = meshcoreConnectionType(opts.type);
    return meshcoreTransportParams(mcType, {
      peripheralId: opts.type === 'ble' ? opts.blePeripheralId : undefined,
      host:
        mcType === 'tcp'
          ? opts.type === 'http'
            ? (opts.httpAddress ?? 'localhost')
            : undefined
          : undefined,
      portSignature: opts.type === 'serial' ? (opts.lastSerialPortId ?? undefined) : undefined,
    });
  }
  return meshtasticTransportParams(opts.type, {
    peripheralId: opts.type === 'ble' ? opts.blePeripheralId : undefined,
    portSignature: opts.type === 'serial' ? (opts.lastSerialPortId ?? undefined) : undefined,
    host: opts.type === 'http' ? opts.httpAddress : undefined,
  });
}
