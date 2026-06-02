import { reconnectBleWithScan } from './bleReconnectHelper';
import { errLikeToLogString } from './errLikeToLogString';
import {
  loadLastConnection,
  resolveLastBlePeripheralId,
  resolveLastHttpAddress,
  resolveLastSerialPortId,
} from './lastConnectionStorage';
import type { ConnectionType, MeshProtocol } from './types';

const isLinuxPlatform = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');

export interface RfReconnectHandlers {
  /** Noble scan + connectAutomatic, or Web Bluetooth connectAutomatic (Linux). */
  connectBleAutomatic: (bleDeviceId: string) => Promise<void>;
  /** User-gesture BLE connect (Linux Web Bluetooth requestDevice path). */
  connectBleDirect: (bleDeviceId: string) => Promise<void>;
  connectSerialAutomatic: (serialPortId: string | null | undefined) => Promise<void>;
  connectHttp: (httpAddress: string) => Promise<void>;
}

/**
 * Manual reconnect from ConnectionBanner — restores the last RF transport type.
 * Auto-reconnect on disconnect/wake is handled separately in protocol runtimes.
 */
export async function reconnectRfFromLastConnection(
  protocol: MeshProtocol,
  connectionType: ConnectionType,
  handlers: RfReconnectHandlers,
): Promise<void> {
  const last = loadLastConnection(protocol);
  const rfType = connectionType ?? last?.type ?? 'ble';

  if (rfType === 'ble') {
    const bleDeviceId = resolveLastBlePeripheralId(protocol);
    if (!bleDeviceId) {
      throw new Error(`[rfReconnectHelper] missing BLE peripheral ID for ${protocol}`);
    }
    if (isLinuxPlatform()) {
      await handlers.connectBleDirect(bleDeviceId);
      return;
    }
    await reconnectBleWithScan(protocol, bleDeviceId, () =>
      handlers.connectBleAutomatic(bleDeviceId),
    );
    return;
  }

  if (rfType === 'serial') {
    await handlers.connectSerialAutomatic(resolveLastSerialPortId(protocol));
    return;
  }

  if (rfType === 'http') {
    const httpAddress = resolveLastHttpAddress(protocol);
    if (!httpAddress) {
      throw new Error(`[rfReconnectHelper] missing HTTP/TCP address for ${protocol}`);
    }
    await handlers.connectHttp(httpAddress);
    return;
  }

  throw new Error(`[rfReconnectHelper] unsupported connection type ${rfType}`);
}

export function logRfReconnectFailure(context: string, err: unknown): void {
  console.warn(`${context} ` + errLikeToLogString(err));
}
