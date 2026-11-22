import fs, { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildMainProcess, parseEsbuildMainBuildArgs } from './esbuild-main-build.mjs';

/**
 * Live traffic pop-out window handlers add ~6.2 KiB. Direct `ip-address` was removed in favor
 * of `src/shared/ipLiteral.ts` (~33 KiB savings). Scheduled Broadcasts IPC/claim CAS adds ~9 KiB.
 * Internet weather (Open-Meteo / RainViewer / NEXRAD protocol + IPC) adds ~18 KiB.
 * Terrain LOS elevation (Open-Meteo sample + SRTM HGT offline DEM IPC) adds ~6 KiB
 * (HGT offset reader + clearance/bulge math follow-ups).
 * Catch up summary / follow-up prompt text ships as sibling `ai-summary-prompt.js` and
 * `ai-follow-up-prompt.js`; the offline model catalog as `ai-local-models.js`; OS AI / MLX
 * Metal ensure+spawn as `ai-native-runtime.js`; combined identity hydration SQL as
 * `identity-hydration.js` (not in index.js). Thin install-path checks stay in index.js for
 * sync status. Keep HF catalog / prompt / native runtime / identity hydration in siblings.
 * Fair MeshCore chat hydration SQL (`selectMeshcoreMessagesForHydration`) adds a small
 * window-function query so quiet group channels are not crowded out of the newest-N load.
 * Ratspeak 1.4 enablement (`attachments_json` on reticulum messages + IPC coalesce) nudged
 * the minified main past 797 KiB.
 * Local KML/KMZ/GeoJSON map overlay import (safe XML subset + KMZ mkdtemp extract) adds ~10 KiB.
 * Tray unread BGRA/halo paint ships as sibling `tray-unread-dot.js` (not in index.js).
 * Scheduled Broadcasts create + legacy interval-CHECK strip ships as sibling
 * `scheduled-broadcasts-interval-rebuild.js` (not in index.js).
 * Environment telemetry IPC/SQL ships as sibling `environment-telemetry-handlers.js`
 * (not in index.js).
 * MQTT publishWaypoint arg validation (2.8 geofence fields) ships as sibling
 * `mqtt-publish-waypoint-validation.js` (not in index.js).
 * Windows notification SoundPlayer (#1487) ships as sibling
 * `notification-sound-play-wav.js`; index.js keeps Chromium audio-service flags plus a
 * thin sync loader (~+1 KiB).
 * Coalesced `db:saveNodes` / shared nodes upsert SQL ships as sibling `node-upsert.js`
 * (not in index.js).
 * Transient MQTT errno codes `EADDRNOTAVAIL` / `EHOSTDOWN` (macOS interface address loss)
 * tipped the minified main past 811 KiB (~+14 B); budget +1 KiB.
 * MeshCore `rx_path_hash_bytes` message column (schema + persist SQL) tipped the minified
 * main past 812 KiB (~+29 B after coerce inlining); budget +1 KiB.
 * MeshCom (CM) fourth protocol: SQLite IPC ships as sibling `meshcom-db-handlers.js` and
 * EXTUDP as `udp-bridge.js` (not in index.js). Remaining schema/TAK/BLE glue still tipped
 * the minified main past 815 KiB; budget +3 KiB.
 * MeshCom durable `chatLastRead:meshcom` (+ migration) tipped the minified main past 816 KiB
 * (~+31 B after collapsing reset rows via Object.values); budget +1 KiB.
 * MeshCom BLE host-Signal scan-RSSI seed (proxy map + connect emit + scan timeout IPC)
 * tipped the minified main past 817 KiB (~+0.9 KiB after helper trim); budget +1 KiB.
 * Windows Update Build Revision (UBR) OS tag for support-bundle manifests / runtime logs
 * tipped the minified main past 818 KiB (~+0.6 KiB); budget +1 KiB (sibling loader would
 * cost more than the helper).
 * Shared `pathUnderRoot` containment helpers (Semgrep path-join hardening across
 * attachments / offline maps / TAK / Reticulum) tipped the minified main past 819 KiB
 * (~+0.45 KiB); budget +1 KiB (a sibling chunk would cost more than the helper).
 */
const MAIN_BUNDLE_SIZE_BUDGET_BYTES = 820 * 1024;

/**
 * AI / contributor remediation when measured `index.js` exceeds the budget.
 * Prefer sibling chunks and externals; raise the budget only as a last resort.
 * @param {number} size
 * @returns {string}
 */
