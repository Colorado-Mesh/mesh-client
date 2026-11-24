import { describe, expect, it } from 'vitest';

import { MESHCOM_EXTUDP_PORT, MESHCOM_MAX_MSG_ID_LEN } from '@/shared/meshcomConstants';

import { parseMeshcomExtUdp, serializeMeshcomExtUdp } from './meshcomExtUdpCodec';

describe('meshcomExtUdpCodec', () => {
  it('exports the shared EXTUDP port', () => {
    expect(MESHCOM_EXTUDP_PORT).toBe(1799);
  });

  it('truncates EXTUDP msg by UTF-8 bytes, not UTF-16 code units', () => {
    const emoji = '😀'.repeat(80);
    const json = JSON.parse(serializeMeshcomExtUdp({ type: 'msg', dst: '*', msg: emoji }));
    expect(new TextEncoder().encode(json.msg).length).toBeLessThanOrEqual(150);
    expect(json.msg.length).toBeLessThan(emoji.length);
  });

  it('serializes outbound msg and tele', () => {
    expect(JSON.parse(serializeMeshcomExtUdp({ type: 'msg', dst: 'DH1FR-1', msg: 'hi' }))).toEqual({
      type: 'msg',
      dst: 'DH1FR-1',
      msg: 'hi',
    });
    expect(JSON.parse(serializeMeshcomExtUdp({ type: 'tele', temp: 21.5 }))).toEqual({
      type: 'tele',
      temp: 21.5,
    });
  });

  it('parses inbound msg and pos JSON', () => {
    const msg = parseMeshcomExtUdp(
      JSON.stringify({
        type: 'msg',
        src: 'DH1FR-2,OE1ABC-1',
        dst: '*',
        msg: 'hello',
        rssi: -90,
        snr: 5,
      }),
    );
    expect(msg).toMatchObject({ type: 'msg', dst: '*', msg: 'hello' });

    const pos = parseMeshcomExtUdp(
      JSON.stringify({
        type: 'pos',
        src: 'DH1FR-2',
        lat: 48.2,
        lat_dir: 'N',
        long: 16.3,
        long_dir: 'E',
        alt: 200,
        batt: 90,
      }),
    );
    expect(pos).toMatchObject({ type: 'pos', src: 'DH1FR-2', lat: 48.2, long: 16.3 });
  });

  it('parses inbound tele', () => {
    const tele = parseMeshcomExtUdp(
      JSON.stringify({
        type: 'tele',
        src: 'OE1WX-1',
        temp: 19.2,
        hum: 44,
        co2: 401,
      }),
    );
    expect(tele).toMatchObject({ type: 'tele', temp: 19.2, hum: 44, co2: 401 });
  });

  it('aliases firmware outbound tele keys temp1/qfe/gas', () => {
    const tele = parseMeshcomExtUdp(
      JSON.stringify({
        type: 'tele',
        src: 'SP2ONG-1',
        src_type: 'lora',
        temp1: 19.5,
        temp2: 0,
        hum: 43.1,
        qfe: 997.9,
        qnh: 1006.0,
        gas: 12.5,
        co2: 0,
        batt: 70,
      }),
    );
    expect(tele).toMatchObject({
      type: 'tele',
      temp: 19.5,
      temp2: 0,
      hum: 43.1,
      press: 997.9,
      qnh: 1006.0,
      gasres: 12.5,
      co2: 0,
      batt: 70,
    });
  });

  it('clamps oversized msg fields on inbound parse', () => {
    const longMsg = 'x'.repeat(200);
    const parsed = parseMeshcomExtUdp(
      JSON.stringify({ type: 'msg', src: 'ABCDEFGH', dst: 'DESTTOOLONG', msg: longMsg }),
    );
    expect(parsed?.type).toBe('msg');
    if (parsed?.type === 'msg') {
      expect(parsed.msg.length).toBe(150);
      expect(parsed.dst.length).toBeLessThanOrEqual(9);
    }
  });

  it('clamps oversized msg_id before emit/store key use', () => {
    const hugeId = 'm'.repeat(MESHCOM_MAX_MSG_ID_LEN + 40_000);
    const parsed = parseMeshcomExtUdp(
      JSON.stringify({
        type: 'msg',
        src: 'OE1AAA-1',
        dst: '*',
        msg: 'hi',
        msg_id: hugeId,
        src_type: 'x'.repeat(200),
        fw_sub: 'y'.repeat(200),
      }),
    );
    expect(parsed?.type).toBe('msg');
    if (parsed?.type === 'msg') {
      expect(parsed.msg_id).toHaveLength(MESHCOM_MAX_MSG_ID_LEN);
      expect(parsed.src_type).toHaveLength(64);
      expect(parsed.fw_sub).toHaveLength(64);
    }
  });

  it('returns null for invalid JSON', () => {
    expect(parseMeshcomExtUdp('not-json')).toBeNull();
    expect(parseMeshcomExtUdp('{"type":"msg"}')).toBeNull();
  });
});
