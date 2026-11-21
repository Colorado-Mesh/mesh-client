#!/usr/bin/env node
/**
 * Build the Electron main process with shared external package list.
 * Usage: node scripts/esbuild-main-build.mjs [--minify] [--metafile=path]
 *
 * When MESH_CLIENT_BUILD_INFO is set (CI packaging), embeds it via esbuild define
 * as __MESH_CLIENT_BUILD_INFO__ for src/shared/buildInfo.ts.
 *
 * Uses the esbuild JS API (not a direct spawn of bin/esbuild). On Windows, postinstall leaves
 * bin/esbuild as a Node shim — execFile of that path fails with no stdout (EINVAL).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAIN_ESBUILD_EXTERNALS } from './esbuild-main-externals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * @param {string[]} argv
 * @returns {{ minify: boolean, metafilePath: string | null }}
 */
export function parseEsbuildMainBuildArgs(argv) {
  let minify = false;
  /** @type {string | null} */
  let metafilePath = null;
  for (const arg of argv) {
    if (arg === '--minify') {
      minify = true;
      continue;
    }
    if (arg.startsWith('--metafile=')) {
      metafilePath = arg.slice('--metafile='.length);
      continue;
    }
    throw new Error(`Unknown esbuild-main-build argument: ${arg}`);
  }
  return { minify, metafilePath };
}

/**
 * @param {{
 *   minify?: boolean
 *   metafilePath?: string | null
 *   buildInfoRaw?: string
 *   absWorkingDir?: string
 *   outfile?: string
 * }} [opts]
 */
export async function buildMainProcess(opts = {}) {
  const minify = opts.minify === true;
  const metafilePath = opts.metafilePath ?? null;
  const buildInfoRaw = opts.buildInfoRaw ?? process.env.MESH_CLIENT_BUILD_INFO ?? '';
  const absWorkingDir = opts.absWorkingDir ?? projectRoot;
  const outfile = opts.outfile ?? 'dist-electron/main/index.js';

  const result = await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    platform: 'node',
    outfile,
    external: [...MAIN_ESBUILD_EXTERNALS],
    format: 'cjs',
    define: {
      __MESH_CLIENT_BUILD_INFO__: JSON.stringify(buildInfoRaw),
      // Drop Vitest-only Catch up prompt imports from the production main bundle.
      'process.env.VITEST': 'undefined',
    },
    minify,
    metafile: Boolean(metafilePath),
    logLevel: 'info',
  });

  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/translation/bergamotWorkerEntry.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'translation-worker.js'),
    minify,
    logLevel: 'info',
  });

  // Keep Catch up prompt text out of the measured main `index.js` budget.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/shared/aiSummaryPrompt.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'ai-summary-prompt.js'),
    minify,
    logLevel: 'info',
  });
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/shared/aiFollowUpPrompt.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'ai-follow-up-prompt.js'),
    minify,
    logLevel: 'info',
  });
  // Offline model catalog (HF pins) — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ai/local/modelCatalogData.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'ai-local-models.js'),
    minify,
    logLevel: 'info',
  });
  // OS AI / MLX Metal ensure+spawn — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ai/nativeRuntime.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'ai-native-runtime.js'),
    minify,
    logLevel: 'info',
  });
  // Combined identity hydration SQL — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/identityHydrationSnapshot.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'identity-hydration.js'),
    minify,
    logLevel: 'info',
  });
  // Team roster IPC — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/team-roster-handlers.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'team-roster-handlers.js'),
    minify,
    logLevel: 'info',
  });
  // Team roster IPC failure stubs — sibling chunk loaded only when the primary bundle fails.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/team-roster-handlers-fallback.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'team-roster-handlers-fallback.js'),
    minify,
    logLevel: 'info',
  });
  // Environment telemetry IPC — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/environment-telemetry-handlers.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'environment-telemetry-handlers.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  // Environment telemetry IPC failure stubs — sibling chunk loaded only when the primary bundle fails.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/environment-telemetry-handlers-fallback.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'environment-telemetry-handlers-fallback.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  // Tray unread BGRA overlay — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/trayUnreadDot.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'tray-unread-dot.js'),
    minify,
    logLevel: 'info',
  });
  // Scheduled-broadcasts interval CHECK strip — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/scheduledBroadcastsIntervalRebuild.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'scheduled-broadcasts-interval-rebuild.js'),
    minify,
    logLevel: 'info',
  });
  // MQTT publishWaypoint arg validation (incl. 2.8 geofence) — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/mqttPublishWaypointValidation.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'mqtt-publish-waypoint-validation.js'),
    minify,
    logLevel: 'info',
  });
  // Windows notification SoundPlayer (#1487) — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/notificationSoundPlayWav.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'notification-sound-play-wav.js'),
    minify,
    logLevel: 'info',
  });
  // Shared nodes upsert SQL + batch helpers — keep out of measured main `index.js`.
  // Externalize electron: meshtasticNodeRenumber → log-service imports `app`; bundling the
  // npm launcher into this sibling makes require() run install.js / throw in packaged main.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/nodeUpsert.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'node-upsert.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  // MeshCom SQLite IPC — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/meshcom-db-handlers.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'meshcom-db-handlers.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  // MeshCom SQLite IPC failure stubs — sibling chunk loaded only when the primary bundle fails.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/meshcom-db-handlers-fallback.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'meshcom-db-handlers-fallback.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  // MeshCom EXTUDP bridge — keep out of measured main `index.js`.
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/udp-bridge.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'udp-bridge.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/loadMeshcomUdpBridge.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'loadMeshcomUdpBridge.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });
  await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/ipc/udp-bridge-fallback.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(path.dirname(outfile), 'udp-bridge-fallback.js'),
    external: ['electron'],
    minify,
    logLevel: 'info',
  });

  const noticeDirectory = path.resolve(
    absWorkingDir,
    path.dirname(outfile),
    'translation-licenses',
  );
  fs.mkdirSync(noticeDirectory, { recursive: true });
  for (const notice of ['LICENSE-MPL-2.0.txt', 'LICENSE-fastText.txt', 'README.md']) {
    fs.copyFileSync(
      path.resolve(absWorkingDir, 'src/main/translation/vendor', notice),
      path.join(noticeDirectory, notice),
    );
  }

  const aiNoticeDirectory = path.resolve(absWorkingDir, path.dirname(outfile), 'ai-licenses');
  fs.mkdirSync(aiNoticeDirectory, { recursive: true });
  for (const notice of ['LICENSE-wllama.txt', 'LICENSE-llama-cpp.txt']) {
    fs.copyFileSync(
      path.resolve(absWorkingDir, 'src/main/ai/vendor', notice),
      path.join(aiNoticeDirectory, notice),
    );
  }

  if (metafilePath && result.metafile) {
    const outPath = path.resolve(absWorkingDir, metafilePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result.metafile));
  }

  return result;
}

async function main() {
  const { minify, metafilePath } = parseEsbuildMainBuildArgs(process.argv.slice(2));
  await buildMainProcess({ minify, metafilePath });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
