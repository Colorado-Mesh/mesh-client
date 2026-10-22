import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import {
  authorizeE2eProfile,
  disposeUserData,
  loadResolveLocalElectronBin,
  repoRoot,
} from './electronApp';

const LEGACY_MARKER = 'mesh-client:origin-e2e-marker';
const BLOCKED = JSON.stringify({
  state: {
    blocked: {
      'meshcore:test': { protocol: 'meshcore', senderId: 'test', label: 'Test', createdAt: 123 },
    },
  },
  version: 1,
});

test.describe('packaged renderer origin migration', () => {
  let app: ElectronApplication | undefined;
  let userDataDir: string;

  async function launch(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
    const resolveBin = await loadResolveLocalElectronBin();
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.MESH_CLIENT_SKIP_ORIGIN_MIGRATION;
    delete env.MESH_CLIENT_FORCE_FILE_ORIGIN;
    delete env.MESH_CLIENT_FORCE_ORIGIN_REPAIR;
    delete env.MESH_CLIENT_USE_CUSTOM_PROTOCOL;
    delete env.MESH_E2E_SEED_LEGACY;
    Object.assign(env, extraEnv, {
      MESH_E2E_USER_DATA: userDataDir,
      MESH_E2E_PROFILE_TOKEN: authorizeE2eProfile(userDataDir),
      MESH_E2E_PACKAGED: '1',
    });
    delete env.VITE_DEV_SERVER_URL;
    const args = [
      path.join(repoRoot, 'e2e/fixtures/origin-migration.cjs'),
      `--user-data-dir=${userDataDir}`,
    ];
    if (process.platform === 'linux') args.push('--disable-setuid-sandbox', '--disable-gpu');
    app = await electron.launch({
      executablePath: resolveBin(),
      args,
      cwd: repoRoot,
      env: env as Record<string, string>,
    });
    return app;
  }

  async function stop(): Promise<void> {
    if (app) await app.close();
    app = undefined;
  }

  test.beforeEach(() => {
    // Electron canonicalizes some paths (notably macOS logs); compare the same owned directory.
    userDataDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mesh-origin-e2e-')));
  });

  test.afterEach(async () => {
    await stop();
    await disposeUserData(userDataDir);
  });

  test('preserves legacy data, supports COI, repairs empty storage, and keeps file recovery', async () => {
    test.setTimeout(180_000);
    writeFileSync(
      path.join(userDataDir, 'seed.json'),
      JSON.stringify({
        [LEGACY_MARKER]: 'original profile',
        'mesh-client:mecpBlockedSenders': BLOCKED,
        'mesh-client:lastRead:meshtastic': JSON.stringify({ 'ch-0': 123 }),
      }),
    );
    await launch({ MESH_E2E_SEED_LEGACY: '1' });
    await expect.poll(() => existsSync(path.join(userDataDir, 'seed-complete'))).toBe(true);
    await stop();

    await launch();
    expect(
      await app!.evaluate(({ app: electronApp }) => ({
        packaged: electronApp.isPackaged,
        profile: electronApp.getPath('userData'),
        session: electronApp.getPath('sessionData'),
        crashDumps: electronApp.getPath('crashDumps'),
        logs: electronApp.getPath('logs'),
      })),
    ).toEqual({
      packaged: true,
      profile: userDataDir,
      session: userDataDir,
      crashDumps: path.join(userDataDir, 'crashDumps'),
      logs: path.join(userDataDir, 'logs'),
    });
    let page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    expect(
      await page.evaluate(() => ({
        isolated: crossOriginIsolated,
        sab: typeof SharedArrayBuffer,
        legacy: localStorage.getItem('mesh-client:origin-e2e-marker'),
      })),
    ).toEqual({ isolated: true, sab: 'function', legacy: 'original profile' });
    expect(
      await page.evaluate(async () => {
        const wasm = await fetch('./orlp-ed25519.wasm');
        const missing = await fetch('./missing-origin-smoke-asset.wasm');
        return {
          wasmStatus: wasm.status,
          wasmType: wasm.headers.get('Content-Type'),
          wasmMagic: [...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)],
          coop: wasm.headers.get('Cross-Origin-Opener-Policy'),
          coep: wasm.headers.get('Cross-Origin-Embedder-Policy'),
          corp: wasm.headers.get('Cross-Origin-Resource-Policy'),
          missingStatus: missing.status,
          missingCoop: missing.headers.get('Cross-Origin-Opener-Policy'),
          missingCoep: missing.headers.get('Cross-Origin-Embedder-Policy'),
        };
      }),
    ).toEqual({
      wasmStatus: 200,
      wasmType: 'application/wasm',
      wasmMagic: [0, 97, 115, 109],
      coop: 'same-origin',
      coep: 'credentialless',
      corp: 'same-origin',
      missingStatus: 404,
      missingCoop: 'same-origin',
      missingCoep: 'credentialless',
    });
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const url = URL.createObjectURL(
              new Blob(
                [
                  `self.onmessage = event => {
                    new Uint8Array(event.data)[0] = 42;
                    self.postMessage({ isolated: self.crossOriginIsolated });
                  };`,
                ],
                { type: 'application/javascript' },
              ),
            );
            const worker = new Worker(url);
            const shared = new SharedArrayBuffer(1);
            const cleanup = () => {
              worker.terminate();
              URL.revokeObjectURL(url);
              clearTimeout(timer);
            };
            const timer = setTimeout(() => {
              cleanup();
              reject(new Error('Isolated worker did not answer'));
            }, 5_000);
            worker.onmessage = (event: MessageEvent<{ isolated: boolean }>) => {
              cleanup();
              resolve({ isolated: event.data.isolated, sharedByte: new Uint8Array(shared)[0] });
            };
            worker.onerror = () => {
              cleanup();
              reject(new Error('Isolated worker failed'));
            };
            worker.postMessage(shared);
          }),
      ),
    ).toEqual({ isolated: true, sharedByte: 42 });
    expect(
      await app!.evaluate(async ({ net }) => {
        // Invalid basemap never reaches the network, but exercises the registered native handler.
        const response = await net.fetch('mesh-tiles://invalid/0/0/0.png');
        return {
          status: response.status,
          corp: response.headers.get('Cross-Origin-Resource-Policy'),
        };
      }),
    ).toEqual({ status: 400, corp: 'cross-origin' });
    expect(
      await page.evaluate(() =>
        (window as unknown as { electronAPI: ElectronAPI }).electronAPI.appSettings.getAll(),
      ),
    ).toMatchObject({
      mecpBlockedSenders: BLOCKED,
    });
    const exportPath = path.join(userDataDir, 'migration/legacy-file-origin-web-storage-v1.json');
    const originalExport = readFileSync(exportPath, 'utf8');
    expect(JSON.parse(originalExport)).toMatchObject({
      entries: { [LEGACY_MARKER]: 'original profile' },
    });
    expect(
      JSON.parse(
        readFileSync(path.join(userDataDir, 'migration/renderer-origin-migration.json'), 'utf8'),
      ),
    ).toMatchObject({ phase: 'completed', completedVersion: 1, hasCompleted: true });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await stop();

    await launch();
    page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    expect(await page.evaluate(() => localStorage.getItem('mesh-client:origin-e2e-marker'))).toBe(
      'original profile',
    );
    expect(readFileSync(exportPath, 'utf8')).toBe(originalExport);
    await stop();

    await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    expect(page.url()).toMatch(/^file:/);
    expect(await page.evaluate(() => localStorage.getItem('mesh-client:origin-e2e-marker'))).toBe(
      'original profile',
    );
  });

  test('starts a fresh isolated profile and keeps an explicit skip on the file origin', async () => {
    await launch({ MESH_CLIENT_SKIP_ORIGIN_MIGRATION: '1' });
    let page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    expect(page.url()).toMatch(/^file:/);
    expect(existsSync(path.join(userDataDir, 'migration'))).toBe(false);
    await stop();
    await launch();
    page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  });

  test('explicit clear reloads without restoring recovery data or queued durable writes', async () => {
    test.setTimeout(180_000);
    writeFileSync(
      path.join(userDataDir, 'seed.json'),
      JSON.stringify({
        [LEGACY_MARKER]: 'must be deleted',
        'mesh-client:mecpBlockedSenders': BLOCKED,
      }),
    );
    await launch({ MESH_E2E_SEED_LEGACY: '1' });
    await expect.poll(() => existsSync(path.join(userDataDir, 'seed-complete'))).toBe(true);
    await stop();
    await launch();
    let page = await app!.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
    await page.evaluate(async (blocked) => {
      const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
      for (const key of [
        'chatLastRead:meshtastic',
        'chatLastRead:meshcore',
        'chatLastRead:reticulum',
        'roomsLastRead:meshcore',
        'rrcLastRead',
      ]) {
        await api.appSettings.set(key, '{"saved":123}');
      }
      await api.appSettings.set('mecpBlockedSenders', blocked);
      await api.appSettings.set(
        'takRelayPrefs',
        JSON.stringify({ state: { byIdentity: { old: {} }, retiredRooms: null }, version: 3 }),
      );
      await api.appSettings.set('locale', 'en');
      await api.db.saveIncidents({ incidents: {}, resolvedTombstones: { old: Date.now() } });
      localStorage.setItem(
        'mesh-client:durablePending:mecpBlockedSenders',
        JSON.stringify({ baseline: blocked, value: blocked }),
      );
    }, BLOCKED);
    const reloaded = page.waitForEvent('framenavigated', {
      predicate: (frame) =>
        frame === page.mainFrame() && frame.url() === 'mesh-client://renderer/index.html',
    });
    await page.evaluate((blocked) => {
      const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
      void api.clearSessionData().catch(() => {});
      // Both requests are queued from the old trusted document. Reset must synchronously fence them.
      void api.appSettings.set('mecpBlockedSenders', blocked).catch(() => {});
      void api.clearSessionData().catch(() => {});
      setTimeout(
        () => void api.appSettings.set('mecpBlockedSenders', blocked).catch(() => {}),
        100,
      );
    }, BLOCKED);
    await reloaded;

    async function expectCleared(): Promise<void> {
      await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible();
      const state = await page.evaluate(async () => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        return {
          marker: localStorage.getItem('mesh-client:origin-e2e-marker'),
          journal: localStorage.getItem('mesh-client:durablePending:mecpBlockedSenders'),
          settings: await api.appSettings.getAll(),
          incidents: await api.db.getIncidents(),
        };
      });
      expect(state).toMatchObject({
        marker: null,
        journal: null,
        incidents: { incidents: {}, resolvedTombstones: {} },
        settings: {
          'chatLastRead:meshtastic': '{}',
          'chatLastRead:meshcore': '{}',
          'chatLastRead:reticulum': '{}',
          'roomsLastRead:meshcore': '{}',
          rrcLastRead: '{}',
          mecpBlockedSenders: '{"state":{"blocked":{}},"version":1}',
          takRelayPrefs: '{"state":{"byIdentity":{},"retiredRooms":null},"version":3}',
          locale: 'en',
        },
      });
      expect(
        JSON.parse(
          readFileSync(
            path.join(userDataDir, 'migration/legacy-file-origin-web-storage-v1.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({ entries: {}, keyCount: 0 });
    }
    await expectCleared();
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    await stop();
    await launch();
    page = await app!.firstWindow();
    await expectCleared();
    await stop();
    await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    page = await app!.firstWindow();
    await expectCleared();
    expect(page.url()).toMatch(/^file:/);
  });
});
