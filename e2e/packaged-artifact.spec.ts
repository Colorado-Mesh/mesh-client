import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type DescMessage, fromBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { build } from 'esbuild';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import type { EmergencyIncident } from '../src/shared/incidentTypes';
import type { RendererStorageDeletionState } from '../src/shared/rendererStorageIntent';
import { openAppTab, openPanel, repoRoot } from './electronApp';

const executablePath = process.env.MESH_PACKAGED_EXECUTABLE;

test.describe('actual packaged renderer artifact', () => {
  test.skip(!executablePath, 'Set MESH_PACKAGED_EXECUTABLE to the built app executable.');
  let app: ElectronApplication | undefined;
  let profile: string;
  test.beforeEach(() => {
    profile = realpathSync(mkdtempSync(path.join(tmpdir(), 'mesh-artifact-e2e-')));
  });
  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(profile, { recursive: true, force: true });
  });

  async function launch(extraEnv: Record<string, string> = {}) {
    const env = { ...process.env };
    for (const key of [
      'VITE_DEV_SERVER_URL',
      'MESH_CLIENT_FORCE_FILE_ORIGIN',
      'MESH_CLIENT_SKIP_ORIGIN_MIGRATION',
      'MESH_CLIENT_FORCE_ORIGIN_REPAIR',
    ])
      Reflect.deleteProperty(env, key);
    Object.assign(env, extraEnv);
    app = await electron.launch({
      executablePath: executablePath!,
      args: [`--user-data-dir=${profile}`],
      cwd: repoRoot,
      env: env as Record<string, string>,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('radiogroup', { name: 'Protocol switcher' })).toBeVisible({
      timeout: 45000,
    });
    expect(
      await app.evaluate(({ app: native }) => ({
        packaged: native.isPackaged,
        profile: native.getPath('userData'),
        appPath: native.getAppPath(),
      })),
    ).toMatchObject({ packaged: true, profile });
    expect(await app.evaluate(({ app: native }) => native.getAppPath())).toMatch(/app\.asar$/);
    return page;
  }

  async function seedLegacyStorage(page: Page, entries: Record<string, string>): Promise<void> {
    // Seed on the shipped inert legacy document so closing React cannot flush older
    // in-memory defaults over the fixture. Normal migration/startup is exercised afterward.
    const migrationUrl = new URL('./migration.html', page.url()).href;
    await app!.evaluate(async ({ BrowserWindow }, url) => {
      const main = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().startsWith('file:'),
      );
      if (!main) throw new Error('Legacy packaged renderer is missing');
      await main.loadURL(url);
    }, migrationUrl);
    await page.waitForURL(migrationUrl, { waitUntil: 'load' });
    await page.evaluate((seeded) => {
      for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
    }, entries);
    await app!.evaluate(({ session }) => {
      session.defaultSession.flushStorageData();
    });
  }

  test('keeps a populated legacy profile visible and editable through the shipped upgrade UI', async () => {
    test.setTimeout(240000);
    const at = Date.now() - 60_000;
    const incident: EmergencyIncident = {
      id: 'artifact-upgrade-incident',
      protocol: 'meshtastic',
      protocolsSeen: ['meshtastic'],
      severity: 2,
      codes: ['A01'],
      freetext: 'COI upgrade synthetic incident, no radio transmission',
      senderId: '42',
      senderName: 'Upgrade Incident Station',
      channel: '0',
      receivedAt: at,
      lastSeenAt: at,
      seenAt: at,
      coordsSource: null,
      messageIds: ['artifact-message'],
      ackCount: 0,
      ackPeerIds: [],
      beaconActive: false,
      beaconAcked: false,
      isDrill: true,
      status: 'open',
      events: [{ at, kind: 'received', protocol: 'meshtastic' }],
    };
    const takPrefs = {
      state: {
        byIdentity: {
          'meshcore:artifact-radio': {
            trackerChannels: [0],
            channelMode: 'selected',
            chatChannels: ['0123456789abcdef'],
            sendChannels: [],
            remoteChannels: ['0123456789abcdef'],
            noCallsignChannels: [],
            atakNames: { '0123456789abcdef': 'Upgrade TAK channel' },
            directMessages: true,
          },
        },
        retiredRooms: null,
      },
      version: 3,
    };
    const entries: Record<string, string> = {
      'mesh-client:protocol': 'meshtastic',
      'mesh-client:chatMacros': JSON.stringify({
        state: {
          slots: [{ label: 'Upgrade macro', text: 'Original upgrade macro text' }],
          size: 'medium',
          sendMode: 'insert',
          collapsed: false,
        },
        version: 1,
      }),
      'mesh-client:incidents': JSON.stringify({
        state: { incidents: { [incident.id]: incident }, resolvedTombstones: {} },
        version: 3,
      }),
      'mesh-client:mecpBlockedSenders': JSON.stringify({
        state: {
          blocked: {
            'meshcore:artifact-blocked': {
              protocol: 'meshcore',
              senderId: 'artifact-blocked',
              label: 'Upgrade blocked sender',
              createdAt: at,
            },
          },
        },
        version: 1,
      }),
      'mesh-client:takRelayPrefs': JSON.stringify(takPrefs),
      'mesh-client:lastRead:meshtastic': JSON.stringify({ 'ch:0': at }),
      'mesh-client:lastRead:meshcore': JSON.stringify({ 'ch:0': at }),
      'mesh-client:lastRead:reticulum': JSON.stringify({ 'dm:123': at }),
      'mesh-client:roomsLastRead:meshcore': JSON.stringify({ 123: at }),
      'mesh-client:lastRead:rrc': JSON.stringify({ 'artifact.example|upgrade': at }),
      'mesh-client:launcherPins': JSON.stringify(['Incident', 'Connection']),
      'mesh-client:appSettings': JSON.stringify({
        distanceFilterEnabled: true,
        distanceFilterMax: 321,
        distanceUnit: 'km',
        shareMyLocation: false,
        reticulumAutostart: false,
        mecpStandingAlertEnabled: false,
      }),
      'mesh-client:mqttSettings': JSON.stringify({
        server: 'upgrade-broker.invalid',
        port: 8883,
        username: 'upgrade-user',
        topicPrefix: 'msh/UPGRADE/',
        autoLaunch: false,
        tlsEnabled: true,
        useWebSocket: false,
        maxRetries: 7,
      }),
    };
    let page = await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    await page.evaluate(async (timestamp) => {
      const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
      await api.db.saveMessage({
        sender_id: 1001,
        sender_name: 'Upgrade read sender',
        payload: 'Previously read upgrade message',
        channel: 0,
        timestamp,
      });
      await api.db.saveMessage({
        sender_id: 1002,
        sender_name: 'Upgrade unread sender',
        payload: 'One unread upgrade message',
        channel: 0,
        timestamp: timestamp + 1000,
      });
    }, at);
    await seedLegacyStorage(page, entries);
    await app!.close();
    app = undefined;

    // Reproduce an older install: the forced-file bootstrap above uses current code and
    // initializes empty durable rows. Remove only these new domains after it exits, keeping
    // ordinary history/settings and every legacy localStorage entry intact.
    const legacyDb = new DatabaseSync(path.join(profile, 'mesh-client.db'));
    try {
      legacyDb.exec(`
        DELETE FROM app_settings WHERE key IN (
          'chatLastRead:meshtastic', 'chatLastRead:meshcore', 'chatLastRead:reticulum',
          'roomsLastRead:meshcore', 'rrcLastRead', 'mecpBlockedSenders', 'takRelayPrefs'
        );
        DELETE FROM emergency_incidents;
        DELETE FROM emergency_incident_tombstones;
        DELETE FROM emergency_incident_storage;
      `);
    } finally {
      legacyDb.close();
    }

    async function expectProfileInUi(current: Page, edited: boolean): Promise<void> {
      const nav = current.getByRole('navigation', { name: 'Application panels' });
      await expect(nav.locator('[data-rail-pin]')).toHaveCount(2);
      await expect(nav.locator('[data-rail-pin]').first()).toHaveAccessibleName(/^Incident \(/);
      await nav.locator('[data-rail-pin]').first().click();
      const incidents = current.getByRole('list', { name: 'Open emergency incidents' });
      await expect(incidents).toContainText('Upgrade Incident Station');
      await expect(incidents).toContainText(incident.freetext);
      await expect(incidents).toContainText('Drill');

      await openAppTab(current);
      const mecp = current.locator('details').filter({
        has: current.getByRole('heading', { name: 'MECP', exact: true }),
      });
      if ((await mecp.getAttribute('open')) === null) await mecp.locator('summary').click();
      const blocks = current.locator('[data-setting-anchor="app.mecp.blockedSenders"]');
      await blocks.scrollIntoViewIfNeeded();
      await expect(blocks).toContainText('Upgrade blocked sender');
      await expect(
        blocks.getByRole('button', {
          name: 'Unblock emergency alerts from Upgrade blocked sender',
        }),
      ).toBeVisible();
      await expect(current.locator('#apppanel-distance-unit')).toHaveValue(edited ? 'miles' : 'km');
      await expect(current.locator('#apppanel-max-distance')).toHaveValue(edited ? '654' : '321');

      await openPanel(current, 'Device', 'Connection');
      await expect(current.locator('#mqtt-server')).toHaveValue('upgrade-broker.invalid');
      await expect(current.locator('#mqtt-port')).toHaveValue('8883');
      await expect(current.locator('#mqtt-username')).toHaveValue('upgrade-user');
      await expect(current.locator('#mqtt-topic-prefix')).toHaveValue(
        edited ? 'msh/EDITED/' : 'msh/UPGRADE/',
      );
      await expect(current.locator('#mqtt-tls-enabled')).toBeChecked();
      await expect(
        current.getByLabel('Auto-connect on application start', { exact: true }),
      ).not.toBeChecked();

      await openPanel(current, 'Chat');
      await expect(
        current.getByText('Previously read upgrade message', { exact: true }),
      ).toBeVisible();
      await expect(current.getByText('One unread upgrade message', { exact: true })).toBeVisible();
      await current.getByRole('button', { name: 'Edit macros', exact: true }).click();
      const macros = current.getByRole('dialog', { name: 'Edit macros' });
      await expect(macros.getByLabel('F1 button label')).toHaveValue('Upgrade macro');
      await expect(macros.getByLabel('F1 message text')).toHaveValue(
        edited ? 'Edited upgrade macro text' : 'Original upgrade macro text',
      );
      await macros.getByRole('button', { name: 'Close', exact: true }).click();
    }

    page = await launch();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    // Verify the original read boundary before opening Chat can legitimately advance it.
    await expect(
      page.getByRole('navigation', { name: 'Application panels' }).getByRole('button', {
        name: 'Chat, 1 unread',
        exact: true,
      }),
    ).toBeVisible();
    const exportPath = path.join(profile, 'migration/legacy-file-origin-web-storage-v1.json');
    const originalExport = readFileSync(exportPath, 'utf8');
    expect(JSON.parse(originalExport).entries).toMatchObject(entries);
    await expectProfileInUi(page, false);
    await page.screenshot({
      path: 'test-results/packaged-populated-upgrade-chat.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Edit macros', exact: true }).click();
    const macros = page.getByRole('dialog', { name: 'Edit macros' });
    await macros.getByLabel('F1 message text').fill('Edited upgrade macro text');
    await macros.getByRole('button', { name: 'Close', exact: true }).click();
    await openAppTab(page);
    await page.locator('#apppanel-distance-unit').selectOption('miles');
    await page.locator('#apppanel-max-distance').fill('654');
    await openPanel(page, 'Device', 'Connection');
    await page.locator('#mqtt-topic-prefix').fill('msh/EDITED/');
    await page.locator('#mqtt-topic-prefix').blur();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('mesh-client:mqttSettings')))
      .toContain('msh/EDITED/');
    // These preferences are hidden until an actual radio identity and TAK sink are active.
    // Verify their durable migration here; control rendering/relay behavior needs that setup.
    expect(
      await page.evaluate(async () => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        const settings = await api.appSettings.getAll();
        return JSON.parse(settings.takRelayPrefs);
      }),
    ).toEqual(takPrefs);
    await app!.close();
    app = undefined;

    page = await launch();
    await expectProfileInUi(page, true);
    expect(readFileSync(exportPath, 'utf8')).toBe(originalExport);
    await page.screenshot({
      path: 'test-results/packaged-populated-upgrade-relaunch.png',
      fullPage: true,
    });
    expect(
      await page.evaluate(async () => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        return (await api.db.getIncidents()).incidents['artifact-upgrade-incident']?.senderName;
      }),
    ).toBe('Upgrade Incident Station');
  });

  test('does not replay an imported file-origin delete after a newer saved connection', async () => {
    test.setTimeout(240000);
    const storageKey = 'mesh-client:lastConnection:meshtastic';
    const markerKey = `mesh-client:deletedStorage:${storageKey}`;
    const settingKey = `rendererDeletedStorage:${storageKey}`;
    const importedIntent = {
      id: 'artifact-file-delete-before-upgrade',
      origin: 'file:',
      deleted: true,
    };
    const newConnection = { type: 'ble', bleDeviceName: 'New synthetic saved connection' };
    let page = await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    // No peripheral ID is seeded, so RF auto-connect cannot attempt a real connection.
    await seedLegacyStorage(page, {
      [storageKey]: JSON.stringify({ type: 'ble', bleDeviceName: 'Old synthetic connection' }),
      [markerKey]: JSON.stringify(importedIntent),
    });
    await app!.close();
    app = undefined;

    page = await launch();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    async function readCanonical(current: Page): Promise<RendererStorageDeletionState | null> {
      return current.evaluate(async (key) => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        const raw = (await api.appSettings.getAll())[key];
        return raw ? JSON.parse(raw) : null;
      }, settingKey);
    }
    await expect
      .poll(() => readCanonical(page))
      .toMatchObject({
        deleted: true,
        imported: { 'file:': importedIntent.id },
      });
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();

    // Seed the committed state after newer edits on both origins. Advancing the ordinary
    // file receipt is essential: only the permanent import receipt can consume the old A.
    await page.evaluate(
      async ({ storageKey: key, settingKey: canonicalKey, connection }) => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        const state: RendererStorageDeletionState = JSON.parse(
          (await api.appSettings.getAll())[canonicalKey],
        );
        localStorage.setItem(key, JSON.stringify(connection));
        await api.appSettings.set(
          canonicalKey,
          JSON.stringify({
            ...state,
            deleted: false,
            applied: {
              ...state.applied,
              'file:': 'artifact-newer-file-edit',
              'mesh-client://renderer': 'artifact-custom-recreation',
            },
          }),
        );
      },
      { storageKey, settingKey, connection: newConnection },
    );
    await page.reload();
    await expect(page.getByText(newConnection.bleDeviceName, { exact: true })).toBeVisible();
    const recreatedState = await readCanonical(page);
    await expect(
      page.evaluate(async (key) => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        await api.appSettings.remove(key);
      }, settingKey),
    ).rejects.toThrow(/key not allowed/);
    expect(await readCanonical(page)).toEqual(recreatedState);
    expect(recreatedState).toMatchObject({
      deleted: false,
      imported: { 'file:': importedIntent.id },
      applied: { 'file:': 'artifact-newer-file-edit' },
    });
    await app!.close();
    app = undefined;

    page = await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    expect(page.url()).toMatch(/^file:/);
    // This is the untouched original source journal, not a mocked IPC or fabricated renderer.
    // The real startup flush must consume it without reverting the canonical recreation.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), markerKey))
      .toBeNull();
    expect(await readCanonical(page)).toEqual(recreatedState);
    await app!.close();
    app = undefined;

    page = await launch();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    await expect(page.getByText(newConnection.bleDeviceName, { exact: true })).toBeVisible();
    expect(await readCanonical(page)).toEqual(recreatedState);
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey),
    ).toEqual(newConnection);
    await page.screenshot({
      path: 'test-results/packaged-cross-origin-delete-receipt.png',
      fullPage: true,
    });
  });

  test('boots the shipped ASAR, runs the encoder source under COI and repairs partial critical loss', async () => {
    test.setTimeout(180000);
    let page = await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    await page.evaluate(() => {
      localStorage.setItem('mesh-client:protocol', 'meshcore');
      localStorage.setItem(
        'mesh-client:chatMacros',
        JSON.stringify({
          state: {
            slots: [{ label: 'COI test', text: 'COI upgrade test' }],
            size: null,
            sendMode: 'insert',
            collapsed: false,
          },
          version: 1,
        }),
      );
    });
    await app!.close();
    app = undefined;
    page = await launch();
    expect(page.url()).toBe('mesh-client://renderer/index.html');
    expect(
      await page.evaluate(() => ({
        isolated: crossOriginIsolated,
        shared: typeof SharedArrayBuffer,
      })),
    ).toEqual({ isolated: true, shared: 'function' });
    // The legacy encoder currently has no production importer. Exercise its real source
    // under the shipped origin without adding an unused asset to the application bundle.
    const bundled = await build({
      entryPoints: [path.join(repoRoot, 'src/renderer/workers/messageEncoder.worker.ts')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const workerSource = bundled.outputFiles[0].text;
    const result = await page.evaluate(
      (source) =>
        new Promise<{ type: string; id: string; bytes: number[] }>((resolve, reject) => {
          const blobUrl = URL.createObjectURL(
            new Blob([source], { type: 'application/javascript' }),
          );
          const encoder = new Worker(blobUrl, {
            type: 'module',
          });
          const timer = setTimeout(() => {
            encoder.terminate();
            URL.revokeObjectURL(blobUrl);
            reject(new Error('Actual Meshtastic encoder did not respond'));
          }, 10000);
          encoder.onerror = () => {
            clearTimeout(timer);
            encoder.terminate();
            URL.revokeObjectURL(blobUrl);
            reject(new Error('Actual Meshtastic encoder worker failed'));
          };
          encoder.onmessage = (
            event: MessageEvent<{ type: string; id: string; buffer: ArrayBuffer }>,
          ) => {
            clearTimeout(timer);
            encoder.terminate();
            URL.revokeObjectURL(blobUrl);
            resolve({
              type: event.data.type,
              id: event.data.id,
              bytes: Array.from(new Uint8Array(event.data.buffer)),
            });
          };
          encoder.postMessage({
            type: 'ENCODE_MESSAGE',
            id: 'packaged-coi-test',
            text: 'COI synthetic Meshtastic message',
            from: 123,
            dest: 456,
            channel: 0,
          });
        }),
      workerSource,
    );
    expect(result).toMatchObject({ type: 'ENCODED', id: 'packaged-coi-test' });
    const packet = fromBinary(
      Mesh.ToRadioSchema as unknown as DescMessage,
      new Uint8Array(result.bytes),
    );
    expect(packet).toMatchObject({
      payloadVariant: {
        case: 'packet',
        value: {
          from: 123,
          to: 456,
          channel: 0,
          payloadVariant: {
            case: 'decoded',
            value: { payload: new TextEncoder().encode('COI synthetic Meshtastic message') },
          },
        },
      },
    });

    await openAppTab(page);
    const memory = page.locator('[data-setting-anchor="app.support.rendererMemory"]');
    await expect(memory).toBeVisible();
    await memory.getByRole('button', { name: 'Sample now' }).click();
    await expect(memory).toContainText('Latest estimate:');
    await expect(memory).toContainText('Renderer process memory (physical RAM)');
    await memory.getByRole('button', { name: 'Sample now' }).click();
    await memory.getByText('Recent samples', { exact: true }).click();
    await expect(memory.locator('li')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/packaged-artifact-support.png', fullPage: true });
    const exportPath = path.join(profile, 'migration/legacy-file-origin-web-storage-v1.json');
    const originalExport = readFileSync(exportPath, 'utf8');
    await page.evaluate(() => {
      localStorage.removeItem('mesh-client:chatMacros');
      localStorage.setItem('mesh-client:protocol', 'reticulum');
    });
    await app!.close();
    app = undefined;
    page = await launch();
    expect(await page.evaluate(() => localStorage.getItem('mesh-client:chatMacros'))).toContain(
      'COI upgrade test',
    );
    expect(await page.evaluate(() => localStorage.getItem('mesh-client:protocol'))).toBe(
      'reticulum',
    );
    expect(readFileSync(exportPath, 'utf8')).toBe(originalExport);
    await app!.close();
    app = undefined;
    page = await launch({ MESH_CLIENT_FORCE_FILE_ORIGIN: '1' });
    expect(page.url()).toMatch(/^file:/);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    await openAppTab(page);
    await expect(
      page
        .locator('[data-setting-anchor="app.support.rendererMemory"]')
        .getByRole('button', { name: 'Sample now' }),
    ).toBeDisabled();
  });
});