export function formatMainBundleOverBudgetMessage(size) {
  const sizeKiB = (size / 1024).toFixed(1);
  const budgetKiB = (MAIN_BUNDLE_SIZE_BUDGET_BYTES / 1024).toFixed(0);
  return [
    `Main process bundle over budget: ${size} bytes (${sizeKiB} KiB); limit is ${MAIN_BUNDLE_SIZE_BUDGET_BYTES} bytes (${budgetKiB} KiB).`,
    '',
    'AI / contributor remediation (do these in order — do not raise the budget first):',
    '1. Move bulky or new main-process code into a sibling esbuild entry in scripts/esbuild-main-build.mjs',
    '   (existing pattern: ai-summary-prompt.js, identity-hydration.js, tray-unread-dot.js,',
    '   scheduled-broadcasts-interval-rebuild.js, team-roster-handlers.js,',
    '   environment-telemetry-handlers.js, notification-sound-play-wav.js, node-upsert.js,',
    '   meshcom-db-handlers.js, udp-bridge.js) so it is NOT counted',
    '   in the measured dist-electron/main/index.js budget.',
    '2. Prefer marking large deps as external in scripts/esbuild-main-externals.mjs when safe',
    '   (same pattern as undici/ws).',
    '3. Analyze composition: pnpm run build:main:minify-meta then inspect dist-electron/main/meta.json',
    '   (upload to https://esbuild.github.io/analyze/).',
    '4. ONLY if there is absolutely no other way after exhausting (1)-(3), raise',
    '   MAIN_BUNDLE_SIZE_BUDGET_BYTES in scripts/esbuild-main-build.test.mjs and document the KiB',
    '   delta + reason in the comment block above that constant and in the PR body.',
    '   Never raise the budget for convenience.',
  ].join('\n');
}

function expectMainBundleSize(outfile) {
  const { size } = fs.statSync(outfile);
  expect(size).toBeGreaterThan(100_000);
  if (size >= MAIN_BUNDLE_SIZE_BUDGET_BYTES) {
    throw new Error(formatMainBundleOverBudgetMessage(size));
  }
}

