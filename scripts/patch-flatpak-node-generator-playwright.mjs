#!/usr/bin/env node
/**
 * Skip Playwright browser vendoring in the pinned flatpak-node-generator.
 *
 * Failure point: generator fetches
 * https://github.com/microsoft/playwright/raw/vX/packages/playwright-core/browsers.json
 * which GitHub now 404s. Flatpak does not run Electron E2E; .npmrc sets
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1. Playwright npm tarballs still go into the
 * offline store.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyGeneratorSkipElectronArmv7l,
  applyGeneratorSkipPlaywrightSpecialSources,
  resolveFlatpakNodeGeneratorBin,
  resolveGeneratorElectronPyPath,
  resolveGeneratorSpecialPyPath,
} from './flatpakPnpmStoreVersion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveGeneratorBin() {
  return resolveFlatpakNodeGeneratorBin({
    root: ROOT,
    env: process.env,
    which: () => {
      const result = spawnSync('which', ['flatpak-node-generator'], { encoding: 'utf8' });
      if (result.status !== 0) return null;
      const bin = result.stdout.trim().split('\n')[0];
      return bin || null;
    },
  });
}

function main() {
  const bin = resolveGeneratorBin();
  if (!bin) {
    console.error(
      'patch-flatpak-node-generator-playwright: flatpak-node-generator not found on PATH',
    );
    process.exit(1);
  }
  const specialPy = resolveGeneratorSpecialPyPath(bin);
  const electronPy = resolveGeneratorElectronPyPath(bin);
  if (!specialPy) {
    console.error(`patch-flatpak-node-generator-playwright: special.py not found next to ${bin}`);
    process.exit(1);
  }
  if (!electronPy) {
    console.error(`patch-flatpak-node-generator-playwright: electron.py not found next to ${bin}`);
    process.exit(1);
  }

  const playwright = applyGeneratorSkipPlaywrightSpecialSources(specialPy);
  if (!playwright.ok) {
    console.error(`patch-flatpak-node-generator-playwright: ${playwright.message}`);
    process.exit(1);
  }
  console.info(
    playwright.already
      ? `patch-flatpak-node-generator-playwright: already applied (${specialPy})`
      : `patch-flatpak-node-generator-playwright: skipped Playwright browser vendoring (${specialPy})`,
  );
  const armv7l = applyGeneratorSkipElectronArmv7l(electronPy);
  if (!armv7l.ok) {
    console.error(`patch-flatpak-node-generator-playwright: ${armv7l.message}`);
    process.exit(1);
  }
  console.info(
    armv7l.already
      ? `patch-flatpak-node-generator-playwright: Electron armv7l skip already applied (${electronPy})`
      : `patch-flatpak-node-generator-playwright: skipped Electron >=44 linux-armv7l (${electronPy})`,
  );
}

main();
