import { describe, expect, it } from 'vitest';

import { parseMeshcomAprsPhoneFrame } from './meshcomAprsPhone';

function buildTextFrame(opts: {
  msgId: number;
  hop: number;
  sourcePath: string;
  dest: string;
  text: string;
}): Uint8Array {
  const parts: number[] = [0x3a]; // ':'
  const id = opts.msgId >>> 0;
  parts.push(id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff);
  parts.push(opts.hop & 0x0f);
  for (const c of opts.sourcePath) parts.push(c.charCodeAt(0));
  parts.push(0x3e); // >
  for (const c of opts.dest) parts.push(c.charCodeAt(0));
  parts.push(0x3a); // second ':'
  for (const c of opts.text) parts.push(c.charCodeAt(0));
  parts.push(0x00);
  parts.push(0x01); // hw
  parts.push(0x00); // mod
  parts.push(0x00, 0x00); // fcs placeholder
  return new Uint8Array(parts);
}

describe('parseMeshcomAprsPhoneFrame', () => {
  it('parses ALL text with path hops', () => {
    const frame = buildTextFrame({
      msgId: 0x12345678,
      hop: 5,
      sourcePath: 'OE1ABC-1,OE3RLY-2',
      dest: '*',
      text: 'hello mesh',
    });
    const parsed = parseMeshcomAprsPhoneFrame(frame);
    expect(parsed).toMatchObject({
      kind: 'text',
      msgId: 0x12345678,
      sourceCall: 'OE1ABC-1',
      destCall: '*',
      channelIndex: 0,
      text: 'hello mesh',
      hopCount: 1,
    });
  });

  it('parses GRC group destination', () => {
    const frame = buildTextFrame({
      msgId: 42,
      hop: 3,
      sourcePath: 'DH1FR-1',
      dest: '232',
      text: 'group hi',
    });
    const parsed = parseMeshcomAprsPhoneFrame(frame);
    expect(parsed).toMatchObject({
      kind: 'text',
      channelIndex: 232,
      destCall: '232',
      text: 'group hi',
    });
  });

  it('parses LoRa wire relay ACK frames (12 B)', () => {
    const frame = new Uint8Array([
      0x41,
      0x01,
      0x00,
      0x00,
      0x00, // frame id
      0x85, // 0x80 | hops
      0x78,
      0x56,
      0x34,
      0x12, // acked msg id LE
      0x01,
      0x00,
    ]);
    expect(parseMeshcomAprsPhoneFrame(frame)).toMatchObject({
      kind: 'ack',
      ackMsgId: 0x12345678,
      ackType: 1,
    });
  });

  it('parses BLE phone ACK frames (`buildAckPhoneFrame`)', () => {
    const callsign = 'OE1ABC-1';
    const id = 0x00abcd42;
    const frame = new Uint8Array(7 + callsign.length);
    frame[0] = 0x41;
    frame[1] = id & 0xff;
    frame[2] = (id >> 8) & 0xff;
    frame[3] = (id >> 16) & 0xff;
    frame[4] = (id >> 24) & 0xff;
    frame[5] = 0x02;
    frame[6] = callsign.length;
    for (let i = 0; i < callsign.length; i++) {
      frame[7 + i] = callsign.charCodeAt(i);
    }
    expect(parseMeshcomAprsPhoneFrame(frame)).toMatchObject({
      kind: 'ack',
      ackMsgId: id,
      ackType: 0x02,
      attributionCall: callsign,
    });
  });
});
