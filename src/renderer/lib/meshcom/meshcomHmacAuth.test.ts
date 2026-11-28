import { describe, expect, it } from 'vitest';

import {
  isMeshcomAuthHmacResponse,
  MESHCOM_AUTH_MAX_LINE_BYTES,
  meshcomAuthHmacHex,
  MeshcomAuthLineBuffer,
  parseMeshcomAuthGreeting,
} from './meshcomHmacAuth';

describe('parseMeshcomAuthGreeting', () => {
  it('parses OK / FAIL / NONCE', () => {
    expect(parseMeshcomAuthGreeting('OK')).toEqual({ kind: 'ok' });
    expect(parseMeshcomAuthGreeting('OK\r')).toEqual({ kind: 'ok' });
    expect(parseMeshcomAuthGreeting('FAIL')).toEqual({ kind: 'fail' });
    expect(parseMeshcomAuthGreeting('NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b36')).toEqual({
      kind: 'nonce',
      nonceHex: '3e62d1be9d352ffcbd2edcc5cfa07b36',
    });
  });

  it('returns unknown for other lines', () => {
    expect(parseMeshcomAuthGreeting('MeshCom Console')).toMatchObject({ kind: 'unknown' });
  });
});

describe('meshcomAuthHmacHex', () => {
  it('matches the ICSSW Python helper for a known vector', async () => {
    // hmac.new(b'random-secret', bytes.fromhex(nonce), hashlib.sha256).hexdigest()
    const nonce = '3e62d1be9d352ffcbd2edcc5cfa07b36';
    const expected = 'bcaea8e7659cacd9a56680214741530c9e369f943f53914bbb49a840f8f3e563';
    const hex = await meshcomAuthHmacHex('random-secret', nonce);
    expect(hex).toBe(expected);
    expect(isMeshcomAuthHmacResponse(hex)).toBe(true);
  });

  it('normalizes uppercase nonce hex to the same digest', async () => {
    const nonce = '3e62d1be9d352ffcbd2edcc5cfa07b36';
    const lower = await meshcomAuthHmacHex('random-secret', nonce);
    expect(await meshcomAuthHmacHex('random-secret', nonce.toUpperCase())).toBe(lower);
  });

  it('rejects bad nonce length', async () => {
    await expect(meshcomAuthHmacHex('x', 'abcd')).rejects.toThrow(/32 hex/);
  });
});

describe('MeshcomAuthLineBuffer', () => {
  it('splits CRLF lines across chunks', () => {
    const buf = new MeshcomAuthLineBuffer();
    expect(buf.push('NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b').map((l) => l.text)).toEqual([]);
    expect(buf.push('36\r\n').map((l) => l.text)).toEqual([
      'NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b36\r',
    ]);
    expect(buf.push('OK\n').map((l) => l.text)).toEqual(['OK']);
  });

  it('discards an oversized line in full so a suffix cannot become a greeting', () => {
    const buf = new MeshcomAuthLineBuffer();
    const huge = 'X'.repeat(MESHCOM_AUTH_MAX_LINE_BYTES + 1);
    expect(buf.push(`${huge}\nOK\n`).map((l) => l.text)).toEqual(['OK']);
  });

  it('keeps raw bytes after OK even when they exceed the auth line cap', () => {
    const buf = new MeshcomAuthLineBuffer();
    const kiss = new Uint8Array(MESHCOM_AUTH_MAX_LINE_BYTES + 40);
    kiss[0] = 0xc0;
    kiss[kiss.length - 1] = 0x7e;
    const chunk = new Uint8Array(3 + kiss.length);
    chunk.set(new TextEncoder().encode('OK\n'));
    chunk.set(kiss, 3);
    expect(buf.push(chunk).map((l) => l.text)).toEqual(['OK']);
    expect(Array.from(buf.takeRemainder())).toEqual(Array.from(kiss));
  });

  it('drops an oversized unfinished line before a later newline arrives', () => {
    const buf = new MeshcomAuthLineBuffer();
    buf.push('Y'.repeat(MESHCOM_AUTH_MAX_LINE_BYTES + 8));
    expect(buf.remainder()).toBe('');
    // Trailing fragment after the discarded overflow must not form OK by itself.
    expect(buf.push('OK\n').map((l) => l.text)).toEqual(['OK']);
  });
});
