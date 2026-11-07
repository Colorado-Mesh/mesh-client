import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Locate an Xcode Developer directory that includes the Metal toolchain.
 * Does not read or change the global `xcode-select` path (CLT-only selects miss `metal`).
 *
 * @param {string} [applicationsDir='/Applications']
 * @returns {string | null} Absolute `…/Contents/Developer` path, or null.
 */
export function discoverXcodeDeveloperDir(applicationsDir = '/Applications') {
  const candidates = [];
  const primary = path.join(applicationsDir, 'Xcode.app', 'Contents', 'Developer');
  if (existsSync(primary)) candidates.push(primary);
  try {
    for (const entry of readdirSync(applicationsDir)) {
      if (!/^Xcode.*\.app$/i.test(entry) || entry === 'Xcode.app') continue;
      candidates.push(path.join(applicationsDir, entry, 'Contents', 'Developer'));
    }
  } catch {
    // catch-no-op Applications may be unreadable in sandboxed tests
  }
  for (const developer of candidates) {
    if (!existsSync(developer)) continue;
    const metal = path.join(developer, 'usr', 'bin', 'metal');
    if (existsSync(metal)) return developer;
  }
  return null;
}

/**
 * @param {string} [applicationsDir]
 * @returns {'ready' | 'xcodeNotFound' | 'xcodeIncomplete'}
 */
export function classifyXcodeDeveloperDir(applicationsDir = '/Applications') {
  const primaryApp = path.join(applicationsDir, 'Xcode.app');
  const alt =
    existsSync(applicationsDir) &&
    readdirSync(applicationsDir).some((entry) => /^Xcode.*\.app$/i.test(entry));
  if (!existsSync(primaryApp) && !alt) return 'xcodeNotFound';
  return discoverXcodeDeveloperDir(applicationsDir) ? 'ready' : 'xcodeIncomplete';
}
