/**
 * Mobile browser harness: static server for `mobile/dist/` plus the MeshNet web bridge
 * (mobile/scripts/web-bridge.mjs), the same contract the Android/iOS plugins implement.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Page, test } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * Services a run must have (`MOBILE_E2E_REQUIRE=meshtasticd,tiles,sidecar`). Locally a spec skips
 * when its service is missing; CI lists the services it starts so a missing one fails instead of
 * silently skipping.
 */
export function requireService(name: string, available: boolean, reason: string): void {
  const required = (process.env.MOBILE_E2E_REQUIRE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (available) return;
  if (required.includes(name))
    throw new Error(`${name} is required (MOBILE_E2E_REQUIRE): ${reason}`);
  test.skip(true, reason);
}

export interface Harness {
  url: string;
  bridgeUrl: string;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /**
   * Bind the app's "all interfaces" UDP sockets to this loopback address, so a stand-in device can
   * bind the same port on another loopback address (MeshCom EXTUDP: 1799 on both ends).
   */
  udpBindAddress?: string;
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    throw new Error('mobile/dist/ is missing — run `pnpm -C mobile run build` first');
  }
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  // ESM script; Playwright compiles specs as CommonJS, so load it dynamically.
  const { startMobileWebBridge } = (await import(
    pathToFileURL(path.resolve(import.meta.dirname, '../scripts/web-bridge.mjs')).href
  )) as { startMobileWebBridge: (o: { port: number; udpBindAddress?: string }) => unknown };
  const bridge = startMobileWebBridge({ port: 0, udpBindAddress: opts.udpBindAddress }) as {
    address(): AddressInfo;
    close(cb?: () => void): void;
    once(e: string, cb: () => void): void;
    clients: Set<{ terminate(): void }>;
    bridgeToken: string;
  };
  await new Promise<void>((r) => {
    bridge.once('listening', r);
  });
  const bridgePort = bridge.address().port;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    bridgeUrl: `ws://127.0.0.1:${bridgePort}/?token=${bridge.bridgeToken}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of bridge.clients) c.terminate();
        server.closeAllConnections();
        bridge.close(() => {
          server.close(() => {
            resolve();
          });
        });
      }),
  };
}

export interface BootResult {
  pageErrors: string[];
  consoleErrors: string[];
}

/** Open the app, finish first-run setup, and collect errors. */
export async function bootApp(
  page: Page,
  h: Harness,
  opts: { skipSetup?: boolean } = {},
): Promise<BootResult> {
  const result: BootResult = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (e) => result.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.consoleErrors.push(m.text());
  });
  await page.addInitScript((bridgeUrl) => {
    (globalThis as { __MESH_WEB_BRIDGE__?: string }).__MESH_WEB_BRIDGE__ = bridgeUrl;
  }, h.bridgeUrl);
  await page.goto(h.url);
  await page.waitForFunction(
    () => typeof (window as { electronAPI?: unknown }).electronAPI === 'object',
    null,
    {
      timeout: 60_000,
    },
  );
  if (opts.skipSetup !== false) {
    const skip = page.getByRole('button', { name: /skip setup/i });
    try {
      await skip.first().click({ timeout: 15_000 });
    } catch {
      // Setup already completed in this profile.
    }
  }
  return result;
}

/** Errors that are expected in the harness (no network services, offline tiles). */
export function unexpectedErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_|status of 4\d\d|tile|favicon/i.test(
        e,
      ),
  );
}
