import net from 'node:net';
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

/** TCP probe for a local Vite dev server (used when Electron starts without VITE_DEV_SERVER_URL). */
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

  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
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
    console.warn(
      '[Startup] VITE_DEV_SERVER_URL unset and Vite not reachable — loading dist/renderer (stale hashed bundle). Run pnpm run dev for live source.',
    );
  }

  const indexUrl = pathToFileURL(path.resolve(options.distIndexPath)).toString();
  return {
    url: indexUrl,
    openDevTools: false,
    source: 'dist',
  };
}
