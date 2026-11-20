/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

import { encodeMeshcomBleCommand } from '../meshcom/meshcomBleFrame';
import { emptyMeshcomDeviceSettingsAccum } from '../meshcom/meshcomDeviceSettings';
import type { MeshComConnection } from './meshcom/MeshComTransport';
import { type MeshComDeviceHandle, meshcomProtocol } from './MeshComProtocol';
import type { DomainEvent } from './Protocol';

function mockConnection(transport: MeshComDeviceHandle['transport']): {
  conn: MeshComConnection;
  writes: Uint8Array[];
} {
  const writes: Uint8Array[] = [];
  const conn: MeshComConnection = {
    transport,
    onData: null,
    onDisconnected: null,
    write: vi.fn((bytes: Uint8Array | number[]) => {
      writes.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  return { conn, writes };
}

function makeHandle(
  transport: MeshComDeviceHandle['transport'],
  conn: MeshComConnection,
): MeshComDeviceHandle {
  return {
    connection: conn,
    transport,
    operatorCallsign: 'N0CALL-1',
    callsignByNodeId: new Map(),
    kissSession: null,
    nextMsgNumber: 1,
    deviceSettings: emptyMeshcomDeviceSettingsAccum(),
    deviceSettingsWaiters: [],
  };
}

describe('MeshComProtocol serial/BLE', () => {
  it('serial subscribe parses EXTUDP JSON lines and brace-directed text', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const jsonLine = `${JSON.stringify({
      type: 'msg',
      src: 'OE1AAA-1',
      dst: '*',
      msg: 'hello udp',
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(jsonLine));
    conn.onData?.(new TextEncoder().encode('{OE1BBB-2}brace text\n'));

    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts).toHaveLength(2);
    expect(texts[0]?.payload.payload).toBe('hello udp');
    expect(texts[1]?.payload.payload).toBe('brace text');

    unsub();
  });

  it('serial sendMessage uses meshcomSerialSendText framing', async () => {
    const { conn, writes } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    handle.callsignByNodeId.set(42, 'OE1CCC-1');

    await meshcomProtocol.sendMessage(handle, { text: 'ping', destination: 42 });
    expect(writes).toHaveLength(1);
    expect(new TextDecoder().decode(writes[0])).toBe('{OE1CCC-1}ping\r\n');
  });

  it('ble sendMessage wraps with encodeMeshcomBleCommand', async () => {
    const { conn, writes } = mockConnection('ble');
    const handle = makeHandle('ble', conn);

    await meshcomProtocol.sendMessage(handle, { text: 'all call' });
    expect(writes).toEqual([encodeMeshcomBleCommand('all call')]);
  });

  it('ble subscribe routes plain console lines to device_log', () => {
    const { conn } = mockConnection('ble');
    const handle = makeHandle('ble', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const body = new TextEncoder().encode('plain ble');
    const frame = new Uint8Array(2 + body.length);
    frame[0] = frame.length;
    frame[1] = 0xa0;
    frame.set(body, 2);
    conn.onData?.(frame);

    const logs = events.filter((e) => e.type === 'device_log');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.payload.message).toBe('plain ble');
    expect(events.some((e) => e.type === 'text_message')).toBe(false);
    unsub();
  });

  it('serial console ::text becomes ALL chat; --info replies stay device_log', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    conn.onData?.(new TextEncoder().encode('::hello all\n'));
    conn.onData?.(new TextEncoder().encode('Firmware v4.0\n'));

    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.payload.payload).toBe('hello all');
    const logs = events.filter((e) => e.type === 'device_log');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.payload.message).toBe('Firmware v4.0');
    unsub();
  });

  it('BLE companion settings JSON updates handle and emits device_self_info on CONFFIN', () => {
    const { conn } = mockConnection('ble');
    const handle = makeHandle('ble', conn);
    const events: DomainEvent[] = [];
    let confFinResolved = false;
    handle.deviceSettingsWaiters.push(() => {
      confFinResolved = true;
    });
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const info = new TextEncoder().encode(
      'D{"TYP":"I","CALL":"OE1ABC-1","CTRY":"EU","BPIN":111111}',
    );
    conn.onData?.(info);
    expect(handle.deviceSettings.call).toBe('OE1ABC-1');
    expect(events.some((e) => e.type === 'device_self_info')).toBe(true);

    conn.onData?.(new TextEncoder().encode('D{"TYP":"CONFFIN"}'));
    expect(handle.deviceSettings.complete).toBe(true);
    expect(confFinResolved).toBe(true);
    unsub();
  });
});
