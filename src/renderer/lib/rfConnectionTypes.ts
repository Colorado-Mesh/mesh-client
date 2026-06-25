import type { ConnectionType } from './types';

/** Transport-specific RF connect args; only the field for `type` is used. */
export type RfConnectionTransportOpts =
  | { type: 'ble'; blePeripheralId?: string }
  | { type: 'serial'; lastSerialPortId?: string | null }
  | { type: 'http'; httpAddress?: string };

export function rfConnectionTransportOpts(
  type: ConnectionType,
  fields: {
    httpAddress?: string;
    blePeripheralId?: string;
    lastSerialPortId?: string | null;
  },
): RfConnectionTransportOpts {
  switch (type) {
    case 'ble':
      return { type: 'ble', blePeripheralId: fields.blePeripheralId };
    case 'serial':
      return { type: 'serial', lastSerialPortId: fields.lastSerialPortId };
    case 'http':
      return { type: 'http', httpAddress: fields.httpAddress };
    default: {
      const _exhaustive: never = type;
      throw new Error(`rfConnectionTransportOpts: unsupported type ${String(_exhaustive)}`);
    }
  }
}

/** Type-safe RF connect; optional args are limited per transport. */
export interface RfConnectFn {
  (type: 'ble', httpAddress?: undefined, blePeripheralId?: string): Promise<void>;
  (type: 'serial', httpAddress?: undefined, blePeripheralId?: undefined): Promise<void>;
  (type: 'http', httpAddress?: string, blePeripheralId?: undefined): Promise<void>;
}

/** Type-safe auto-connect; serial stores port id, BLE stores peripheral id. */
export interface RfConnectAutomaticFn {
  (
    type: 'ble',
    httpAddress?: undefined,
    lastSerialPortId?: undefined,
    blePeripheralId?: string,
  ): Promise<void>;
  (
    type: 'serial',
    httpAddress?: undefined,
    lastSerialPortId?: string | null,
    blePeripheralId?: undefined,
  ): Promise<void>;
  (type: 'http', httpAddress?: string, lastSerialPortId?: undefined): Promise<void>;
}
