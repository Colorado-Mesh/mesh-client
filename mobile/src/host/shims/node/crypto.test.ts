import * as nodeCrypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as shim from './crypto';

describe('mobile crypto shim matches Node crypto', () => {
  it.each(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])('createHash(%s)', (alg) => {
    const a = shim
      .createHash(alg)
      .update('mesh')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex');
    const b = nodeCrypto
      .createHash(alg)
      .update('mesh')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex');
    expect(a).toBe(b);
  });

  it('createHmac(sha256)', () => {
    expect(shim.createHmac('sha256', 'k').update('v').digest('base64')).toBe(
      nodeCrypto.createHmac('sha256', 'k').update('v').digest('base64'),
    );
  });

  it.each(['aes-128-ctr', 'aes-256-ctr'])('%s streams like Node across update calls', (alg) => {
    const key = nodeCrypto.randomBytes(alg.includes('128') ? 16 : 32);
    const iv = nodeCrypto.randomBytes(16);
    const pt = nodeCrypto.randomBytes(77);
    const ref = nodeCrypto.createCipheriv(alg, key, iv);
    const expected = Buffer.concat([ref.update(pt), ref.final()]);
    const c = shim.createCipheriv(alg, key, iv);
    const out = Buffer.concat([
      c.update(pt.subarray(0, 20)) as Buffer,
      c.update(pt.subarray(20)) as Buffer,
      c.final() as Buffer,
    ]);
    expect(out.equals(expected)).toBe(true);
    const d = shim.createDecipheriv(alg, key, iv);
    expect(Buffer.concat([d.update(out) as Buffer, d.final() as Buffer]).equals(pt)).toBe(true);
  });

  it('aes-256-gcm interoperates with Node (encrypt in shim, decrypt in Node and back)', () => {
    const key = nodeCrypto.randomBytes(32);
    const iv = nodeCrypto.randomBytes(12);
    const c = shim.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([c.update('secret', 'utf8') as Buffer, c.final() as Buffer]);
    const tag = c.getAuthTag();
    const nd = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    nd.setAuthTag(tag);
    expect(Buffer.concat([nd.update(ct), nd.final()]).toString('utf8')).toBe('secret');

    const ne = nodeCrypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct2 = Buffer.concat([ne.update('back', 'utf8'), ne.final()]);
    const d = shim.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    d.setAuthTag(ne.getAuthTag());
    expect(Buffer.concat([d.update(ct2) as Buffer, d.final() as Buffer]).toString('utf8')).toBe(
      'back',
    );
  });

  it('rejects truncated GCM tags', () => {
    const d = shim.createDecipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12), {
      authTagLength: 16,
    });
    expect(() => d.setAuthTag(Buffer.alloc(8))).toThrow(/tag length/);
  });

  it('rejects a tampered GCM tag', () => {
    const key = nodeCrypto.randomBytes(32);
    const iv = nodeCrypto.randomBytes(12);
    const c = shim.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([c.update('x') as Buffer, c.final() as Buffer]);
    const tag = Buffer.from(c.getAuthTag());
    tag[0] ^= 1;
    const d = shim.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    d.setAuthTag(tag);
    d.update(ct);
    expect(() => d.final()).toThrow(/authenticate/);
  });

  it('scrypt matches Node (identity vault parameters scaled down)', async () => {
    const salt = nodeCrypto.randomBytes(16);
    const opts = { N: 1024, r: 8, p: 1 };
    const expected = nodeCrypto.scryptSync('passcode', salt, 32, opts);
    const got = await new Promise<Buffer>((resolve, reject) => {
      shim.scrypt('passcode', salt, 32, opts, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    expect(got.equals(expected)).toBe(true);
  });

  it('pbkdf2Sync matches Node', () => {
    expect(
      shim
        .pbkdf2Sync('p', 's', 1000, 32, 'sha256')
        .equals(nodeCrypto.pbkdf2Sync('p', 's', 1000, 32, 'sha256')),
    ).toBe(true);
  });

  it('randomBytes / randomInt / randomUUID / timingSafeEqual behave like Node', () => {
    expect(shim.randomBytes(70000)).toHaveLength(70000);
    for (let i = 0; i < 200; i++) {
      const n = shim.randomInt(5, 9);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThan(9);
    }
    expect(shim.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    expect(shim.timingSafeEqual(Buffer.from('ab'), Buffer.from('ab'))).toBe(true);
    expect(shim.timingSafeEqual(Buffer.from('ab'), Buffer.from('ac'))).toBe(false);
    expect(() => shim.timingSafeEqual(Buffer.from('a'), Buffer.from('ab'))).toThrow(RangeError);
  });
});
