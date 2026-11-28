/**
 * Reticulum on mobile: main (in the host worker) starts the sidecar through the `child_process`
 * shim → MeshProcess (the harness bridge runs the desktop sidecar build, like the Android plugin
 * runs the packaged executable), passes the bootstrap credential on stdin, probes a free port with
 * `net.createServer().listen(0)`, health-polls over native fetch, and opens the authenticated
 * event WebSocket. Then identity creation and the mirrored config directory are checked.
 * Skipped when no sidecar build exists (MESH_SIDECAR_BIN or reticulum-sidecar/target/*).
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { bootApp, type Harness, requireService, startHarness, unexpectedErrors } from './harness';

const ROOT = path.resolve(import.meta.dirname, '../..');
const sidecarBuilt =
  Boolean(process.env.MESH_SIDECAR_BIN) ||
  ['release', 'debug'].some((p) =>
    fs.existsSync(path.join(ROOT, `reticulum-sidecar/target/${p}/mesh-client-reticulum`)),
  );

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

test('starts the Reticulum sidecar through MeshProcess and reaches the stack API', async ({
  browser,
}) => {
  requireService('sidecar', sidecarBuilt, 'no Reticulum sidecar build');
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);

  const status = await page.evaluate(async () => {
    const s = await window.electronAPI.reticulum.start();
    return s;
  });
  expect(status.running).toBe(true);
  expect(status.port).toBeGreaterThan(0);

  // Health and identity routes work through the authenticated proxy (bearer never reaches JS).
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const r = (await window.electronAPI.reticulum.proxyGet('/api/v1/status')) as {
            status?: string;
          };
          return r.status;
        }),
      { timeout: 60_000 },
    )
    .toBe('ok');
  const identity = await page.evaluate(async () => {
    const r = (await window.electronAPI.reticulum.proxyGet('/api/v1/identity/status')) as {
      configured?: boolean;
      identity_hash?: string;
    };
    if (!r.configured) {
      await window.electronAPI.reticulum.proxyPost('/api/v1/identity/generate', {
        display_name: 'mobile e2e',
      });
    }
    return window.electronAPI.reticulum.proxyGet('/api/v1/identity/status');
  });
  expect((identity as { configured?: boolean }).configured).toBe(true);

  // The sidecar read its Reticulum config from the real shared directory and lists interfaces.
  const interfaces = await page.evaluate(async () => {
    const r = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: unknown[];
    };
    return Array.isArray(r.interfaces);
  });
  expect(interfaces).toBe(true);

  await page.evaluate(() => window.electronAPI.reticulum.stop());
  await expect
    .poll(
      async () =>
        page.evaluate(async () => (await window.electronAPI.reticulum.getStatus()).running),
      {
        timeout: 30_000,
      },
    )
    .toBe(false);

  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
