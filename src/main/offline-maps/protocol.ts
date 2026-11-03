import { lookup } from 'dns/promises';
import { net } from 'electron';
import { fetch as undiciFetch } from 'undici';

import { isGlobalIpLiteral } from '@/shared/ipLiteral';
import {
  buildRemoteTileUrl,
  isMapSourceId,
  type MapSourceId,
  meshTilesUserAgent,
  OSM_TILE_HTTP_REFERRER,
} from '@/shared/offlineMaps/basemapRegistry';
import {
  buildCustomRemoteTileUrl,
  CUSTOM_TILE_MAX_BYTES,
  customMapSourceKind,
  isCustomMapSourceId,
  sniffRasterTileMime,
  validateXyzTemplate,
} from '@/shared/offlineMaps/customMapSources';
import { OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS } from '@/shared/offlineMaps/tileMath';

import { sanitizeLogMessage } from '../log-service';
import { createPinnedPublicAgent } from '../pinnedPublicConnect';
import type { CustomMapSourceRecord } from './custom-sources';
import { parseTileCoords, type TileCache } from './tile-cache';

/**
 * Read a fetch Response body in chunks, cancelling as soon as the cumulative size exceeds
 * `maxBytes`. Returns `null` for empty, oversized, or unreadable bodies (no silent truncate).
 */
async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {
          // catch-no-log-ok stream may already be closed
        });
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // catch-no-log-ok aborted / truncated body → treat as miss
    try {
      await reader.cancel();
    } catch {
      // catch-no-log-ok already closed
    }
    return null;
  }
  if (total === 0) return null;
  return Buffer.concat(chunks, total);
}

/** What the protocol needs from the custom-source allowlist (implemented by the store + pool). */
export interface CustomTileSources {
  get: (id: string) => Promise<CustomMapSourceRecord | null>;
  readMbtilesTile: (id: string, z: number, x: number, y: number) => Promise<Buffer | null>;
}

