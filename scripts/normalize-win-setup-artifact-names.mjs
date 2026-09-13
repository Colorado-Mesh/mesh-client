#!/usr/bin/env node
/**
 * Hyphenate spaced NSIS Setup installer basenames so disk names match latest.yml
 * and survive GitHub's space-to-dot rewrite on upload.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeWinSetupInstallerNames } from './win-setup-installer-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} argv
 * @returns {{ rootDir: string }}
 */
export function parseNormalizeWinSetupArgs(argv) {
  let rootDir = path.join(ROOT, 'release');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const next = argv[++i];
      if (!next) throw new Error('--root requires a directory');
      rootDir = path.resolve(next);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { rootDir };
}

function main() {
  const { rootDir } = parseNormalizeWinSetupArgs(process.argv.slice(2));
  const { renamed } = normalizeWinSetupInstallerNames(rootDir);
  if (renamed.length === 0) {
    console.debug('[normalize-win-setup-artifact-names] no spaced Setup installers');
    return;
  }
  console.debug(`[normalize-win-setup-artifact-names] renamed ${renamed.length} file(s)`);
  for (const row of renamed) {
    console.debug(`  ${path.basename(row.from)} → ${path.basename(row.to)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
