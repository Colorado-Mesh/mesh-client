/** `zlib` shim for the mobile host worker (sync + callback + stream subsets) backed by pako. */
import { Buffer } from 'buffer';
import {
  deflate as pDeflate,
  deflateRaw as pDeflateRaw,
  gzip as pGzip,
  inflate as pInflate,
  inflateRaw as pInflateRaw,
  ungzip as pUngzip,
} from 'pako';
import { Transform } from 'readable-stream';

export type In = Uint8Array | string | ArrayBuffer;
function u8(d: In): Uint8Array {
  if (typeof d === 'string') return Uint8Array.from(Buffer.from(d));
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return d;
}
const wrap =
  (f: (d: Uint8Array) => Uint8Array) =>
  (d: In): Buffer =>
    Buffer.from(f(u8(d)));

export const gzipSync = wrap((d) => pGzip(d));
export const gunzipSync = wrap((d) => pUngzip(d));
export const deflateSync = wrap((d) => pDeflate(d));
export const inflateSync = wrap((d) => pInflate(d));
export const deflateRawSync = wrap((d) => pDeflateRaw(d));
export const inflateRawSync = wrap((d) => pInflateRaw(d));
/** Auto-detects gzip vs zlib like Node's `unzipSync`. */
export const unzipSync = (d: In): Buffer => {
  const b = u8(d);
  return b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : inflateSync(b);
};

function cbify(f: (d: In) => Buffer) {
  return (d: In, optsOrCb: unknown, maybeCb?: (e: Error | null, r?: Buffer) => void) => {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (
      e: Error | null,
      r?: Buffer,
    ) => void;
    setTimeout(() => {
      try {
        cb(null, f(d));
      } catch (e) {
        cb(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  };
}
export const gzip = cbify(gzipSync);
export const gunzip = cbify(gunzipSync);
export const deflate = cbify(deflateSync);
export const inflate = cbify(inflateSync);
export const deflateRaw = cbify(deflateRawSync);
export const inflateRaw = cbify(inflateRawSync);
export const unzip = cbify(unzipSync);

/** Buffering transform streams (whole payload processed on flush). */
function streamOf(f: (d: In) => Buffer) {
  return () => {
    const chunks: Buffer[] = [];
    return new Transform({
      transform(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
      flush(this: Transform, cb: (e?: Error | null) => void) {
        try {
          this.push(f(Buffer.concat(chunks)));
          cb();
        } catch (e) {
          cb(e instanceof Error ? e : new Error(String(e)));
        }
      },
    });
  };
}
export const createGzip = streamOf(gzipSync);
export const createGunzip = streamOf(gunzipSync);
export const createDeflate = streamOf(deflateSync);
export const createInflate = streamOf(inflateSync);
export const createDeflateRaw = streamOf(deflateRawSync);
export const createInflateRaw = streamOf(inflateRawSync);
export const createUnzip = streamOf(unzipSync);
export function brotliCompressSync(): never {
  throw new Error('brotli is not available on mobile');
}
export const brotliDecompressSync = brotliCompressSync;
export const constants = {
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
};
export default {
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  deflateRawSync,
  inflateRawSync,
  unzipSync,
  gzip,
  gunzip,
  deflate,
  inflate,
  deflateRaw,
  inflateRaw,
  unzip,
  createGzip,
  createGunzip,
  createDeflate,
  createInflate,
  createDeflateRaw,
  createInflateRaw,
  createUnzip,
  brotliCompressSync,
  brotliDecompressSync,
  constants,
};
/** zstd (offline translation packs) is not bundled on mobile; callers surface the error. */
export function zstdDecompressSync(): never {
  throw new Error('zstd decompression is not available on mobile');
}
export const zstdCompressSync = zstdDecompressSync;
