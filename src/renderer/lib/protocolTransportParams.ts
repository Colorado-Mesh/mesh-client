import {
  MESHCOM_EXTUDP_PORT,
  MESHCOM_KISS_TCP_PORT,
  MESHCOM_NETCONSOLE_PORT,
} from '@/shared/meshcomConstants';

import { meshcoreTransportParams, meshtasticTransportParams } from './meshIdentityBridge';
import type { RfConnectionTransportOpts } from './rfConnectionTypes';
import type { ConnectionType, MeshProtocol, TransportParams } from './types';

export function meshcoreConnectionType(type: ConnectionType): 'ble' | 'serial' | 'tcp' {
  if (type === 'http') return 'tcp';
  if (type === 'ble' || type === 'serial' || type === 'tcp') return type;
  throw new Error(`meshcoreConnectionType: unsupported type ${type}`);
}

/** MeshCom KISS UI uses `'http'`; NET Console uses `'netconsole'`; EXTUDP uses `'udp'`. */
export function meshcomConnectionType(
  type: ConnectionType,
): 'ble' | 'serial' | 'tcp' | 'udp' | 'netconsole' {
  switch (type) {
    case 'http':
      return 'tcp';
    case 'ble':
    case 'serial':
    case 'tcp':
    case 'udp':
    case 'netconsole':
      return type;
    default: {
      const _exhaustive: never = type;
      throw new Error(`meshcomConnectionType: unsupported type ${String(_exhaustive)}`);
    }
  }
}

function ensureHostPort(host: string, defaultPort: number): string {
  const trimmed = host.trim() || '127.0.0.1';
  if (trimmed.includes(':')) return trimmed;
  return `${trimmed}:${defaultPort}`;
}

/** Build {@link TransportParams} for {@link ConnectionDriver.connect} from UI connection type. */
export function protocolTransportParams(
  protocol: MeshProtocol,
  opts: RfConnectionTransportOpts,
): TransportParams {
  if (protocol === 'meshcore') {
    const mcType = meshcoreConnectionType(opts.type);
    const tcpHost =
      opts.type === 'http' || opts.type === 'tcp' ? (opts.httpAddress ?? 'localhost') : undefined;
    return meshcoreTransportParams(mcType, {
      peripheralId: opts.type === 'ble' ? opts.blePeripheralId : undefined,
      // http and tcp UI types both carry OpenHop/companion host in httpAddress.
      host: mcType === 'tcp' ? tcpHost : undefined,
      portSignature: opts.type === 'serial' ? (opts.lastSerialPortId ?? undefined) : undefined,
    });
  }
  if (protocol === 'meshcom') {
    const mcType = meshcomConnectionType(opts.type);
    const rawHost =
      opts.type === 'http' ||
      opts.type === 'tcp' ||
      opts.type === 'udp' ||
      opts.type === 'netconsole'
        ? (opts.httpAddress ?? '127.0.0.1')
        : undefined;
    const host =
      rawHost == null
        ? undefined
        : mcType === 'udp'
          ? ensureHostPort(rawHost, MESHCOM_EXTUDP_PORT)
          : mcType === 'tcp'
            ? ensureHostPort(rawHost, MESHCOM_KISS_TCP_PORT)
            : mcType === 'netconsole'
              ? ensureHostPort(rawHost, MESHCOM_NETCONSOLE_PORT)
              : rawHost;
    if (mcType === 'netconsole') {
      return { type: 'netconsole', host: host ?? `127.0.0.1:${MESHCOM_NETCONSOLE_PORT}` };
    }
    return meshtasticTransportParams(mcType === 'tcp' ? 'tcp' : mcType, {
      peripheralId: opts.type === 'ble' ? opts.blePeripheralId : undefined,
      host,
      portSignature: opts.type === 'serial' ? (opts.lastSerialPortId ?? undefined) : undefined,
    });
  }
  return meshtasticTransportParams(opts.type, {
    peripheralId: opts.type === 'ble' ? opts.blePeripheralId : undefined,
    portSignature: opts.type === 'serial' ? (opts.lastSerialPortId ?? undefined) : undefined,
    host: opts.type === 'http' || opts.type === 'tcp' ? opts.httpAddress : undefined,
  });
}
