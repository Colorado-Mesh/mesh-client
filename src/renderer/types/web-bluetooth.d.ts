/**
 * Minimal Web Bluetooth API declarations for TypeScript.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
 */

interface BluetoothDevice {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  forget(): Promise<void>;
  addEventListener(type: 'gattserverdisconnected', callback: (event: Event) => void): void;
  removeEventListener(type: 'gattserverdisconnected', callback: (event: Event) => void): void;
}

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice;
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  readonly device: BluetoothDevice;
  readonly uuid: string;
  getCharacteristic(
    characteristic: BluetoothCharacteristicUUID,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  readonly service: BluetoothRemoteGATTService;
  readonly uuid: string;
  /** Chromium: max payload per `writeValue` when exposed; not in all TS DOM libs. */
  readonly maximumWriteValueLength?: number;
  readonly properties: {
    read: boolean;
    write: boolean;
    writeWithoutResponse: boolean;
    reliableWrite: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
  };
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource | Uint8Array): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(type: 'characteristicvaluechanged', callback: (event: Event) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', callback: (event: Event) => void): void;
}

interface BluetoothCharacteristicUUID {
  toString(): string;
}

interface BluetoothServiceUUID {
  toString(): string;
}

interface RequestDeviceOptions {
  filters: BluetoothLEScanFilter[];
  optionalServices?: BluetoothServiceUUID[];
}

interface BluetoothLEScanFilter {
  services?: BluetoothServiceUUID[];
  name?: string;
  namePrefix?: string;
}

interface Bluetooth extends BluetoothRendering {
  getAvailability(): Promise<boolean>;
  getDevices(): Promise<BluetoothDevice[]>;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
}

interface BluetoothRendering {
  getReferenceDevice(deviceId: string): Promise<BluetoothDevice>;
  onavailabilitychanged: ((this: BluetoothRendering, ev: Event) => unknown) | null;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
