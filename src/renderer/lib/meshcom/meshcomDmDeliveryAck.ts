import type { ConnectionType } from '../types';

/** Firmware emits peer DM delivery ACKs on BLE (0x41 phone) and KISS (ackNN). */
export function meshcomTransportSupportsDmDeliveryAck(
  transport: ConnectionType | 'udp' | null | undefined,
): boolean {
  return transport === 'ble' || transport === 'tcp';
}
