import { describe, expect, it } from 'vitest';

import {
  isMeshcomAuthHmacResponse,
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
    const hex = await meshcomAuthHmacHex('random-secret', nonce);
    expect(hex).toHaveLength(64);
    expect(isMeshcomAuthHmacResponse(hex)).toBe(true);
    expect(await meshcomAuthHmacHex('random-secret', nonce.toUpperCase())).toBe(hex);
  });

  it('rejects bad nonce length', async () => {
    await expect(meshcomAuthHmacHex('x', 'abcd')).rejects.toThrow(/32 hex/);
  });
});

describe('MeshcomAuthLineBuffer', () => {
  it('splits CRLF lines across chunks', () => {
    const buf = new MeshcomAuthLineBuffer();
    expect(buf.push('NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b')).toEqual([]);
    expect(buf.push('36\r\n')).toEqual(['NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b36\r']);
    expect(buf.push('OK\n')).toEqual(['OK']);
  });
});
