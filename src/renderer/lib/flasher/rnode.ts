/**
 * RNode KISS protocol — port of liamcottle/rnode-flasher rnode.js (RNode class).
 */
import { sleepMillis } from './binaryUtils';
import { Rom } from './rom';

type CommandCallback = (response: number[]) => void;

export class RNode {
  static readonly KISS_FEND = 0xc0;
  static readonly KISS_FESC = 0xdb;
  static readonly KISS_TFEND = 0xdc;
  static readonly KISS_TFESC = 0xdd;

  static readonly CMD_FREQUENCY = 0x01;
  static readonly CMD_BANDWIDTH = 0x02;
  static readonly CMD_TXPOWER = 0x03;
  static readonly CMD_SF = 0x04;
  static readonly CMD_CR = 0x05;
  static readonly CMD_RADIO_STATE = 0x06;
  static readonly CMD_STAT_RX = 0x21;
  static readonly CMD_STAT_TX = 0x22;
  static readonly CMD_STAT_RSSI = 0x23;
  static readonly CMD_STAT_SNR = 0x24;
  static readonly CMD_BOARD = 0x47;
  static readonly CMD_PLATFORM = 0x48;
  static readonly CMD_MCU = 0x49;
  static readonly CMD_RESET = 0x55;
  static readonly CMD_RESET_BYTE = 0xf8;
  static readonly CMD_DEV_HASH = 0x56;
  static readonly CMD_FW_VERSION = 0x50;
  static readonly CMD_ROM_READ = 0x51;
  static readonly CMD_ROM_WRITE = 0x52;
  static readonly CMD_CONF_SAVE = 0x53;
  static readonly CMD_CONF_DELETE = 0x54;
  static readonly CMD_FW_HASH = 0x58;
  static readonly CMD_UNLOCK_ROM = 0x59;
  static readonly ROM_UNLOCK_BYTE = 0xf8;
  static readonly CMD_HASHES = 0x60;
  static readonly CMD_FW_UPD = 0x61;
  static readonly CMD_DISP_ROT = 0x67;
  static readonly CMD_DISP_RCND = 0x68;
  static readonly CMD_BT_CTRL = 0x46;
  static readonly CMD_BT_PIN = 0x62;
  static readonly CMD_DISP_READ = 0x66;
  static readonly CMD_DETECT = 0x08;
  static readonly DETECT_REQ = 0x73;
  static readonly DETECT_RESP = 0x46;
  static readonly RADIO_STATE_OFF = 0x00;
  static readonly RADIO_STATE_ON = 0x01;
  static readonly HASH_TYPE_TARGET_FIRMWARE = 0x01;
  static readonly HASH_TYPE_FIRMWARE = 0x02;

  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writable: WritableStream<Uint8Array>;
  private readonly callbacks = new Map<number, CommandCallback>();

  private constructor(
    private readonly serialPort: SerialPort,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writable: WritableStream<Uint8Array>,
  ) {
    this.reader = reader;
    this.writable = writable;
    void this.readLoop();
  }

  static async fromSerialPort(serialPort: SerialPort): Promise<RNode> {
    await serialPort.open({ baudRate: 115200 });
    const reader = serialPort.readable!.getReader();
    return new RNode(serialPort, reader, serialPort.writable!);
  }

  async close(): Promise<void> {
    try {
      this.reader.releaseLock();
    } catch {
      // catch-no-log-ok: reader may already be released on disconnect
    }
    try {
      await this.serialPort.close();
    } catch {
      // catch-no-log-ok: port may already be closed
    }
  }

  private async write(bytes: number[] | Uint8Array): Promise<void> {
    const writer = this.writable.getWriter();
    try {
      await writer.write(new Uint8Array(bytes));
    } finally {
      writer.releaseLock();
    }
  }

