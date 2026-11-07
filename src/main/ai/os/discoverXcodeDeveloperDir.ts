import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Same discovery rules as `scripts/lib/discover-xcode-developer-dir.mjs` (keep in sync). */

export type XcodeDiscoveryClass = 'ready' | 'xcodeNotFound' | 'xcodeIncomplete';

/**
 * Locate an Xcode `Contents/Developer` directory.
 * Does not read or change the global `xcode-select` path.
 *
 * Modern Xcode may serve `metal` only via `xcrun` / MobileAsset cryptex — there is often
 * **no** `usr/bin/metal` stub under Developer. Metal readiness is probed separately with
 * `xcrun -sdk macosx metal`.
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
    if (existsSync(developer)) return developer;
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
