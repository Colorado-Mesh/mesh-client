import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_VITE_DEV_SERVER_URL = 'http://localhost:5173';

export type RendererLoadSource = 'env' | 'vite-probe' | 'dist';

export interface ResolveRendererLoadUrlOptions {
  packaged: boolean;
  devServerUrl?: string;
  distIndexPath: string;
  viteDevServerUrl?: string;
  probeTimeoutMs?: number;
  isDevServerReachable?: (url: string, timeoutMs: number) => Promise<boolean>;
}

export interface ResolvedRendererLoadUrl {
  url: string;
  openDevTools: boolean;
  source: RendererLoadSource;
}

/** HTTP(S) probe for a local Vite dev server (used when Electron starts without VITE_DEV_SERVER_URL). */
export function probeDevServerReachable(url: string, timeoutMs: number): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // catch-no-log-ok invalid URL for dev-server probe
    return Promise.resolve(false);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.resolve(false);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  const host = parsed.hostname;
  if (!host || !Number.isFinite(port)) {
    return Promise.resolve(false);
  }

  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    let req: http.ClientRequest | null = null;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    req = client.request(
      {
        hostname: host,
        port,
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        finish(true);
      },
    );
    req.on('timeout', () => {
      finish(false);
    });
    req.on('error', () => {
      finish(false);
    });
    req.end();
  });
}

/**
 * Prefer live Vite source in unpackaged runs so renderer changes are not stuck on dist hashes
 * (e.g. App-Bzp0Ql-M.js) when `electron .` is launched without VITE_DEV_SERVER_URL.
 */
export async function resolveRendererLoadUrl(
  options: ResolveRendererLoadUrlOptions,
): Promise<ResolvedRendererLoadUrl> {
  const viteUrl = options.viteDevServerUrl ?? DEFAULT_VITE_DEV_SERVER_URL;
  const probe = options.isDevServerReachable ?? probeDevServerReachable;
  const timeoutMs = options.probeTimeoutMs ?? 400;

  if (options.devServerUrl) {
    return {
      url: options.devServerUrl,
      openDevTools: true,
      source: 'env',
    };
  }

  if (!options.packaged) {
    if (await probe(viteUrl, timeoutMs)) {
      return {
        url: viteUrl,
        openDevTools: true,
        source: 'vite-probe',
      };
    }
    // Not necessarily stale: `pnpm start` runs a full build before launching, and never sets
    // VITE_DEV_SERVER_URL, so it always lands here with a freshly built bundle.
    console.warn(
      '[Startup] No Vite dev server reachable — loading the built renderer from dist/renderer. Expected for pnpm start (which rebuilds first); run pnpm run dev for live source with HMR.',
    );
  }

  const indexUrl = pathToFileURL(path.resolve(options.distIndexPath)).toString();
  return {
    url: indexUrl,
    openDevTools: false,
    source: 'dist',
  };
}
