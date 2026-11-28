/**
 * `crypto` shim for the mobile host worker: the subset of Node crypto the main process uses,
 * implemented with @noble/hashes / @noble/ciphers (synchronous, audited, already shipped) and
 * WebCrypto randomness.
 *
 * Covered: createHash (md5/sha1/sha256/sha384/sha512), createHmac, randomBytes, randomInt,
 * randomUUID, randomFillSync, timingSafeEqual, scrypt / scryptSync, pbkdf2(Sync),
 * createCipheriv / createDecipheriv for aes-{128,256}-ctr and aes-{128,256}-gcm, webcrypto.
 * RSA key generation / X.509 (TAK certificate enrollment) are not available on mobile and throw.
 */
import { ctr, gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { scrypt as nobleScrypt } from '@noble/hashes/scrypt.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

export type BinaryLike = string | Uint8Array | ArrayBuffer | DataView;
type HashFn = typeof md5 | typeof sha256 | typeof sha384 | typeof sha512;

const HASHES: Record<string, HashFn> = {
  md5,
  sha1,
  'sha-1': sha1,
  sha256,
  'sha-256': sha256,
  sha384,
  sha512,
  'sha-512': sha512,
};

function hashFor(alg: string): HashFn {
  const h = HASHES[alg.toLowerCase()];
  if (!h) throw new Error(`Digest method not supported: ${alg}`);
  return h;
}

function toBytes(data: BinaryLike, encoding?: BufferEncoding): Uint8Array {
  if (typeof data === 'string') return Uint8Array.from(Buffer.from(data, encoding ?? 'utf8'));
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function output(bytes: Uint8Array, encoding?: BufferEncoding): Buffer | string {
  const b = Buffer.from(bytes);
  return encoding ? b.toString(encoding) : b;
}

export interface Hasher {
  update(data: Uint8Array): unknown;
  digest(): Uint8Array;
  clone(): Hasher;
}

/** Node `Hash` / `Hmac`: incremental digest with Node's encoding arguments. */
export class Hash {
  constructor(private readonly h: Hasher) {}
  update(data: BinaryLike, encoding?: BufferEncoding): this {
    this.h.update(toBytes(data, encoding));
    return this;
  }
  digest(): Buffer;
  digest(encoding: BufferEncoding): string;
  digest(encoding?: BufferEncoding): Buffer | string {
    return output(this.h.digest(), encoding);
  }
  copy(): Hash {
    return new Hash(this.h.clone());
  }
}

export function createHash(alg: string): Hash {
  return new Hash(hashFor(alg).create() as Hasher);
}

export function createHmac(alg: string, key: BinaryLike): Hash {
  return new Hash(hmac.create(hashFor(alg), toBytes(key)) as Hasher);
}

export function getHashes(): string[] {
  return Object.keys(HASHES);
}

export function getRandomValues<T extends ArrayBufferView>(arr: T): T {
  globalThis.crypto.getRandomValues(
    new Uint8Array(arr.buffer as ArrayBuffer, arr.byteOffset, arr.byteLength),
  );
  return arr;
}

export function randomBytes(size: number): Buffer;
export function randomBytes(size: number, cb: (err: Error | null, buf: Buffer) => void): void;
export function randomBytes(
  size: number,
  cb?: (err: Error | null, buf: Buffer) => void,
): Buffer | undefined {
  const buf = Buffer.alloc(size);
  for (let off = 0; off < size; off += 65536) {
    globalThis.crypto.getRandomValues(
      new Uint8Array(buf.buffer, buf.byteOffset + off, Math.min(size, off + 65536) - off),
    );
  }
  if (cb) {
    queueMicrotask(() => {
      cb(null, buf);
    });
    return undefined;
  }
  return buf;
}

export function randomFillSync<T extends ArrayBufferView>(buf: T): T {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let off = 0; off < u8.length; off += 65536) {
    globalThis.crypto.getRandomValues(
      new Uint8Array(
        u8.buffer as ArrayBuffer,
        u8.byteOffset + off,
        Math.min(u8.length, off + 65536) - off,
      ),
    );
  }
  return buf;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function randomInt(min: number, max?: number): number {
  let lo = 0;
  let hi = min;
  if (max !== undefined) {
    lo = min;
    hi = max;
  }
  const range = hi - lo;
  if (!Number.isSafeInteger(range) || range <= 0) throw new RangeError('randomInt range invalid');
  // Rejection sampling over 48 bits (Node uses the same bound).
  const limit = 2 ** 48 - (2 ** 48 % range);
  const b = new Uint8Array(6);
  for (;;) {
    globalThis.crypto.getRandomValues(b);
    const v = b.reduce((acc, x) => acc * 256 + x, 0);
    if (v < limit) return lo + (v % range);
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    throw new RangeError('Input buffers must have the same byte length');
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface ScryptOpts {
  N?: number;
  r?: number;
  p?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  maxmem?: number;
}

function scryptParams(opts?: ScryptOpts): { N: number; r: number; p: number; maxmem?: number } {
  return {
    N: opts?.N ?? opts?.cost ?? 16384,
    r: opts?.r ?? opts?.blockSize ?? 8,
    p: opts?.p ?? opts?.parallelization ?? 1,
    maxmem: opts?.maxmem,
  };
}

export function scryptSync(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  opts?: ScryptOpts,
): Buffer {
  const { N, r, p, maxmem } = scryptParams(opts);
  return Buffer.from(
    nobleScrypt(toBytes(password), toBytes(salt), {
      N,
      r,
      p,
      dkLen: keylen,
      maxmem: maxmem ?? 2 ** 30,
    }),
  );
}

export function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  optsOrCb: ScryptOpts | ((err: Error | null, key: Buffer) => void),
  maybeCb?: (err: Error | null, key: Buffer) => void,
): void {
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  setTimeout(() => {
    try {
      cb?.(null, scryptSync(password, salt, keylen, opts));
    } catch (e) {
      cb?.(e instanceof Error ? e : new Error(String(e)), Buffer.alloc(0));
    }
  }, 0);
}

export function pbkdf2Sync(
  password: BinaryLike,
  salt: BinaryLike,
  iterations: number,
  keylen: number,
  digest: string,
): Buffer {
  return Buffer.from(
    noblePbkdf2(hashFor(digest), toBytes(password), toBytes(salt), {
      c: iterations,
      dkLen: keylen,
    }),
  );
}

export function pbkdf2(
  password: BinaryLike,
  salt: BinaryLike,
  iterations: number,
  keylen: number,
  digest: string,
  cb: (err: Error | null, key: Buffer) => void,
): void {
  setTimeout(() => {
    try {
      cb(null, pbkdf2Sync(password, salt, iterations, keylen, digest));
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), Buffer.alloc(0));
    }
  }, 0);
}

type CipherAlg = 'aes-128-ctr' | 'aes-256-ctr' | 'aes-128-gcm' | 'aes-256-gcm';

function checkAlg(alg: string, key: Uint8Array): CipherAlg {
  const a = alg.toLowerCase() as CipherAlg;
  const need = a.startsWith('aes-128') ? 16 : a.startsWith('aes-256') ? 32 : 0;
  if (!['aes-128-ctr', 'aes-256-ctr', 'aes-128-gcm', 'aes-256-gcm'].includes(a)) {
    throw new Error(`Unsupported cipher on mobile: ${alg}`);
  }
  if (key.length !== need) throw new RangeError('Invalid key length');
  return a;
}

/** Streaming AES (CTR keeps state across `update` calls; GCM buffers until `final`). */
export class CipherBase {
  private readonly alg: CipherAlg;
  private readonly key: Uint8Array;
  private readonly iv: Uint8Array;
  private readonly chunks: Uint8Array[] = [];
  private ctrProduced = 0;
  private authTag: Uint8Array | null = null;
  private aad: Uint8Array | null = null;

  constructor(
    alg: string,
    key: BinaryLike,
    iv: BinaryLike,
    private readonly decrypt: boolean,
    /** GCM tag length in bytes (Node `authTagLength`); only 16 is supported. */
    private readonly authTagLength = 16,
  ) {
    if (authTagLength !== 16)
      throw new Error(`Invalid authentication tag length: ${authTagLength}`);
    this.key = Uint8Array.from(toBytes(key));
    this.iv = Uint8Array.from(toBytes(iv));
    this.alg = checkAlg(alg, this.key);
  }

  private isCtr(): boolean {
    return this.alg.endsWith('ctr');
  }

  update(
    data: BinaryLike,
    inputEncoding?: BufferEncoding,
    outputEncoding?: BufferEncoding,
  ): Buffer | string {
    const bytes = Uint8Array.from(toBytes(data, inputEncoding));
    this.chunks.push(bytes);
    if (!this.isCtr()) return output(new Uint8Array(0), outputEncoding);
    // CTR is a stream cipher: re-run over everything so far and emit the new tail.
    const all = Buffer.concat(this.chunks.map((c) => Buffer.from(c)));
    const out = ctr(this.key, this.iv).encrypt(Uint8Array.from(all));
    const tail = out.subarray(this.ctrProduced);
    this.ctrProduced = out.length;
    return output(tail, outputEncoding);
  }

  final(outputEncoding?: BufferEncoding): Buffer | string {
    if (this.isCtr()) return output(new Uint8Array(0), outputEncoding);
    const all = Uint8Array.from(Buffer.concat(this.chunks.map((c) => Buffer.from(c))));
    const g = gcm(this.key, this.iv, this.aad ?? undefined);
    if (this.decrypt) {
      if (!this.authTag) throw new Error('Unsupported state or unable to authenticate data');
      const joined = new Uint8Array(all.length + this.authTag.length);
      joined.set(all, 0);
      joined.set(this.authTag, all.length);
      try {
        return output(g.decrypt(joined), outputEncoding);
      } catch {
        throw new Error('Unsupported state or unable to authenticate data');
      }
    }
    const sealed = g.encrypt(all);
    this.authTag = sealed.subarray(sealed.length - 16);
    return output(sealed.subarray(0, sealed.length - 16), outputEncoding);
  }

  getAuthTag(): Buffer {
    if (!this.authTag) throw new Error('Attempting to get auth tag in unsupported state');
    return Buffer.from(this.authTag);
  }

  setAuthTag(tag: Uint8Array): this {
    // Reject truncated tags (Node enforces authTagLength the same way).
    if (tag.byteLength !== this.authTagLength) {
      throw new Error(`Invalid authentication tag length: ${tag.byteLength}`);
    }
    this.authTag = Uint8Array.from(tag);
    return this;
  }

  setAAD(aad: Uint8Array): this {
    this.aad = Uint8Array.from(aad);
    return this;
  }

  setAutoPadding(): this {
    return this;
  }
}

export interface CipherOptions {
  authTagLength?: number;
}

export function createCipheriv(
  alg: string,
  key: BinaryLike,
  iv: BinaryLike,
  opts?: CipherOptions,
): CipherBase {
  return new CipherBase(alg, key, iv, false, opts?.authTagLength);
}

export function createDecipheriv(
  alg: string,
  key: BinaryLike,
  iv: BinaryLike,
  opts?: CipherOptions,
): CipherBase {
  return new CipherBase(alg, key, iv, true, opts?.authTagLength);
}

function unsupported(name: string): never {
  throw new Error(`crypto.${name} is not available on mobile`);
}

export function generateKeyPair(): never {
  return unsupported('generateKeyPair');
}
export function generateKeyPairSync(): never {
  return unsupported('generateKeyPairSync');
}
export function createPrivateKey(): never {
  return unsupported('createPrivateKey');
}
export function createPublicKey(): never {
  return unsupported('createPublicKey');
}
export class X509Certificate {
  constructor() {
    unsupported('X509Certificate');
  }
  toString(): string {
    return '';
  }
}

export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto.subtle;
export const constants = {};

export default {
  createHash,
  createHmac,
  getHashes,
  getRandomValues,
  randomBytes,
  randomFillSync,
  randomUUID,
  randomInt,
  timingSafeEqual,
  scrypt,
  scryptSync,
  pbkdf2,
  pbkdf2Sync,
  createCipheriv,
  createDecipheriv,
  generateKeyPair,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
  webcrypto,
  subtle,
  constants,
};
