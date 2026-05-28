/**
 * Regression guard for MeshCore over Noble IPC (Nordic UART / same as Web Bluetooth).
 *
 * meshcore.js uses two transports:
 * - SerialConnection: USB serial framing (0x3c / 0x3e + length) before companion payloads.
 * - Web Bluetooth + our Noble IPC path: raw companion bytes on NUS (see WebBleConnection).
 *
 * If IpcNobleConnection ever subclasses SerialConnection again, the first BLE write would
 * pick up 0x3c framing and firmware will not respond — handshake timeout on all OSes.
 *
 * @see useMeshCore.ts IpcNobleConnection / NobleOverIpc
 * @see node_modules/@liamcottle/meshcore.js/src/connection/web_ble_connection.js
 */
import { Connection, Constants, SerialConnection } from '@liamcottle/meshcore.js';
import { describe, expect, it, vi } from 'vitest';

import { MeshcoreCompanionTxEchoFilter } from './meshcoreCompanionTxEchoFilter';

class CaptureSerial extends SerialConnection {
  writes: Uint8Array[] = [];

  write(bytes: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(bytes));
    return Promise.resolve();
  }
}

/** Mirrors WebBleConnection / IpcNobleConnection NobleOverIpc send path. */
class CaptureNusStyle extends Connection {
  writes: Uint8Array[] = [];

  write(bytes: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(bytes));
    return Promise.resolve();
  }

  async sendToRadioFrame(data: Uint8Array): Promise<void> {
    this.emit('tx', data);
    await this.write(data);
  }

  async close(): Promise<void> {
    await Promise.resolve();
  }
}

describe('MeshCore BLE (NUS) vs USB serial framing contract', () => {
  it('SerialConnection wraps sendCommandDeviceQuery with outgoing serial frame (0x3c + len + payload)', async () => {
    const conn = new CaptureSerial();
    await conn.sendCommandDeviceQuery(Constants.SupportedCompanionProtocolVersion);

    expect(conn.writes.length).toBeGreaterThanOrEqual(1);
    const first = conn.writes[0];
    expect(first[0]).toBe(Constants.SerialFrameTypes.Outgoing);
    const payloadLen = first[1] + (first[2] << 8);
    expect(payloadLen).toBe(2);
    expect(first[3]).toBe(Constants.CommandCodes.DeviceQuery);
    expect(first[4]).toBe(Constants.SupportedCompanionProtocolVersion);
  });

  it('Web-BLE-style Connection sends raw companion bytes (no 0x3c prefix) for DeviceQuery', async () => {
    const conn = new CaptureNusStyle();
    await conn.sendCommandDeviceQuery(Constants.SupportedCompanionProtocolVersion);

    expect(conn.writes.length).toBe(1);
    const first = conn.writes[0];
    expect(first.length).toBe(2);
    expect(first[0]).toBe(Constants.CommandCodes.DeviceQuery);
    expect(first[1]).toBe(Constants.SupportedCompanionProtocolVersion);
    expect(first[0]).not.toBe(Constants.SerialFrameTypes.Outgoing);
  });
});

/** Mirrors IpcNobleConnection NobleOverIpc + onNobleBleFromRadio (see MeshCoreTransport.ts). */
describe('MeshCore Noble IPC TX echo filter contract', () => {
  it('drops inbound NUS frames that echo a recent outbound companion command', () => {
    const filter = new MeshcoreCompanionTxEchoFilter();
    const onFrameReceived = vi.fn();
    const cmd = new Uint8Array([25, 0, 0]); // CMD_SEND_RAW_DATA

    const sendToRadioFrame = (data: Uint8Array) => {
      filter.noteOutbound(data);
    };
    const onNobleBleFromRadio = (frame: Uint8Array) => {
      if (filter.isEcho(frame)) return;
      onFrameReceived(frame);
    };

    sendToRadioFrame(cmd);
    onNobleBleFromRadio(cmd);
    expect(onFrameReceived).not.toHaveBeenCalled();

    onNobleBleFromRadio(new Uint8Array([0])); // RESP_OK
    expect(onFrameReceived).toHaveBeenCalledTimes(1);
  });
});
