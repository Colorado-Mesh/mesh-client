import { lookup } from 'dns/promises';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fetch as undiciFetch } from 'undici';
import { createGunzip } from 'zlib';

import { MS_PER_SECOND } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';
import { createPinnedPublicAgent, isGlobalPublicAddress } from '../pinnedPublicConnect';

/** Approx uncompressed SRTM1 tile size (3601² × 2 bytes). */
export const HGT_TILE_BYTES = 3601 * 3601 * 2;
const HGT_SIDE = 3601;
const HGT_FETCH_TIMEOUT_MS = 60 * MS_PER_SECOND;
const HGT_MAX_BYTES = HGT_TILE_BYTES + 64 * 1024; // gzip overhead headroom after inflate check

export const ALLOWED_HGT_HOSTS = new Set(['s3.amazonaws.com']);

/** SRTM tile name for a lat/lon (e.g. N39W105). */
export function hgtTileName(lat: number, lon: number): string {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const ns = latFloor >= 0 ? 'N' : 'S';
  const ew = lonFloor >= 0 ? 'E' : 'W';
  const latAbs = Math.abs(latFloor).toString().padStart(2, '0');
  const lonAbs = Math.abs(lonFloor).toString().padStart(3, '0');
  return `${ns}${latAbs}${ew}${lonAbs}`;
}

/** Directory prefix used by Mapzen/AWS skadi layout (e.g. N39). */
export function hgtTileDir(tileName: string): string {
  return tileName.slice(0, 3);
}

export function hgtRemoteUrl(tileName: string): string {
  const dir = hgtTileDir(tileName);
  return `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${dir}/${tileName}.hgt.gz`;
}

/** All unique HGT tile names covering a bounding box (inclusive). */
export function hgtTilesForBounds(bounds: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string[] {
  const lat0 = Math.floor(bounds.south);
  const lat1 = Math.floor(bounds.north);
  const lon0 = Math.floor(bounds.west);
  const lon1 = Math.floor(bounds.east);
  const names = new Set<string>();
  for (let lat = lat0; lat <= lat1; lat++) {
    for (let lon = lon0; lon <= lon1; lon++) {
      // Sample a point inside the degree cell so floor naming matches.
      names.add(hgtTileName(lat + 0.001, lon + 0.001));
    }
  }
  return [...names].sort();
}

function hgtPath(cacheDir: string, tileName: string): string {
  return path.join(cacheDir, 'hgt', `${tileName}.hgt`);
}

export async function hgtTileExists(cacheDir: string, tileName: string): Promise<boolean> {
  try {
    const st = await fs.stat(hgtPath(cacheDir, tileName));
    return st.isFile() && st.size >= HGT_TILE_BYTES;
  } catch {
    // catch-no-log-ok missing tile
    return false;
  }
}

export async function listHgtTiles(
  cacheDir: string,
): Promise<{ count: number; bytes: number; names: string[] }> {
  const dir = path.join(cacheDir, 'hgt');
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.hgt'));
  } catch {
    // catch-no-log-ok empty cache
    return { count: 0, bytes: 0, names: [] };
  }
  let bytes = 0;
  for (const name of names) {
    try {
      bytes += (await fs.stat(path.join(dir, name))).size;
    } catch {
      // catch-no-log-ok race
    }
  }
  return { count: names.length, bytes, names: names.map((n) => n.replace(/\.hgt$/, '')) };
}

/**
 * Read elevation (meters) from a local SRTM1 HGT file.
 * Returns null for voids (0x8000) or missing/corrupt tiles.
 */
export async function readHgtElevation(
  cacheDir: string,
  lat: number,
  lon: number,
): Promise<number | null> {
  const tileName = hgtTileName(lat, lon);
  const file = hgtPath(cacheDir, tileName);
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    // catch-no-log-ok miss
    return null;
  }
  if (buf.byteLength < HGT_TILE_BYTES) return null;

  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const row = Math.round((latFloor + 1 - lat) * (HGT_SIDE - 1));
  const col = Math.round((lon - lonFloor) * (HGT_SIDE - 1));
  if (row < 0 || row >= HGT_SIDE || col < 0 || col >= HGT_SIDE) return null;
  const offset = (row * HGT_SIDE + col) * 2;
  const value = buf.readInt16BE(offset);
  if (value === -32768) return null; // SRTM void
  return value;
}

