#!/usr/bin/env node
/**
 * Dev orchestrator: runs main/preload esbuild watch, Vite, and Electron via concurrently.
 * Uses direct esbuild/vite binaries (not nested `pnpm run`) so signal shutdown does not
 * produce pnpm ELIFECYCLE noise when Electron exits or the terminal sends SIGINT.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mainEsbuildExternalArgs } from './esbuild-main-externals.mjs';
import { assertPnpmMeetsRepoRequirement } from './check-package-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** @param {number | null} code @param {NodeJS.Signals | null} signal */
export function resolveDevExitCode(code, signal) {
  if (signal === 'SIGINT' || signal === 'SIGTERM') return 0;
  if (code === 0 || code === null) return 0;
  return code;
}

export function buildDevConcurrentlyArgs() {
  const mainBuild = `esbuild src/main/index.ts --bundle --platform=node --outfile=dist-electron/main/index.js ${mainEsbuildExternalArgs().join(' ')} --format=cjs --define:process.env.VITEST=undefined --watch`;
  const preloadBuild =
    'esbuild src/preload/index.ts --bundle --platform=node --outfile=dist-electron/preload/index.js --external:electron --format=cjs --watch';
  const translationBuild =
    'esbuild src/main/translation/bergamotWorkerEntry.ts --bundle --platform=node --outfile=dist-electron/main/translation-worker.js --format=cjs --watch';
  const summaryPromptBuild =
    'esbuild src/shared/aiSummaryPrompt.ts --bundle --platform=node --outfile=dist-electron/main/ai-summary-prompt.js --format=cjs --watch';
  const followUpPromptBuild =
    'esbuild src/shared/aiFollowUpPrompt.ts --bundle --platform=node --outfile=dist-electron/main/ai-follow-up-prompt.js --format=cjs --watch';
  const localModelsBuild =
    'esbuild src/main/ai/local/modelCatalogData.ts --bundle --platform=node --outfile=dist-electron/main/ai-local-models.js --format=cjs --watch';
  const nativeAiRuntimeBuild =
    'esbuild src/main/ai/nativeRuntime.ts --bundle --platform=node --outfile=dist-electron/main/ai-native-runtime.js --format=cjs --watch';
  const identityHydrationBuild =
    'esbuild src/main/identityHydrationSnapshot.ts --bundle --platform=node --outfile=dist-electron/main/identity-hydration.js --format=cjs --watch';
  const teamRosterBuild =
    'esbuild src/main/ipc/team-roster-handlers.ts --bundle --platform=node --outfile=dist-electron/main/team-roster-handlers.js --format=cjs --watch';
  const teamRosterFallbackBuild =
    'esbuild src/main/ipc/team-roster-handlers-fallback.ts --bundle --platform=node --outfile=dist-electron/main/team-roster-handlers-fallback.js --format=cjs --watch';
  const trayUnreadDotBuild =
    'esbuild src/main/trayUnreadDot.ts --bundle --platform=node --outfile=dist-electron/main/tray-unread-dot.js --format=cjs --watch';
  const electronLaunch =
    'node scripts/wait-for-dev.mjs && VITE_DEV_SERVER_URL=http://localhost:5173 ELECTRON_ENABLE_SECURITY_WARNINGS=1 electron .';

  return [
    '-k',
    '-s',
    'command-electron',
    '--names',
    'main,preload,translation,summary,followup,models,nativeai,identity,teamroster,rosterfb,traydot,vite,electron',
    mainBuild,
    preloadBuild,
    translationBuild,
    summaryPromptBuild,
    followUpPromptBuild,
    localModelsBuild,
    nativeAiRuntimeBuild,
    identityHydrationBuild,
    teamRosterBuild,
    teamRosterFallbackBuild,
    trayUnreadDotBuild,
    'vite',
    electronLaunch,
  ];
}

export function runDev(argv = process.argv.slice(2), options = {}) {
  const assertPm = options.assertPnpmMeetsRepoRequirement ?? assertPnpmMeetsRepoRequirement;
  const spawnFn = options.spawn ?? spawn;
  const exitFn = options.exit ?? ((code) => process.exit(code));

  if (argv.length > 0) {
    console.error('[run-dev] Unexpected arguments:', argv.join(' '));
    exitFn(1);
    return;
  }

  const pmExit = assertPm({ repoRoot: projectRoot });
  if (pmExit !== 0) {
    exitFn(pmExit);
    return;
  }

  const concurrentlyBin = path.join(projectRoot, 'node_modules', '.bin', 'concurrently');
  const child = spawnFn(concurrentlyBin, buildDevConcurrentlyArgs(), {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error('[run-dev] Failed to start concurrently:', err);
    exitFn(1);
  });

  child.on('exit', (code, signal) => {
    exitFn(resolveDevExitCode(code, signal));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDev();
}
