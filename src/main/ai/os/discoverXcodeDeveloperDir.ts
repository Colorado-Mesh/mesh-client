import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Same discovery rules as `scripts/lib/discover-xcode-developer-dir.mjs` (keep in sync). */

export type XcodeDiscoveryClass = 'ready' | 'xcodeNotFound' | 'xcodeIncomplete';

/**
 * Locate an Xcode Developer directory that includes the Metal toolchain.
 * Does not read or change the global `xcode-select` path.
 */
export function discoverXcodeDeveloperDir(applicationsDir = '/Applications'): string | null {
  const candidates: string[] = [];
  const primary = path.join(applicationsDir, 'Xcode.app', 'Contents', 'Developer');
  if (existsSync(primary)) candidates.push(primary);
  try {
    for (const entry of readdirSync(applicationsDir)) {
      if (!/^Xcode.*\.app$/i.test(entry) || entry === 'Xcode.app') continue;
      candidates.push(path.join(applicationsDir, entry, 'Contents', 'Developer'));
    }
  } catch {
    // catch-no-log-ok Applications may be unreadable in tests
  }
  for (const developer of candidates) {
    if (!existsSync(developer)) continue;
    const metal = path.join(developer, 'usr', 'bin', 'metal');
    if (existsSync(metal)) return developer;
  }
  return null;
}

export function classifyXcodeDeveloperDir(applicationsDir = '/Applications'): XcodeDiscoveryClass {
  const primaryApp = path.join(applicationsDir, 'Xcode.app');
  let alt = false;
  try {
    alt =
      existsSync(applicationsDir) &&
      readdirSync(applicationsDir).some((entry) => /^Xcode.*\.app$/i.test(entry));
  } catch {
    // catch-no-log-ok
  }
  if (!existsSync(primaryApp) && !alt) return 'xcodeNotFound';
  return discoverXcodeDeveloperDir(applicationsDir) ? 'ready' : 'xcodeIncomplete';
}
