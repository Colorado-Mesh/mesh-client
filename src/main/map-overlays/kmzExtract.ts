/**
 * KMZ → temporary directory extract with zip-bomb / path-traversal guards.
 * Always uses `fs.mkdtempSync` under `os.tmpdir()` — never predictable temp paths.
 */

import fs, { promises as fsp } from 'fs';
import JSZip from 'jszip';
import os from 'os';
import path from 'path';

import {
  MAP_OVERLAY_KMZ_MAX_ENTRIES,
  MAP_OVERLAY_KMZ_MAX_UNCOMPRESSED_BYTES,
  MAP_OVERLAY_MAX_BYTES,
} from '@/shared/mapOverlays/types';

export class KmzExtractError extends Error {
  readonly code: 'too_large' | 'unsafe_zip' | 'empty' | 'io';

  constructor(code: KmzExtractError['code'], message?: string) {
    super(message ?? code);
    this.name = 'KmzExtractError';
    this.code = code;
  }
}

export function assertSafeZipEntryName(name: string, destRoot: string): string {
  if (!name || name.includes('\0')) {
    throw new KmzExtractError('unsafe_zip', 'Invalid zip entry name');
  }
  if (path.isAbsolute(name) || /^[a-zA-Z]:[\\/]/.test(name) || name.startsWith('\\\\')) {
    throw new KmzExtractError('unsafe_zip', 'Absolute zip paths are not allowed');
  }
  const normalizedPosix = name.replace(/\\/g, '/');
  if (normalizedPosix.split('/').some((seg) => seg === '..')) {
    throw new KmzExtractError('unsafe_zip', 'Zip path traversal is not allowed');
  }
  const dest = path.resolve(destRoot, normalizedPosix);
  const rootWithSep = destRoot.endsWith(path.sep) ? destRoot : destRoot + path.sep;
  if (dest !== destRoot && !dest.startsWith(rootWithSep)) {
    throw new KmzExtractError('unsafe_zip', 'Zip entry escapes extract directory');
  }
  return dest;
}

async function findKmlFile(dir: string): Promise<string> {
  const preferred = path.join(dir, 'doc.kml');
  try {
    await fsp.access(preferred);
    return preferred;
  } catch {
    // catch-no-log-ok fall through to recursive search
  }

  async function walk(current: string): Promise<string | null> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const nested = await walk(full);
        if (nested) return nested;
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.kml')) {
        files.push(full);
      }
    }
    return files.sort((a, b) => a.localeCompare(b))[0] ?? null;
  }

  const found = await walk(dir);
  if (!found) throw new KmzExtractError('empty', 'KMZ contains no KML document');
  return found;
}

/** Inflate one zip entry while stopping as soon as `budget` bytes would be exceeded. */
async function readZipEntryWithBudget(entry: JSZip.JSZipObject, budget: number): Promise<Buffer> {
  if (budget <= 0) {
    throw new KmzExtractError('too_large', 'KMZ uncompressed size exceeds limit');
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      // Stop further inflate chunks without relying on Node-only destroy typings.
      if (typeof stream.pause === 'function') stream.pause();
      reject(err);
    };
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.byteLength;
      if (size > budget) {
        fail(new KmzExtractError('too_large', 'KMZ uncompressed size exceeds limit'));
        return;
      }
      chunks.push(buf);
    });
    stream.on('error', (err: Error) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Extract KMZ bytes into a unique temp directory, read the primary KML, then remove the dir.
 * Failure point: zip inflate / path checks — temp dir is always cleaned up.
 */
export async function extractKmlTextFromKmz(kmzBytes: Buffer): Promise<string> {
  if (kmzBytes.byteLength === 0) throw new KmzExtractError('empty', 'KMZ file is empty');
  if (kmzBytes.byteLength > MAP_OVERLAY_MAX_BYTES) throw new KmzExtractError('too_large');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-kmz-'));
  try {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(kmzBytes);
    } catch {
      throw new KmzExtractError('unsafe_zip', 'Invalid KMZ / zip archive');
    }

    let entryCount = 0;
    let uncompressed = 0;
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      entryCount += 1;
      if (entryCount > MAP_OVERLAY_KMZ_MAX_ENTRIES) {
        throw new KmzExtractError('unsafe_zip', 'KMZ has too many entries');
      }
      const dest = assertSafeZipEntryName(name, dir);
      // Prefer central-directory size when present so we fail before inflate.
      const declared = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof declared === 'number' && Number.isFinite(declared)) {
        if (uncompressed + declared > MAP_OVERLAY_KMZ_MAX_UNCOMPRESSED_BYTES) {
          throw new KmzExtractError('too_large', 'KMZ uncompressed size exceeds limit');
        }
      }
      const remaining = MAP_OVERLAY_KMZ_MAX_UNCOMPRESSED_BYTES - uncompressed;
      const data = await readZipEntryWithBudget(entry, remaining);
      uncompressed += data.byteLength;
      if (uncompressed > MAP_OVERLAY_KMZ_MAX_UNCOMPRESSED_BYTES) {
        throw new KmzExtractError('too_large', 'KMZ uncompressed size exceeds limit');
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, data);
    }

    if (entryCount === 0) throw new KmzExtractError('empty', 'KMZ has no files');

    const kmlPath = await findKmlFile(dir);
    const kmlText = await fsp.readFile(kmlPath, 'utf8');
    if (Buffer.byteLength(kmlText, 'utf8') > MAP_OVERLAY_MAX_BYTES) {
      throw new KmzExtractError('too_large');
    }
    return kmlText;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {
      // catch-no-log-ok best-effort cleanup
    });
  }
}