  private async readLoop(): Promise<void> {
    try {
      let buffer: number[] = [];
      let inFrame = false;
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;

        for (const byte of value) {
          if (byte === RNode.KISS_FEND) {
            if (inFrame) {
              const decodedFrame = RNode.decodeKissFrame(buffer);
              if (decodedFrame) {
                this.onCommandReceived(decodedFrame);
              } else {
                console.warn('[RNode] Invalid KISS frame ignored');
              }
              buffer = [];
            }
            inFrame = !inFrame;
          } else if (inFrame) {
            buffer.push(byte);
          }
        }
      }
    } catch (error) {
      if (error instanceof TypeError) return;
      console.error('[RNode] Serial read error', error);
    } finally {
      try {
        this.reader.releaseLock();
      } catch {
        // catch-no-log-ok: lock may already be released
      }
    }
  }

  private onCommandReceived(data: number[]): void {
    try {
      const [command, ...bytes] = data;
      if (command === undefined) return;
      const callback = this.callbacks.get(command);
      if (!callback) return;
      callback(bytes);
      this.callbacks.delete(command);
    } catch (e) {
      console.debug('[RNode] command handler failed', e);
    }
  }

  /** Exposed for unit tests. */
  static decodeKissFrame(frame: number[]): number[] | null {
    const data: number[] = [];
    let escaping = false;

    for (const byte of frame) {
      if (escaping) {
        if (byte === RNode.KISS_TFEND) {
          data.push(RNode.KISS_FEND);
        } else if (byte === RNode.KISS_TFESC) {
          data.push(RNode.KISS_FESC);
        } else {
          return null;
        }
        escaping = false;
      } else if (byte === RNode.KISS_FESC) {
        escaping = true;
      } else {
        data.push(byte);
      }
    }

    return escaping ? null : data;
  }

  /** Exposed for unit tests. */
  static createKissFrame(data: number[]): Uint8Array {
    const frame: number[] = [RNode.KISS_FEND];
    for (const byte of data) {
      if (byte === RNode.KISS_FEND) {
        frame.push(RNode.KISS_FESC, RNode.KISS_TFEND);
      } else if (byte === RNode.KISS_FESC) {
        frame.push(RNode.KISS_FESC, RNode.KISS_TFESC);
      } else {
        frame.push(byte);
      }
    }
    frame.push(RNode.KISS_FEND);
    return new Uint8Array(frame);
  }

  private async sendKissCommand(data: number[]): Promise<void> {
    await this.write(RNode.createKissFrame(data));
  }

  private sendCommand(command: number, data: number[]): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.callbacks.set(command, (response) => {
        resolve(response);
      });
      void this.sendKissCommand([command, ...data]).catch(reject);
    });
  }

  async reset(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_RESET, RNode.CMD_RESET_BYTE]);
  }

  async detect(): Promise<boolean> {
    try {
      const timeout = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          resolve(false);
        }, 2000);
      });
      const detect = this.sendCommand(RNode.CMD_DETECT, [RNode.DETECT_REQ]).then((response) => {
        const [responseByte] = response;
        return responseByte === RNode.DETECT_RESP;
      });
      return await Promise.race([detect, timeout]);
    } catch {
      // catch-no-log-ok detect failure returns false to caller
      return false;
    }
  }

  async getFirmwareVersion(): Promise<string> {
    const response = await this.sendCommand(RNode.CMD_FW_VERSION, [0x00]);
    const [majorVersion, minorVersionRaw] = response;
    let minorVersion = minorVersionRaw;
    if (minorVersion !== undefined && String(minorVersion).length === 1) {
      minorVersion = Number(`0${minorVersion}`);
    }
    return `${majorVersion}.${minorVersion}`;
  }

  async getPlatform(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_PLATFORM, [0x00]);
    return response[0] ?? 0;
  }

  async getMcu(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_MCU, [0x00]);
    return response[0] ?? 0;
  }

  async getBoard(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_BOARD, [0x00]);
    return response[0] ?? 0;
  }

  async getDeviceHash(): Promise<number[]> {
    return this.sendCommand(RNode.CMD_DEV_HASH, [0x01]);
  }

  async getTargetFirmwareHash(): Promise<number[]> {
    const response = await this.sendCommand(RNode.CMD_HASHES, [RNode.HASH_TYPE_TARGET_FIRMWARE]);
    const [, ...targetHash] = response;
    return targetHash;
  }

  async getFirmwareHash(): Promise<number[]> {
    const response = await this.sendCommand(RNode.CMD_HASHES, [RNode.HASH_TYPE_FIRMWARE]);
    const [, ...firmwareHash] = response;
    return firmwareHash;
  }

  async getRom(): Promise<number[]> {
    return this.sendCommand(RNode.CMD_ROM_READ, [0x00]);
  }

  async getFrequency(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_FREQUENCY, [0x00, 0x00, 0x00, 0x00]);
    return (
      ((response[0] ?? 0) << 24) |
      ((response[1] ?? 0) << 16) |
      ((response[2] ?? 0) << 8) |
      (response[3] ?? 0)
    );
  }

  async getBandwidth(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_BANDWIDTH, [0x00, 0x00, 0x00, 0x00]);
    return (
      ((response[0] ?? 0) << 24) |
      ((response[1] ?? 0) << 16) |
      ((response[2] ?? 0) << 8) |
      (response[3] ?? 0)
    );
  }

  async getTxPower(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_TXPOWER, [0xff]);
    return response[0] ?? 0;
  }

  async getSpreadingFactor(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_SF, [0xff]);
    return response[0] ?? 0;
  }

  async getCodingRate(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_CR, [0xff]);
    return response[0] ?? 0;
  }

  async getRadioState(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_RADIO_STATE, [0xff]);
    return response[0] ?? 0;
  }

  async getRxStat(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_STAT_RX, [0x00]);
    return (
      ((response[0] ?? 0) << 24) |
      ((response[1] ?? 0) << 16) |
      ((response[2] ?? 0) << 8) |
      (response[3] ?? 0)
    );
  }

  async getTxStat(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_STAT_TX, [0x00]);
    return (
      ((response[0] ?? 0) << 24) |
      ((response[1] ?? 0) << 16) |
      ((response[2] ?? 0) << 8) |
      (response[3] ?? 0)
    );
  }

  async getRssiStat(): Promise<number> {
    const response = await this.sendCommand(RNode.CMD_STAT_RSSI, [0x00]);
    return response[0] ?? 0;
  }

  async disableBluetooth(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_BT_CTRL, 0x00]);
  }

  async enableBluetooth(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_BT_CTRL, 0x01]);
  }

  async startBluetoothPairing(pinCallback: (pin: number) => void): Promise<void> {
    this.callbacks.set(RNode.CMD_BT_PIN, (response) => {
      const pin =
        ((response[0] ?? 0) << 24) |
        ((response[1] ?? 0) << 16) |
        ((response[2] ?? 0) << 8) |
        (response[3] ?? 0);
      pinCallback(pin);
    });
    await this.sendKissCommand([RNode.CMD_BT_CTRL, 0x02]);
  }

  async readDisplay(): Promise<number[]> {
    return this.sendCommand(RNode.CMD_DISP_READ, [0x01]);
  }

  async saveConfig(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_CONF_SAVE, 0x00]);
  }

  async deleteConfig(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_CONF_DELETE, 0x00]);
  }

  async setFirmwareHash(hash: number[]): Promise<void> {
    await this.sendKissCommand([RNode.CMD_FW_HASH, ...hash]);
  }

  async writeRom(address: number, value: number): Promise<void> {
    await this.sendKissCommand([RNode.CMD_ROM_WRITE, address, value]);
    await sleepMillis(85);
  }

  async wipeRom(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_UNLOCK_ROM, RNode.ROM_UNLOCK_BYTE]);
    await sleepMillis(30000);
  }

  async getRomAsObject(): Promise<Rom> {
    const rom = await this.getRom();
    return new Rom(rom);
  }

  async setDisplayRotation(rotation: number): Promise<void> {
    await this.sendKissCommand([RNode.CMD_DISP_ROT, rotation & 0xff]);
  }

  async startDisplayReconditioning(): Promise<void> {
    await this.sendKissCommand([RNode.CMD_DISP_RCND, 0x01]);
  }
}
