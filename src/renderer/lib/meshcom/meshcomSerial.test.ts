import { describe, expect, it } from 'vitest';

import {
  encodeMeshcomSerialLine,
  meshcomNetConsoleSendText,
  MeshcomSerialLineBuffer,
  meshcomSerialSendText,
} from './meshcomSerial';

describe('meshcomSerial encode/decode', () => {
  it('encodeMeshcomSerialLine CRLF-terminates commands', () => {
    const bytes = encodeMeshcomSerialLine('--info');
    expect(new TextDecoder().decode(bytes)).toBe('--info\r\n');
  });

  it('meshcomSerialSendText frames directed and group traffic', () => {
    const directed = new TextDecoder().decode(meshcomSerialSendText('OE1ABC-1', 'hello'));
    expect(directed).toBe('{OE1ABC-1}hello\r\n');
    const group = new TextDecoder().decode(meshcomSerialSendText('*', 'all'));
    expect(group).toBe('all\r\n');
  });

  it('meshcomNetConsoleSendText uses :: console inject framing', () => {
    expect(new TextDecoder().decode(meshcomNetConsoleSendText('*', 'hi'))).toBe('::hi\r\n');
    expect(new TextDecoder().decode(meshcomNetConsoleSendText('260', 'hi'))).toBe('::{260}hi\r\n');
    expect(new TextDecoder().decode(meshcomNetConsoleSendText('OE1ABC-1', 'hi'))).toBe(
      '::{OE1ABC-1}hi\r\n',
    );
  });

  it('meshcomSerialSendText truncates body to 160-byte address+body budget', () => {
    // `{260}` is 5 bytes → 155 body max
    const framed = new TextDecoder().decode(meshcomSerialSendText('260', 'a'.repeat(200)));
    expect(framed).toBe(`{260}${'a'.repeat(155)}\r\n`);
  });

  it('MeshcomSerialLineBuffer splits CRLF chunks', () => {
    const buf = new MeshcomSerialLineBuffer();
    expect(buf.push('line1\r\nline2')).toEqual(['line1']);
    expect(buf.push('\r\nline3\n')).toEqual(['line2', 'line3']);
  });
});
