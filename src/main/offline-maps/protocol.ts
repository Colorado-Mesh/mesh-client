import { net } from 'electron';

import {
  buildRemoteTileUrl,
  isOfflineMapBasemapId,
  meshTilesUserAgent,
  type OfflineMapBasemapId,
  OSM_TILE_HTTP_REFERRER,
} from '@/shared/offlineMaps/basemapRegistry';
import { OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS } from '@/shared/offlineMaps/tileMath';

import { sanitizeLogMessage } from '../log-service';
import { parseTileCoords, type TileCache } from './tile-cache';

export interface MeshTilesProtocolDeps {
  cache: TileCache;
  getAppVersion: () => string;
  isOnline?: () => boolean;
  fetchImpl?: typeof net.fetch;
}

function pngResponse(body: Buffer | Uint8Array, status = 200): Response {
  const ab = new Uint8Array(body.byteLength);
  ab.set(body);
  return new Response(ab, {
    status,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/**
 * Parse `mesh-tiles://<basemapId>/<z>/<x>/<y>[@2x].png`
 * Under Electron `standard: true`, hostname is the basemap id.
 */
export function parseMeshTilesRequestUrl(url: string): {
  basemapId: OfflineMapBasemapId;
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
  if (!isOfflineMapBasemapId(basemapId)) return null;
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

    const remoteUrl = buildRemoteTileUrl(parsed.basemapId, parsed.z, parsed.x, parsed.y, {
      retina: parsed.retina,
      subdomainIndex: (parsed.x + parsed.y) % 4,
    });

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
