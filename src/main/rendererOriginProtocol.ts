import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { net } from 'electron';

import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  RENDERER_HOST,
  RENDERER_SCHEME,
} from '@/shared/rendererOrigin';

export interface RendererOriginProtocolDeps {
  distRoot: string;
  fetchImpl?: typeof net.fetch;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

function responseHeaders(): Headers {
  const headers = new Headers(CROSS_ORIGIN_ISOLATION_HEADERS);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function unavailableResponse(status = 404): Response {
  return new Response(null, { status, headers: responseHeaders() });
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Serve only packaged renderer assets; no navigation fallback or access to other app files. */
export function createRendererOriginProtocolHandler(
  deps: RendererOriginProtocolDeps,
): (request: Request) => Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? net.fetch.bind(net);

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const headers = responseHeaders();
      headers.set('Allow', 'GET, HEAD');
      return new Response(null, { status: 405, headers });
    }

    try {
      const url = new URL(request.url);
      if (
        url.protocol !== `${RENDERER_SCHEME}:` ||
        url.hostname !== RENDERER_HOST ||
        url.port ||
        url.username ||
        url.password
      ) {
        return unavailableResponse();
      }
      const pathname = decodeURIComponent(url.pathname || '/');
      // Reject separators and traversal after decoding too, on every supported OS.
      if (
        !pathname.startsWith('/') ||
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part === '..')
      ) {
        return unavailableResponse();
      }
      const root = await fs.realpath(deps.distRoot);
      const target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
      if (!isWithinRoot(root, target)) return unavailableResponse();
      // A lexical check alone allows a packaged symlink to expose files outside distRoot.
      const realTarget = await fs.realpath(target);
      if (!isWithinRoot(root, realTarget) || !(await fs.stat(realTarget)).isFile()) {
        return unavailableResponse();
      }

      const response = await fetchImpl(pathToFileURL(realTarget).href, { method: request.method });
      const headers = new Headers(response.headers);
      for (const [name, value] of responseHeaders()) headers.set(name, value);
      const extension = path.extname(realTarget).toLowerCase();
      headers.set('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream');
      if (extension !== '.html') headers.set('Cache-Control', 'no-cache');
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // catch-no-log-ok invalid URLs and missing/unreadable assets are unavailable; keep paths private.
      return unavailableResponse();
    }
  };
}
