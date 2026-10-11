/**
 * Regression guard for MeshCore over sidecar GATT (Nordic UART / raw companion bytes).
 *
 * meshcore.js uses two transports:
 * - SerialConnection: USB serial framing (0x3c / 0x3e + length) before companion payloads.
 * - Sidecar GATT (and historical Web Bluetooth): raw companion bytes on NUS.
 *
 * If IpcSidecarGattConnection ever subclasses SerialConnection again, the first BLE write would
 * pick up 0x3c framing and firmware will not respond — handshake timeout on all OSes.
 *
 * @see MeshCoreTransport.ts IpcSidecarGattConnection / GattOverIpc
 * @see node_modules/@liamcottle/meshcore.js/src/connection/web_ble_connection.js
 */
import { Connection, Constants, SerialConnection } from '@liamcottle/meshcore.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MeshcoreCompanionTxEchoFilter,
  patchMeshcoreCompanionTxEchoFilter,
  SYNC_NEXT_MESSAGE_ECHO_HOLD_MS,
} from './meshcoreCompanionTxEchoFilter';

class CaptureSerial extends SerialConnection {
  writes: Uint8Array[] = [];

  write(bytes: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(bytes));
    return Promise.resolve();
  }
}

/** Mirrors WebBleConnection / IpcSidecarGattConnection GattOverIpc send path. */
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

function createWaitingMessageConnection(transport: 'serial' | 'gatt') {
  const conn = transport === 'serial' ? new CaptureSerial() : new CaptureNusStyle();
  patchMeshcoreCompanionTxEchoFilter(conn);
  const receive = async (payload: Uint8Array): Promise<void> => {
    if (conn instanceof CaptureSerial) {
      await conn.onDataReceived(
        new Uint8Array([
          Constants.SerialFrameTypes.Incoming,
          payload.length & 0xff,
          payload.length >> 8,
          ...payload,
        ]),
      );
    } else {
      conn.onFrameReceived(payload);
    }
    await vi.runAllTimersAsync();
  };
  const push = async (payload: Uint8Array): Promise<void> => {
    if (conn instanceof CaptureSerial) {
      await conn.onDataReceived(
        new Uint8Array([
          Constants.SerialFrameTypes.Incoming,
          payload.length & 0xff,
          payload.length >> 8,
          ...payload,
        ]),
      );
    } else {
      conn.onFrameReceived(payload);
    }
  };
  return { conn, receive, push };
}

