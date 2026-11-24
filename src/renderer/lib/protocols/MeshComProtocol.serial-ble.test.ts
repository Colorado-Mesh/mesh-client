/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/meshcomConstants', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('@/shared/meshcomConstants')>();
  return {
    ...actual,
    // Shrink caps in this file so eviction / text clamp tests stay fast.
    MESHCOM_CONTACT_CAP_DEFAULT: 3,
    MESHCOM_MAX_TEXT_LEN: 32,
  };
});

import { MESHCOM_MAX_TEXT_LEN } from '@/shared/meshcomConstants';

import { kissSlipEncode } from '../meshcom/kissSlip';
import { encodeMeshcomBleCommand } from '../meshcom/meshcomBleFrame';
import { emptyMeshcomDeviceSettingsAccum } from '../meshcom/meshcomDeviceSettings';
import { composeMeshcomFirmwareMsgId } from '../meshcom/meshcomFwMsgId';
import { MESHCOM_KISS_TYPE_TX_RESULT, MeshcomKissSession } from '../meshcom/meshcomKissCodec';
import type { MeshComConnection } from './meshcom/MeshComTransport';
import { type MeshComDeviceHandle, meshcomProtocol } from './MeshComProtocol';
import type { DomainEvent } from './Protocol';

function wrapKiss(type: number, body: Uint8Array): Uint8Array {
  const payload = new Uint8Array(1 + body.length);
  payload[0] = type;
  payload.set(body, 1);
  return kissSlipEncode(payload);
}

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
  opts?: { operatorCallsign?: string },
): MeshComDeviceHandle {
  return {
    connection: conn,
    transport,
    operatorCallsign: opts?.operatorCallsign ?? 'N0CALL-1',
    callsignByNodeId: new Map(),
    kissSession: null,
    nextMsgNumber: 1,
    firmwareMsgSeq: 1,
    firmwareGwIdPrefix: null,
    kissTxWaiters: new Map(),
    deviceSettings: emptyMeshcomDeviceSettingsAccum(),
    deviceSettingsWaiters: [],
    recentOutbound: [],
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
    expect(texts[1]?.payload.from).toBeGreaterThan(0);
    expect(texts[1]?.payload.to).toBe(0xffffffff);

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

  it('clamps oversized serial :: chat and device_log before emit', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const huge = 'z'.repeat(MESHCOM_MAX_TEXT_LEN + 200);
    conn.onData?.(new TextEncoder().encode(`::${huge}\n`));
    conn.onData?.(new TextEncoder().encode(`${huge}\n`));

    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.payload.payload).toHaveLength(MESHCOM_MAX_TEXT_LEN);
    const logs = events.filter((e) => e.type === 'device_log');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.payload.message).toHaveLength(MESHCOM_MAX_TEXT_LEN);
    unsub();
  });

  it('evicts oldest callsignByNodeId entries at the contact cap', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const unsub = meshcomProtocol.subscribe(handle, () => {});

    for (const call of ['AA1AA-1', 'BB1BB-1', 'CC1CC-1', 'DD1DD-1']) {
      conn.onData?.(new TextEncoder().encode(`{${call}}hi\n`));
    }

    expect(handle.callsignByNodeId.size).toBe(3);
    const values = [...handle.callsignByNodeId.values()];
    expect(values).not.toContain('AA1AA-1');
    expect(values).toEqual(expect.arrayContaining(['BB1BB-1', 'CC1CC-1', 'DD1DD-1']));
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

    // Firmware pads notifies with trailing NULs (blelen+2); parse must still ingest.
    const infoBody =
      'D{"TYP":"I","CALL":"OE1ABC-1","CTRY":"EU","BPIN":111111,"BATP":81,"BATV":4.05}';
    const info = new Uint8Array(infoBody.length + 2);
    info.set(new TextEncoder().encode(infoBody), 0);
    conn.onData?.(info);
    expect(handle.deviceSettings.call).toBe('OE1ABC-1');
    expect(handle.deviceSettings.battPercent).toBe(81);
    expect(events.some((e) => e.type === 'device_self_info')).toBe(true);
    const battTelemetry = events.filter((e) => e.type === 'telemetry');
    expect(battTelemetry.some((e) => e.payload.batteryLevel === 81)).toBe(true);

    conn.onData?.(
      new TextEncoder().encode('D{"TYP":"W","TEMP":20.1,"HUM":40,"PRES":1010,"CO2":400}'),
    );
    expect(handle.deviceSettings.temperatureC).toBe(20.1);
    expect(events.some((e) => e.type === 'telemetry' && e.payload.temperature === 20.1)).toBe(true);

    conn.onData?.(new TextEncoder().encode('D{"TYP":"CONFFIN"}'));
    expect(handle.deviceSettings.complete).toBe(true);
    expect(confFinResolved).toBe(true);
    unsub();
  });

  it('EXTUDP tele frames emit telemetry DomainEvents', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const tele = `${JSON.stringify({
      type: 'tele',
      src: 'OE1WX-1',
      temp: 18.2,
      hum: 60,
      press: 1005,
      batt: 55,
      gasres: 90000,
      co2: 450,
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(tele));

    const telemetry = events.filter((e) => e.type === 'telemetry');
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.payload).toMatchObject({
      batteryLevel: 55,
      temperature: 18.2,
      relativeHumidity: 60,
      barometricPressure: 1005,
      gasResistance: 90000,
      co2: 450,
    });
    unsub();
  });

  it('EXTUDP tele temp2 fills temperature when temp is absent', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const tele = `${JSON.stringify({
      type: 'tele',
      src: 'OE1WX-2',
      temp2: 21.5,
      hum: 55,
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(tele));

    const telemetry = events.filter((e) => e.type === 'telemetry');
    expect(telemetry[0]?.payload.temperature).toBe(21.5);
    unsub();
  });

  it('EXTUDP firmware tele temp1 wins over outdoor temp2=0', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const tele = `${JSON.stringify({
      type: 'tele',
      src: 'SP2ONG-1',
      temp1: 19.5,
      temp2: 0,
      hum: 43.1,
      qfe: 997.9,
      qnh: 1006.0,
      gas: 0,
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(tele));

    const telemetry = events.filter((e) => e.type === 'telemetry');
    expect(telemetry[0]?.payload).toMatchObject({
      temperature: 19.5,
      relativeHumidity: 43.1,
      barometricPressure: 997.9,
    });
    unsub();
  });

  it('KISS TX_RESULT does not emit peer routing_ack (local TX only)', () => {
    const { conn } = mockConnection('tcp');
    const handle = makeHandle('tcp', conn);
    handle.kissSession = new MeshcomKissSession();
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    // FEND 0xF0 status=0x01 msgId LE 0x12345678 FEND
    const body = new Uint8Array([0xf0, 0x01, 0x78, 0x56, 0x34, 0x12]);
    const frame = new Uint8Array(1 + body.length + 1);
    frame[0] = 0xc0;
    frame.set(body, 1);
    frame[frame.length - 1] = 0xc0;
    conn.onData?.(frame);

    const acks = events.filter((e) => e.type === 'meshtastic_routing_ack');
    expect(acks).toHaveLength(0);
    expect(events.some((e) => e.type === 'device_log')).toBe(true);
    unsub();
  });

  it('EXTUDP pos carries firmware onto node_info', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const pos = `${JSON.stringify({
      type: 'pos',
      src: 'OE1FW-1',
      lat: 48.2,
      long: 16.3,
      alt: 200,
      batt: 70,
      hw_id: 43,
      firmware: '4.35p',
      fw_sub: 'eu',
      rssi: -80,
      snr: 6,
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(pos));

    const info = events.find((e) => e.type === 'node_info');
    expect(info?.payload).toMatchObject({
      hwModel: 'HELTEC-V3',
      firmwareVersion: '4.35p (eu)',
      altitude: 200,
      batteryLevel: 70,
      rssi: -80,
    });
    unsub();
  });

  it('EXTUDP msg to a GRC group uses positive channelIndex', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    const msg = `${JSON.stringify({
      type: 'msg',
      src: 'OE1GRP-1',
      dst: '232',
      msg: 'group cq',
      msg_id: 'g1',
    })}\r\n`;
    conn.onData?.(new TextEncoder().encode(msg));
    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts[0]?.payload.channelIndex).toBe(232);
    unsub();
  });

  it('BLE @ phone APRS text becomes text_message', () => {
    const { conn } = mockConnection('ble');
    const handle = makeHandle('ble', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    // @: msgid(4) hop path>dest:text\\0 hw mod fcs
    const body = new Uint8Array([
      0x3a,
      0x11,
      0x22,
      0x33,
      0x44,
      0x05,
      ...'OE1BLE-1'.split('').map((c) => c.charCodeAt(0)),
      0x3e,
      0x2a, // *
      0x3a,
      ...'hi ble'.split('').map((c) => c.charCodeAt(0)),
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
    ]);
    const framed = new Uint8Array(1 + body.length);
    framed[0] = 0x40;
    framed.set(body, 1);
    conn.onData?.(framed);

    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.payload.payload).toBe('hi ble');
    expect(texts[0]?.payload.channelIndex).toBe(0);
    unsub();
  });

  it('sendMessage with positive channelIndex frames a GRC group', async () => {
    const { conn, writes } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    await meshcomProtocol.sendMessage(handle, { text: 'grp', channelIndex: 20 });
    expect(new TextDecoder().decode(writes[0])).toBe('{20}grp\r\n');
  });

  it('sendMessage DM peer wins over stale positive channelIndex', async () => {
    const { conn, writes } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    handle.callsignByNodeId.set(42, 'W9GIL');

    await meshcomProtocol.sendMessage(handle, {
      text: 'dm hi',
      channelIndex: 312,
      destination: 42,
    });
    expect(new TextDecoder().decode(writes[0])).toBe('{W9GIL}dm hi\r\n');
  });

  it('BLE TYP MH updates a heard station node_info', () => {
    const { conn } = mockConnection('ble');
    const handle = makeHandle('ble', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));
    conn.onData?.(new TextEncoder().encode('D{"TYP":"MH","CALL":"OE8MH-1","RSSI":-88,"SNR":4.5}'));
    const nodes = events.filter((e) => e.type === 'node_info');
    expect(nodes.some((e) => e.payload.longName === 'OE8MH-1')).toBe(true);
    unsub();
  });

  it('TCP sendMessage waits for KISS TX_RESULT before resolving', async () => {
    const { conn, writes } = mockConnection('tcp');
    const handle = makeHandle('tcp', conn);
    handle.kissSession = new MeshcomKissSession();
    const unsub = meshcomProtocol.subscribe(handle, () => undefined);

    const pending = meshcomProtocol.sendMessage(handle, { text: 'via kiss', channelIndex: 0 });
    expect(writes).toHaveLength(1);
    expect(handle.kissTxWaiters.size).toBe(1);

    // Firmware: status 0x01 + little-endian msg id matching nextMsgNumber-1 (1).
    const body = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00]);
    conn.onData?.(wrapKiss(MESHCOM_KISS_TYPE_TX_RESULT, body));

    await expect(pending).resolves.toEqual({ packetId: 1 });
    expect(handle.kissTxWaiters.size).toBe(0);
    unsub();
  });

  it('TCP sendMessage returns firmware RF id when TX_RESULT mid differs from local msgNumber', async () => {
    const { conn, writes } = mockConnection('tcp');
    const handle = makeHandle('tcp', conn);
    handle.kissSession = new MeshcomKissSession();
    const unsub = meshcomProtocol.subscribe(handle, () => undefined);

    const pending = meshcomProtocol.sendMessage(handle, { text: 'via kiss', channelIndex: 0 });
    expect(writes).toHaveLength(1);
    expect(handle.kissTxWaiters.has(1)).toBe(true);

    const firmwareMid = composeMeshcomFirmwareMsgId(0x0a0b0c, 1);
    const body = new Uint8Array([
      0x01,
      firmwareMid & 0xff,
      (firmwareMid >> 8) & 0xff,
      (firmwareMid >> 16) & 0xff,
      (firmwareMid >> 24) & 0xff,
    ]);
    conn.onData?.(wrapKiss(MESHCOM_KISS_TYPE_TX_RESULT, body));

    await expect(pending).resolves.toEqual({ packetId: firmwareMid });
    expect(handle.kissTxWaiters.size).toBe(0);
    unsub();
  });

  it('TCP sendMessage rejects when KISS TX_RESULT is a NACK', async () => {
    const { conn } = mockConnection('tcp');
    const handle = makeHandle('tcp', conn);
    handle.kissSession = new MeshcomKissSession();
    const unsub = meshcomProtocol.subscribe(handle, () => undefined);

    const pending = meshcomProtocol.sendMessage(handle, { text: 'nope', channelIndex: 0 });
    // Reject status without msg_id — single pending waiter is settled by emitKissEvents.
    conn.onData?.(wrapKiss(MESHCOM_KISS_TYPE_TX_RESULT, new Uint8Array([0x03])));

    await expect(pending).rejects.toThrow(/KISS TX rejected status=0x3/);
    expect(handle.kissTxWaiters.size).toBe(0);
    unsub();
  });

  it('drops EXTUDP msg when src matches operatorCallsign', () => {
    const { conn } = mockConnection('udp');
    const handle = makeHandle('udp', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    conn.onData?.(
      new TextEncoder().encode(
        JSON.stringify({
          type: 'msg',
          src: 'N0CALL-1',
          dst: '999',
          msg: 'Test',
          msg_id: '42',
        }),
      ),
    );

    expect(events.filter((e) => e.type === 'text_message')).toHaveLength(0);
    expect(handle.firmwareMsgSeq).toBeGreaterThan(1);
    unsub();
  });

  it('keeps EXTUDP msg from a foreign callsign', () => {
    const { conn } = mockConnection('udp');
    const handle = makeHandle('udp', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    conn.onData?.(
      new TextEncoder().encode(
        JSON.stringify({
          type: 'msg',
          src: 'SP2ONG-1',
          dst: '*',
          msg: 'hello peer',
        }),
      ),
    );

    const texts = events.filter((e) => e.type === 'text_message');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.payload.payload).toBe('hello peer');
    unsub();
  });

  it('drops recent outbound EXTUDP echo and learns operatorCallsign when empty', async () => {
    const { conn } = mockConnection('udp');
    const handle = makeHandle('udp', conn, { operatorCallsign: '' });
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    await meshcomProtocol.sendMessage(handle, { text: 'echo me', channelIndex: 999 });
    conn.onData?.(
      new TextEncoder().encode(
        JSON.stringify({
          type: 'msg',
          src: 'SP2ONG-1',
          dst: '999',
          msg: 'echo me',
          msg_id: '7',
        }),
      ),
    );

    expect(events.filter((e) => e.type === 'text_message')).toHaveLength(0);
    expect(handle.operatorCallsign).toBe('SP2ONG-1');
    expect(events.some((e) => e.type === 'device_self_info' && e.payload.name === 'SP2ONG-1')).toBe(
      true,
    );
    unsub();
  });

  it('drops brace console line when fromCall is local operator', () => {
    const { conn } = mockConnection('serial');
    const handle = makeHandle('serial', conn);
    const events: DomainEvent[] = [];
    const unsub = meshcomProtocol.subscribe(handle, (e) => events.push(e));

    conn.onData?.(new TextEncoder().encode('{N0CALL-1}own echo\n'));

    expect(events.filter((e) => e.type === 'text_message')).toHaveLength(0);
    unsub();
  });
});