async function resolvePublicAddress(host: string): Promise<string | null> {
  const records = await lookup(host, { all: true });
  const addr = records.map((r) => r.address).find((a) => isGlobalPublicAddress(a));
  return addr ?? null;
}

export interface HgtDownloadDeps {
  fetchImpl?: (input: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
  getAppVersion: () => string;
  signal?: AbortSignal;
}

/** Download and gunzip one HGT tile into the cache. */
export async function downloadHgtTile(
  cacheDir: string,
  tileName: string,
  deps: HgtDownloadDeps,
): Promise<boolean> {
  if (!/^[NS]\d{2}[EW]\d{3}$/.test(tileName)) return false;
  const destDir = path.join(cacheDir, 'hgt');
  await fs.mkdir(destDir, { recursive: true });
  const dest = hgtPath(cacheDir, tileName);
  if (await hgtTileExists(cacheDir, tileName)) return true;

  const url = hgtRemoteUrl(tileName);
  const tmpGz = path.join(destDir, `${tileName}.hgt.gz.partial`);
  const tmpHgt = path.join(destDir, `${tileName}.hgt.partial`);

  try {
    let response: Response;
    if (deps.fetchImpl) {
      response = await deps.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/gzip,application/octet-stream,*/*',
          'User-Agent': `mesh-client/${deps.getAppVersion()} (+https://github.com/Colorado-Mesh/mesh-client)`,
        },
        signal: deps.signal ?? AbortSignal.timeout(HGT_FETCH_TIMEOUT_MS),
      });
    } else {
      const parsed = new URL(url);
      if (!ALLOWED_HGT_HOSTS.has(parsed.hostname.toLowerCase())) return false;
      const publicAddr = await resolvePublicAddress(parsed.hostname);
      if (!publicAddr) return false;
      const agent = createPinnedPublicAgent(parsed, publicAddr);
      try {
        response = (await undiciFetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/gzip,application/octet-stream,*/*',
            'User-Agent': `mesh-client/${deps.getAppVersion()} (+https://github.com/Colorado-Mesh/mesh-client)`,
          },
          signal: deps.signal ?? AbortSignal.timeout(HGT_FETCH_TIMEOUT_MS),
          dispatcher: agent,
          redirect: 'manual',
        })) as unknown as Response;
      } finally {
        void agent.close().catch(() => {
          // catch-no-log-ok
        });
      }
    }

    if (!response.ok || !response.body) {
      console.warn(
        '[elevation] HGT download HTTP ' +
          String(response.status) +
          ' ' +
          sanitizeLogMessage(tileName),
      );
      return false;
    }

    // Stream gzip body to partial file then gunzip.
    const body = response.body as unknown as NodeJS.ReadableStream;
    await pipeline(body, createWriteStream(tmpGz));
    await pipeline(createReadStream(tmpGz), createGunzip(), createWriteStream(tmpHgt));
    const st = await fs.stat(tmpHgt);
    if (st.size < HGT_TILE_BYTES || st.size > HGT_MAX_BYTES) {
      await fs.unlink(tmpHgt).catch(() => {
        // catch-no-log-ok
      });
      return false;
    }
    await fs.rename(tmpHgt, dest);
    return true;
  } catch (err) {
    console.warn(
      '[elevation] HGT download failed ' +
        sanitizeLogMessage(tileName) +
        ' ' +
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return false;
  } finally {
    await fs.unlink(tmpGz).catch(() => {
      // catch-no-log-ok
    });
    await fs.unlink(tmpHgt).catch(() => {
      // catch-no-log-ok
    });
  }
}