describe.each(['linux', 'darwin', 'win32'])('MeshCore waiting-message replies on %s', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['serial', 'gatt'] as const)('completes an empty %s message drain', async (transport) => {
    const { conn, receive } = createWaitingMessageConnection(transport);
    const completed = vi.fn();
    const pending = conn.getWaitingMessages().then(completed);

    await receive(new Uint8Array([Constants.ResponseCodes.NoMoreMessages]));

    expect(completed).toHaveBeenCalledExactlyOnceWith([]);
    await pending;
  });

  it.each(['serial', 'gatt'] as const)(
    'delivers a queued CLI reply and completes the %s message drain',
    async (transport) => {
      const { conn, receive } = createWaitingMessageConnection(transport);
      const completed = vi.fn();
      const pending = conn.getWaitingMessages().then(completed);
      const text = '03|> Test Repeater';
      const prefix = new Uint8Array([1, 2, 3, 4, 5, 6]);

      await receive(
        new Uint8Array([
          Constants.ResponseCodes.ContactMsgRecv,
          ...prefix,
          0xff,
          Constants.TxtTypes.CliData,
          1,
          0,
          0,
          0,
          ...new TextEncoder().encode(text),
        ]),
      );
      expect(completed).not.toHaveBeenCalled();
      await receive(new Uint8Array([Constants.ResponseCodes.NoMoreMessages]));

      expect(completed).toHaveBeenCalledExactlyOnceWith([
        {
          contactMessage: {
            pubKeyPrefix: prefix,
            pathLen: 0xff,
            txtType: Constants.TxtTypes.CliData,
            senderTimestamp: 1,
            text,
            snr: null,
          },
        },
      ]);
      await pending;
    },
  );

  it.each(['serial', 'gatt'] as const)(
    'drops a SyncNextMessage echo and still delivers the queued %s frame',
    async (transport) => {
      const { conn, push } = createWaitingMessageConnection(transport);
      const completed = vi.fn();
      const pending = conn.getWaitingMessages().then(completed);
      expect(conn.writes.length).toBeGreaterThan(0);

      const text = '03|> Test Repeater';
      const prefix = new Uint8Array([1, 2, 3, 4, 5, 6]);
      await push(new Uint8Array([Constants.ResponseCodes.NoMoreMessages]));
      expect(completed).not.toHaveBeenCalled();
      await push(
        new Uint8Array([
          Constants.ResponseCodes.ContactMsgRecv,
          ...prefix,
          0xff,
          Constants.TxtTypes.CliData,
          1,
          0,
          0,
          0,
          ...new TextEncoder().encode(text),
        ]),
      );
      expect(completed).not.toHaveBeenCalled();
      // meshcore.js emits on a 0ms timer. Flush that without expiring a later hold.
      await vi.advanceTimersByTimeAsync(0);
      expect(completed).not.toHaveBeenCalled();

      await push(new Uint8Array([Constants.ResponseCodes.NoMoreMessages]));
      await vi.advanceTimersByTimeAsync(SYNC_NEXT_MESSAGE_ECHO_HOLD_MS);
      await vi.runAllTimersAsync();
      expect(completed).toHaveBeenCalledExactlyOnceWith([
        {
          contactMessage: {
            pubKeyPrefix: prefix,
            pathLen: 0xff,
            txtType: Constants.TxtTypes.CliData,
            senderTimestamp: 1,
            text,
            snr: null,
          },
        },
      ]);
      await pending;
    },
  );
});

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

  it('GATT-style Connection sends raw companion bytes (no 0x3c prefix) for DeviceQuery', async () => {
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

/** Mirrors IpcSidecarGattConnection GattOverIpc + onGattFromRadio (see MeshCoreTransport.ts). */
describe('MeshCore GATT TX echo filter contract', () => {
  it('drops inbound NUS frames that echo a recent outbound companion command', () => {
    const filter = new MeshcoreCompanionTxEchoFilter();
    const onFrameReceived = vi.fn();
    const cmd = new Uint8Array([25, 0, 0]); // CMD_SEND_RAW_DATA

    const sendToRadioFrame = (data: Uint8Array) => {
      filter.noteOutbound(data);
    };
    const onGattFromRadio = (frame: Uint8Array) => {
      if (filter.isEcho(frame)) return;
      onFrameReceived(frame);
    };

    sendToRadioFrame(cmd);
    onGattFromRadio(cmd);
    expect(onFrameReceived).not.toHaveBeenCalled();

    onGattFromRadio(new Uint8Array([0])); // RESP_OK
    expect(onFrameReceived).toHaveBeenCalledTimes(1);
  });

  it('drops inbound DeviceQuery echo (code 22) via patchMeshcoreCompanionTxEchoFilter', async () => {
    const onFrameReceived = vi.fn<(frame: Uint8Array) => void>();
    const conn: {
      sendToRadioFrame(data: Uint8Array): Promise<void>;
      onFrameReceived(frame: Uint8Array): void;
    } = {
      sendToRadioFrame: async () => {},
      onFrameReceived,
    };
    patchMeshcoreCompanionTxEchoFilter(conn);

    const deviceQuery = new Uint8Array([
      Constants.CommandCodes.DeviceQuery,
      Constants.SupportedCompanionProtocolVersion,
    ]);
    await conn.sendToRadioFrame(deviceQuery);
    conn.onFrameReceived(deviceQuery);
    expect(onFrameReceived).not.toHaveBeenCalled();

    conn.onFrameReceived(new Uint8Array([0])); // RESP_OK
    expect(onFrameReceived).toHaveBeenCalledTimes(1);
  });
});