describe('esbuild-main-build', () => {
  /** @type {string | null} */
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('parses minify and metafile flags', () => {
    expect(parseEsbuildMainBuildArgs(['--minify'])).toEqual({
      minify: true,
      metafilePath: null,
    });
    expect(parseEsbuildMainBuildArgs(['--metafile=dist-electron/main/metafile.json'])).toEqual({
      minify: false,
      metafilePath: 'dist-electron/main/metafile.json',
    });
    expect(
      parseEsbuildMainBuildArgs(['--minify', '--metafile=dist-electron/main/meta.json']),
    ).toEqual({
      minify: true,
      metafilePath: 'dist-electron/main/meta.json',
    });
  });

  it('rejects unknown CLI flags', () => {
    expect(() => parseEsbuildMainBuildArgs(['--watch'])).toThrow(/Unknown/);
  });

  it.each([
    [100_001, true],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES - 1, true],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES, false],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES + 1, false],
    [0, false],
    [100_000, false],
  ])('enforces the strict budget for a %i-byte fixture (accepted: %s)', (bytes, accepted) => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-main-budget-'));
    const outfile = path.join(tempDir, 'index.js');
    fs.writeFileSync(outfile, Buffer.alloc(bytes));
    if (accepted) expectMainBundleSize(outfile);
    else expect(() => expectMainBundleSize(outfile)).toThrow();
  });

  it('emits AI remediation text when over budget', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-main-budget-msg-'));
    const outfile = path.join(tempDir, 'index.js');
    const overBytes = MAIN_BUNDLE_SIZE_BUDGET_BYTES + 1;
    fs.writeFileSync(outfile, Buffer.alloc(overBytes));
    expect(() => expectMainBundleSize(outfile)).toThrow(
      formatMainBundleOverBudgetMessage(overBytes),
    );
    const message = formatMainBundleOverBudgetMessage(overBytes);
    expect(message).toContain('Main process bundle over budget');
    expect(message).toContain('sibling esbuild entry');
    expect(message).toContain('esbuild-main-externals.mjs');
    expect(message).toContain('build:main:minify-meta');
    expect(message).toContain('ONLY if there is absolutely no other way');
    expect(message).toContain('Never raise the budget for convenience');
  });

  it('uses the esbuild JS API instead of spawning bin/esbuild (Windows shim)', () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'esbuild-main-build.mjs'),
      'utf8',
    );
    // Regression: spawnSync(require.resolve('esbuild/bin/esbuild')) fails on win32 where
    // postinstall leaves bin/esbuild as a Node shim (maybeOptimizePackage skips win32).
    expect(src).toContain("from 'esbuild'");
    expect(src).toMatch(/\besbuild\.build\s*\(/);
    expect(src).not.toMatch(/\bspawnSync\s*\(/);
    expect(src).not.toContain("require.resolve('esbuild/bin/esbuild')");
    expect(src).not.toMatch(/\bchild_process\b/);
  });

  it(
    'keeps the minified main bundle under the size budget (undici/ws external)',
    { timeout: 60_000 },
    async () => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-main-bundle-'));
      const outfile = path.join(tempDir, 'index.js');
      await buildMainProcess({ minify: true, outfile });
      const summaryPromptBytes = fs.readFileSync(path.join(tempDir, 'ai-summary-prompt.js'));
      expect(summaryPromptBytes.length).toBeGreaterThan(1_000);
      expect(summaryPromptBytes.toString('utf8')).toContain('buildAiSummaryPrompt');
      const followUpPromptBytes = fs.readFileSync(path.join(tempDir, 'ai-follow-up-prompt.js'));
      expect(followUpPromptBytes.length).toBeGreaterThan(1_000);
      expect(followUpPromptBytes.toString('utf8')).toContain('buildAiFollowUpPrompt');
      const localModelsBytes = fs.readFileSync(path.join(tempDir, 'ai-local-models.js'));
      expect(localModelsBytes.length).toBeGreaterThan(1_000);
      expect(localModelsBytes.toString('utf8')).toContain('AI_LOCAL_MODELS');
      const nativeRuntimeBytes = fs.readFileSync(path.join(tempDir, 'ai-native-runtime.js'));
      expect(nativeRuntimeBytes.length).toBeGreaterThan(1_000);
      expect(nativeRuntimeBytes.toString('utf8')).toContain('ensureMlxHelper');
      const identityHydrationBytes = fs.readFileSync(path.join(tempDir, 'identity-hydration.js'));
      expect(identityHydrationBytes.length).toBeGreaterThan(500);
      expect(identityHydrationBytes.toString('utf8')).toContain('readMeshtasticIdentityHydration');
      const teamRosterBytes = fs.readFileSync(path.join(tempDir, 'team-roster-handlers.js'));
      expect(teamRosterBytes.length).toBeGreaterThan(500);
      expect(teamRosterBytes.toString('utf8')).toContain('registerTeamRosterIpcHandlers');
      const teamRosterFallbackBytes = fs.readFileSync(
        path.join(tempDir, 'team-roster-handlers-fallback.js'),
      );
      expect(teamRosterFallbackBytes.length).toBeGreaterThan(200);
      expect(teamRosterFallbackBytes.toString('utf8')).toContain(
        'registerTeamRosterIpcFallbackHandlers',
      );
      const environmentTelemetryBytes = fs.readFileSync(
        path.join(tempDir, 'environment-telemetry-handlers.js'),
      );
      expect(environmentTelemetryBytes.length).toBeGreaterThan(500);
      expect(environmentTelemetryBytes.toString('utf8')).toContain(
        'registerEnvironmentTelemetryIpcHandlers',
      );
      const environmentTelemetryFallbackBytes = fs.readFileSync(
        path.join(tempDir, 'environment-telemetry-handlers-fallback.js'),
      );
      expect(environmentTelemetryFallbackBytes.length).toBeGreaterThan(200);
      expect(environmentTelemetryFallbackBytes.toString('utf8')).toContain(
        'registerEnvironmentTelemetryIpcFallbackHandlers',
      );
      const trayUnreadDotBytes = fs.readFileSync(path.join(tempDir, 'tray-unread-dot.js'));
      expect(trayUnreadDotBytes.length).toBeGreaterThan(200);
      expect(trayUnreadDotBytes.toString('utf8')).toContain('paintTrayUnreadDot');
      const scheduledBroadcastsRebuildBytes = fs.readFileSync(
        path.join(tempDir, 'scheduled-broadcasts-interval-rebuild.js'),
      );
      expect(scheduledBroadcastsRebuildBytes.length).toBeGreaterThan(200);
      expect(scheduledBroadcastsRebuildBytes.toString('utf8')).toContain(
        'ensureScheduledBroadcastsTable',
      );
      expect(scheduledBroadcastsRebuildBytes.toString('utf8')).toContain(
        'rebuildScheduledBroadcastsIntervalCheckIfNeeded',
      );
      const mqttWaypointValidationBytes = fs.readFileSync(
        path.join(tempDir, 'mqtt-publish-waypoint-validation.js'),
      );
      expect(mqttWaypointValidationBytes.length).toBeGreaterThan(200);
      expect(mqttWaypointValidationBytes.toString('utf8')).toContain(
        'validateMqttPublishWaypointArgs',
      );
      expect(mqttWaypointValidationBytes.toString('utf8')).toContain('geofenceRadius');
      const notificationSoundPlayWavBytes = fs.readFileSync(
        path.join(tempDir, 'notification-sound-play-wav.js'),
      );
      expect(notificationSoundPlayWavBytes.length).toBeGreaterThan(200);
      expect(notificationSoundPlayWavBytes.toString('utf8')).toContain('playNotificationSoundWav');
      expect(notificationSoundPlayWavBytes.toString('utf8')).toContain(
        'registerNotificationSoundPlayWavIpc',
      );
      expect(notificationSoundPlayWavBytes.toString('utf8')).toContain('MESH_NOTIF_WAV');
      const nodeUpsertBytes = fs.readFileSync(path.join(tempDir, 'node-upsert.js'));
      expect(nodeUpsertBytes.length).toBeGreaterThan(200);
      expect(nodeUpsertBytes.toString('utf8')).toContain('saveNodesBatchOn');
      expect(nodeUpsertBytes.toString('utf8')).toContain(
        "nodes.source = 'mqtt' AND excluded.source = 'rf'",
      );
      // electron must stay external — bundling the npm launcher breaks db:saveNodes in packaged main.
      expect(nodeUpsertBytes.toString('utf8')).not.toContain('path.txt');
      expect(nodeUpsertBytes.toString('utf8')).not.toContain('Downloading Electron');
      expect(nodeUpsertBytes.toString('utf8')).not.toContain('install.js');
      const meshcomDbBytes = fs.readFileSync(path.join(tempDir, 'meshcom-db-handlers.js'));
      expect(meshcomDbBytes.length).toBeGreaterThan(500);
      expect(meshcomDbBytes.toString('utf8')).toContain('registerMeshcomDbIpcHandlers');
      const meshcomDbFallbackBytes = fs.readFileSync(
        path.join(tempDir, 'meshcom-db-handlers-fallback.js'),
      );
      expect(meshcomDbFallbackBytes.length).toBeGreaterThan(200);
      expect(meshcomDbFallbackBytes.toString('utf8')).toContain(
        'registerMeshcomDbIpcFallbackHandlers',
      );
      const udpBridgeBytes = fs.readFileSync(path.join(tempDir, 'udp-bridge.js'));
      expect(udpBridgeBytes.length).toBeGreaterThan(200);
      expect(udpBridgeBytes.toString('utf8')).toContain('registerUdpBridgeIpcHandlers');
      const indexSource = fs.readFileSync(outfile, 'utf8');
      expect(indexSource).not.toContain('waypoint.geofenceRadius invalid');
      expect(mqttWaypointValidationBytes.toString('utf8')).toContain(
        'waypoint.geofenceRadius invalid',
      );
      // Windows SoundPlayer path lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain('MESH_NOTIF_WAV');
      expect(indexSource).not.toContain('mesh-notif-sound-');
      // Team roster DDL lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain('CREATE TABLE IF NOT EXISTS team_members');
      expect(teamRosterBytes.toString('utf8')).toContain('CREATE TABLE IF NOT EXISTS team_members');
      // Tray unread AA/halo paint lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain('UNREAD_DOT_RING_RGB');
      expect(trayUnreadDotBytes.toString('utf8')).toContain('UNREAD_DOT_RING_RGB');
      // Scheduled Broadcasts DDL lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain('CREATE TABLE IF NOT EXISTS scheduled_broadcasts');
      expect(scheduledBroadcastsRebuildBytes.toString('utf8')).toContain(
        'CREATE TABLE IF NOT EXISTS scheduled_broadcasts',
      );
      // Nodes upsert SQL lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain("nodes.source = 'mqtt' AND excluded.source = 'rf'");
      expect(nodeUpsertBytes.toString('utf8')).toContain(
        "nodes.source = 'mqtt' AND excluded.source = 'rf'",
      );
      expect(indexSource).not.toContain('qwen2.5-1.5b-instruct-q4_k_m.gguf');
      expect(indexSource).not.toContain('Missing Metal Toolchain');
      expect(indexSource).not.toContain('discoverXcodeDeveloperDir');
      const worker = path.join(tempDir, 'translation-worker.js');
      const workerBytes = fs.readFileSync(worker);
      expect(workerBytes.length).toBeGreaterThan(10_000);
      expect(workerBytes.toString('utf8')).not.toContain('https://firefox-settings-attachments');
      const noticeDirectory = path.join(tempDir, 'translation-licenses');
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-fastText.txt'), 'utf8')).toContain(
        'Copyright (c) 2016-present, Facebook, Inc.',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-fastText.txt'), 'utf8')).toContain(
        'Permission is hereby granted',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-MPL-2.0.txt'), 'utf8')).toContain(
        'Mozilla Public License Version 2.0',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'README.md'), 'utf8')).toContain(
        '48d55cf7ec80093903e2ef7f58b61a84a22ef716',
      );
      for (const notice of ['LICENSE-wllama.txt', 'LICENSE-llama-cpp.txt'])
        expect(fs.readFileSync(path.join(tempDir, 'ai-licenses', notice), 'utf8')).toContain(
          'Permission is hereby granted',
        );
      expectMainBundleSize(outfile);
    },
  );
});
