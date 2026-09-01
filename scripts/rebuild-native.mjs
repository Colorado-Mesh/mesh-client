#!/usr/bin/env node
// Rebuilds native Node.js addons (currently @stoprocent/noble) for the
// installed Electron version using electron-builder install-app-deps.
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  ensureElectronBinaryInstalled,
  projectRoot,
  resolveLocalElectronBin,
} from './electron-binary.mjs';

const electronPkgPath = path.join(projectRoot, 'node_modules', 'electron', 'package.json');
const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;

// install-app-deps executes the Electron binary. In CPU-restricted environments
// (sandbox, some VMs) the official Linux binary can hit SIGILL during probe.
// Skip rebuild when explicitly requested.
if (process.env.MESHTASTIC_SKIP_ELECTRON_REBUILD === '1') {
  console.warn(
    'MESHTASTIC_SKIP_ELECTRON_REBUILD=1 — skipping native rebuild. ' +
      '@stoprocent/noble may not match Electron until you run: pnpm run postinstall',
  );
  process.exit(0);
}

try {
  ensureElectronBinaryInstalled({
    root: projectRoot,
    spawnSyncFn: spawnSync,
    fileExists: fs.existsSync,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (process.platform === 'linux') {
  const electronBin = resolveLocalElectronBin(process.platform, fs.existsSync, projectRoot);
  if (fs.existsSync(electronBin)) {
    const probe = spawnSync(electronBin, ['--version'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (probe.signal === 'SIGILL') {
      console.error(
        'Electron binary exited with SIGILL (illegal instruction). Common in sandboxes or CPUs without instructions the prebuilt binary expects.',
      );
      console.error(
        'To finish pnpm install without running Electron: MESHTASTIC_SKIP_ELECTRON_REBUILD=1 pnpm install',
      );
      console.error(
        'Then run pnpm install on a full Linux host where electron --version succeeds.',
      );
      process.exit(1);
    }
  }
}

console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

// Invoke install-app-deps via node so we never need shell: true (Node DEP0190).
const installAppDepsJs = path.join(
  projectRoot,
  'node_modules',
  'electron-builder',
  'install-app-deps.js',
);
if (!fs.existsSync(installAppDepsJs)) {
  console.error('electron-builder install-app-deps not found; run pnpm install first.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [installAppDepsJs], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('Rebuild complete.');
