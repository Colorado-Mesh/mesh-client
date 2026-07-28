import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a filesystem path to its canonical realpath, walking up parents when
 * the leaf (or intermediate) path does not exist yet (e.g. a fetch save target
 * under a picked directory). Returns null when no existing ancestor can be resolved.
 */
export function canonicalizePath(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    // catch-no-log-ok: missing path — walk ancestors
  }

  const suffix: string[] = [];
  let current = resolved;
  for (;;) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) return null;
    try {
      const realParent = fs.realpathSync.native(parent);
      return path.join(realParent, ...suffix);
    } catch {
      // catch-no-log-ok: keep walking toward filesystem root
      current = parent;
    }
  }
}

/** True when `candidate` is exactly `allowed` after both are canonicalized. */
export function isSameCanonicalPath(
  candidate: string | null | undefined,
  allowed: string | null | undefined,
): boolean {
  if (candidate == null || candidate.trim() === '' || allowed == null) return false;
  const a = canonicalizePath(candidate);
  const b = canonicalizePath(allowed);
  if (a == null || b == null) return false;
  return a === b;
}

/**
 * True when `candidate` is `allowedRoot` or a path nested under it after
 * canonicalization (rejects symlink escapes outside the root).
 */
export function isUnderCanonicalRoot(
  candidate: string | null | undefined,
  allowedRoot: string | null | undefined,
): boolean {
  if (candidate == null || candidate.trim() === '' || allowedRoot == null) return false;
  const root = canonicalizePath(allowedRoot);
  const target = canonicalizePath(candidate);
  if (root == null || target == null) return false;
  return target === root || target.startsWith(`${root}${path.sep}`);
}
