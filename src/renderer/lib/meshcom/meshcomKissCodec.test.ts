import { describe, expect, it } from 'vitest';

import { MESHCOM_MAX_TEXT_LEN } from '@/shared/meshcomConstants';

import { kissSlipEncode } from './kissSlip';
import { buildAx25UiFrame } from './meshcomAx25';
import {
  buildMeshcomKissTxMessage,
  buildMeshcomMessageInfo,
  MESHCOM_KISS_TYPE_DATA,
  MESHCOM_KISS_TYPE_RX_META,
  MESHCOM_KISS_TYPE_SRC_INFO,
  MESHCOM_KISS_TYPE_TX_RESULT,
  MeshcomKissSession,
  parseAprsUncompressedPosition,
  parseMeshcomInfoField,
} from './meshcomKissCodec';

function wrapKiss(type: number, body: Uint8Array): Uint8Array {
  const payload = new Uint8Array(1 + body.length);
  payload[0] = type;
  payload.set(body, 1);
  return kissSlipEncode(payload);
}

describe('meshcomKissCodec', () => {
  it('parses message and position info fields', () => {
    expect(parseMeshcomInfoField(':DH1FR-1  :hello{01')).toEqual({
      kind: 'message',
      addressee: 'DH1FR-1',
      text: 'hello{01',
    });
    const oversized = parseMeshcomInfoField(`:DH1FR-1  :${'x'.repeat(MESHCOM_MAX_TEXT_LEN + 500)}`);
    expect(oversized.kind).toBe('message');
    if (oversized.kind === 'message') {
      expect(oversized.text).toHaveLength(MESHCOM_MAX_TEXT_LEN);
    }
    expect(parseMeshcomInfoField(':DH1FR-1  :ack12')).toMatchObject({
      kind: 'message',
      ackNumber: '12',
    });
    const pos = parseMeshcomInfoField('!4808.70N/01622.50E-/B=85/A=000500');
    expect(pos.kind).toBe('position');
    if (pos.kind === 'position') {
      expect(pos.latitude).toBeCloseTo(48 + 8.7 / 60, 4);
      expect(pos.longitude).toBeCloseTo(16 + 22.5 / 60, 4);
      expect(pos.batteryPercent).toBe(85);
      expect(pos.altitudeFt).toBe(500);
    }
  });

  it('parses APRS uncompressed coordinates', () => {
    const parsed = parseAprsUncompressedPosition('4903.50N/07201.75W-test');
    expect(parsed).not.toBeNull();
    expect(parsed!.latitude).toBeCloseTo(49 + 3.5 / 60, 4);
    expect(parsed!.longitude).toBeCloseTo(-(72 + 1.75 / 60), 4);
    expect(parsed!.comment).toBe('test');
  });

  it('builds TX message info and KISS frame', () => {
    expect(buildMeshcomMessageInfo('DH1FR-1', 'hi', 1)).toBe(':DH1FR-1  :hi{01');
    const framed = buildMeshcomKissTxMessage({
      operatorCallsign: 'DH1FR-7',
      destination: 'DH1FR-1',
      text: 'hi',
      msgNumber: 1,
    });
    expect(framed[0]).toBe(0xc0);
    expect(framed[framed.length - 1]).toBe(0xc0);
  });

  it('latches SrcInfo before data and RxMeta after', () => {
    const session = new MeshcomKissSession();
    const ax25 = buildAx25UiFrame({
      dest: 'APRSMC',
      src: 'OE1XYZ-15',
      info: ':DH1FR-1  :hi',
    });
    const srcInfo = wrapKiss(MESHCOM_KISS_TYPE_SRC_INFO, new TextEncoder().encode('OE1XYZ-99'));
    const data = wrapKiss(MESHCOM_KISS_TYPE_DATA, ax25);
    const meta = wrapKiss(MESHCOM_KISS_TYPE_RX_META, new Uint8Array([6, 0xd1, 0xff]));

    expect(session.pushBytes(srcInfo)).toEqual([]);
    expect(session.pushBytes(data)).toEqual([]);
    const events = session.pushBytes(meta);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'data',
      frame: {
        src: 'OE1XYZ-99',
        meta: { snr: 6, rssi: -47, gatewayRelay: false },
      },
    });
  });

  it('marks gatewayRelay when RX meta is snr=0 rssi=99', () => {
    const session = new MeshcomKissSession();
    const ax25 = buildAx25UiFrame({
      dest: 'APRSMC',
      src: 'OE1XYZ-15',
      info: ':ALL      :gw',
    });
    expect(session.pushBytes(wrapKiss(MESHCOM_KISS_TYPE_DATA, ax25))).toEqual([]);
    // rssi 99 little-endian: 0x63, 0x00
    const events = session.pushBytes(
      wrapKiss(MESHCOM_KISS_TYPE_RX_META, new Uint8Array([0, 0x63, 0x00])),
    );
    expect(events[0]).toMatchObject({
      type: 'data',
      frame: { meta: { snr: 0, rssi: 99, gatewayRelay: true } },
    });
  });

  it('parses TX result accepted with msg_id', () => {
    const session = new MeshcomKissSession();
    const body = new Uint8Array([0x01, 0x78, 0x56, 0x34, 0x12]);
    const events = session.pushBytes(wrapKiss(MESHCOM_KISS_TYPE_TX_RESULT, body));
    expect(events).toEqual([{ type: 'tx_result', result: { status: 0x01, msgId: 0x12345678 } }]);
  });

  it('flushes pending data when a non-meta frame follows', () => {
    const session = new MeshcomKissSession();
    const ax25 = buildAx25UiFrame({
      dest: 'APRSMC',
      src: 'DH1FR-2',
      info: ':ALL      :ping',
    });
    expect(session.pushBytes(wrapKiss(MESHCOM_KISS_TYPE_DATA, ax25))).toEqual([]);
    const events = session.pushBytes(wrapKiss(MESHCOM_KISS_TYPE_TX_RESULT, new Uint8Array([0x03])));
    expect(events[0]?.type).toBe('data');
    expect(events[1]).toEqual({ type: 'tx_result', result: { status: 0x03 } });
  });
});
