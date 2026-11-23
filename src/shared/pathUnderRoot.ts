/**
 * Path containment helpers for Electron main / shared scanners.
 *
 * Prefer these over raw `path.join` / `path.resolve` whenever any segment may
 * come from IPC, zip entries, filenames, or other external input. The join
 * itself is the Semgrep-sensitive sink; validation + post-resolve containment
 * are the actual security boundary.
 *
 * Kept compact: this module ships in the measured main `index.js` budget.
 */
import path from 'node:path';

const ERR = 'PATH_ESCAPES_ROOT';

export class PathEscapesRootError extends Error {
  constructor(message = ERR) {
    super(message);
    this.name = 'PathEscapesRootError';
  }
}

function fail(): never {
  throw new PathEscapesRootError();
}

/** Reject a single path component that could escape or confuse joins. */
export function assertSafePathSegment(segment: string): string {
  if (
    typeof segment !== 'string' ||
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('\0') ||
    segment.includes('/') ||
    segment.includes('\\') ||
    path.isAbsolute(segment) ||
    /^[a-zA-Z]:[\\/]/.test(segment)
  ) {
    fail();
  }
  return segment;
}

function assertInside(rootResolved: string, resolved: string): string {
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    fail();
  }
  return resolved;
}

/** True when `candidate` is `root` or a descendant (after resolve). */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(candidate);
  return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
}

/** Resolve `candidate` and throw when it escapes `root`. */
export function assertPathInsideRoot(root: string, candidate: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return assertInside(rootResolved, path.resolve(candidate));
}

/** Join one or more single-component segments under `root` (must stay inside). */
export function joinUnderRoot(root: string, ...segments: string[]): string {
  if (segments.length === 0) fail();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // Containment is enforced immediately after resolve; segments are validated above.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return assertInside(
    rootResolved,
    path.resolve(rootResolved, ...segments.map(assertSafePathSegment)),
  );
}

/**
 * Resolve a relative path (may contain `/` or `\`) under `root`.
 * Rejects absolute inputs, NUL, and any `..` segment.
 */
export function resolveUnderRoot(root: string, relativePath: string): string {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\0')
  ) {
    fail();
  }
  if (
    path.isAbsolute(relativePath) ||
    /^[a-zA-Z]:[\\/]/.test(relativePath) ||
    relativePath.startsWith('\\\\')
  ) {
    fail();
  }
  const parts = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.');
  if (parts.length === 0 || parts.includes('..')) fail();
  return joinUnderRoot(root, ...parts);
}
