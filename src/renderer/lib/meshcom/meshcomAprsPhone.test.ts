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

  it('parses ACK frames', () => {
    const frame = new Uint8Array([
      0x41, // A
      0x01,
      0x00,
      0x00,
      0x00, // msg id
      0x05, // flags
      0x78,
      0x56,
      0x34,
      0x12, // ack msg id LE
      0x01, // gateway ack
      0x00,
    ]);
    expect(parseMeshcomAprsPhoneFrame(frame)).toMatchObject({
      kind: 'ack',
      ackMsgId: 0x12345678,
      ackType: 1,
    });
  });
});