export interface MeshTilesProtocolDeps {
  cache: TileCache;
  getAppVersion: () => string;
  isOnline?: () => boolean;
  /**
   * Fetch used for built-in basemaps and, when set, custom XYZ tiles (tests).
   * Production custom tiles use undici with a pinned lookup instead.
   */
  fetchImpl?: (input: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
  customSources?: CustomTileSources;
  /** Resolve a hostname to addresses (test seam); default `dns.lookup(all)`. */
  resolveHost?: (host: string) => Promise<string[]>;
}

async function defaultResolveHost(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

function pngResponse(body: Buffer | Uint8Array, status = 200, contentType = 'image/png'): Response {
  const ab = new Uint8Array(body.byteLength);
  ab.set(body);
  return new Response(ab, {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' },
  });
}

/**
 * Parse `mesh-tiles://<basemapId>/<z>/<x>/<y>[@2x].png`
 * Under Electron `standard: true`, hostname is the basemap id.
 */
export function parseMeshTilesRequestUrl(url: string): {
  basemapId: MapSourceId;
  z: number;
  x: number;
  y: number;
  retina: boolean;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // catch-no-log-ok invalid URL
    return null;
  }
  if (parsed.protocol !== 'mesh-tiles:') return null;
  const basemapId = parsed.hostname;
  if (!isMapSourceId(basemapId)) return null;
  const parts = parsed.pathname.replace(/^\//, '').split('/');
  if (parts.length !== 3) return null;
  const [zRaw, xRaw, yFile] = parts;
  if (!yFile?.endsWith('.png')) return null;
  const yRaw = yFile.slice(0, -'.png'.length);
  const coords = parseTileCoords(basemapId, zRaw ?? '', xRaw ?? '', yRaw ?? '');
  if (!coords) return null;
  return {
    basemapId: coords.basemapId,
    z: coords.z,
    x: coords.x,
    y: coords.y,
    retina: coords.retina === true,
  };
}

export function createMeshTilesProtocolHandler(
  deps: MeshTilesProtocolDeps,
): (request: Request) => Promise<Response> {
  const isOnline = deps.isOnline ?? (() => net.isOnline());
  const fetchImpl = deps.fetchImpl ?? net.fetch.bind(net);
  const customFetch =
    deps.fetchImpl ?? (undiciFetch as unknown as NonNullable<MeshTilesProtocolDeps['fetchImpl']>);
  const resolveHost = deps.resolveHost ?? defaultResolveHost;

  /**
   * Resolve once and require every address to be a global IP literal.
   * Returns the address the connect must pin to, or null when the host is blocked.
   */
  const resolvePinnedPublicAddress = async (host: string): Promise<string | null> => {
    let addresses: string[];
    try {
      addresses = await resolveHost(host);
    } catch {
      // catch-no-log-ok unresolvable host → treated as not public (blank tile)
      return null;
    }
    if (addresses.length === 0 || !addresses.every((a) => isGlobalIpLiteral(a) === true)) {
      return null;
    }
    return addresses[0] ?? null;
  };

  const handleCustom = async (
    id: string,
    coords: { basemapId: MapSourceId; z: number; x: number; y: number; retina: boolean },
  ): Promise<Response> => {
    const sources = deps.customSources;
    if (!sources) return emptyResponse(404);
    const record = await sources.get(id);
    // Unknown / removed source: never fetch. The allowlist is the only source of remote hosts.
    if (!record) return emptyResponse(404);

    if (customMapSourceKind(record.id) === 'mbtiles') {
      try {
        const tile = await sources.readMbtilesTile(id, coords.z, coords.x, coords.y);
        const mime = tile ? sniffRasterTileMime(tile) : null;
        return tile && mime ? pngResponse(tile, 200, mime) : emptyResponse(404);
      } catch (e: unknown) {
        console.warn(
          '[mesh-tiles] mbtiles read failed:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        return emptyResponse(404);
      }
    }

    try {
      const hit = await deps.cache.getCachedTile(coords);
      if (hit) return pngResponse(hit, 200, sniffRasterTileMime(hit) ?? 'image/png');
    } catch (e: unknown) {
      console.warn(
        '[mesh-tiles] cache read failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    if (!isOnline()) return emptyResponse(404);

    // Re-validate the persisted template on every fetch (defense in depth against a tampered store).
    const v = validateXyzTemplate(record.urlTemplate);
    if (!v.ok || v.host !== record.host) return emptyResponse(404);
    const pinnedAddress = await resolvePinnedPublicAddress(v.host);
    if (!pinnedAddress) {
      console.warn(
        '[mesh-tiles] custom host blocked (non-public address):',
        sanitizeLogMessage(v.host),
      );
      return emptyResponse(404);
    }

    const tileUrl = buildCustomRemoteTileUrl(v.template, coords.z, coords.x, coords.y);
    const agent = createPinnedPublicAgent(new URL(tileUrl), pinnedAddress);
    try {
      const res = await customFetch(tileUrl, {
        dispatcher: agent,
        headers: { 'User-Agent': meshTilesUserAgent(deps.getAppVersion()) },
        // A redirect could point at an unvalidated host; custom sources must answer directly.
        redirect: 'error',
        signal: AbortSignal.timeout(OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return emptyResponse(404);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > CUSTOM_TILE_MAX_BYTES) return emptyResponse(404);
      const buf = await readBoundedResponseBody(res, CUSTOM_TILE_MAX_BYTES);
      if (!buf) return emptyResponse(404);
      // Only real raster images are cached or served (never HTML/JSON error bodies).
      const mime = sniffRasterTileMime(buf);
      if (!mime) return emptyResponse(404);
      try {
        await deps.cache.putCachedTile(coords, buf);
      } catch (e: unknown) {
        console.warn(
          '[mesh-tiles] cache write failed:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
      return pngResponse(buf, 200, mime);
    } catch (e: unknown) {
      console.debug(
        '[mesh-tiles] custom fetch failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      return emptyResponse(404);
    } finally {
      await agent.close().catch(() => {
        // catch-no-log-ok agent may already be closed after abort
      });
    }
  };

  return async (request: Request): Promise<Response> => {
    const parsed = parseMeshTilesRequestUrl(request.url);
    if (!parsed) {
      return emptyResponse(400);
    }

    const coords = {
      basemapId: parsed.basemapId,
      z: parsed.z,
      x: parsed.x,
      y: parsed.y,
      retina: parsed.retina,
    };

    if (isCustomMapSourceId(parsed.basemapId)) {
      return handleCustom(parsed.basemapId, coords);
    }

    try {
      const hit = await deps.cache.getCachedTile(coords);
      if (hit) {
        return pngResponse(hit);
      }
    } catch (e: unknown) {
      console.warn(
        '[mesh-tiles] cache read failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }

    if (!isOnline()) {
      return emptyResponse(404);
    }

    const remoteUrl = buildRemoteTileUrl(parsed.basemapId, parsed.z, parsed.x, parsed.y);

    try {
      const res = await fetchImpl(remoteUrl, {
        headers: {
          'User-Agent': meshTilesUserAgent(deps.getAppVersion()),
          Referer: OSM_TILE_HTTP_REFERRER,
        },
        signal: AbortSignal.timeout(OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return emptyResponse(404);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        await deps.cache.putCachedTile(coords, buf);
      } catch (e: unknown) {
        console.warn(
          '[mesh-tiles] cache write failed:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
      return pngResponse(buf);
    } catch (e: unknown) {
      console.debug(
        '[mesh-tiles] fetch failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      return emptyResponse(404);
    }
  };
}
