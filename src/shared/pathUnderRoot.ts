/**
 * Path containment helpers for Electron main / shared scanners.
 *
 * Prefer these over raw `path.join` / `path.resolve` whenever any segment may
 * come from IPC, zip entries, filenames, or other external input. The join
 * itself is the Semgrep-sensitive sink; validation + post-resolve containment
 * are the actual security boundary.
 */
import path from 'node:path';

export class PathEscapesRootError extends Error {
  readonly code = 'PATH_ESCAPES_ROOT' as const;

  constructor(message = 'path escapes root directory') {
    super(message);
    this.name = 'PathEscapesRootError';
  }
}

function resolvePair(root: string, candidate: string): { rootResolved: string; resolved: string } {
  // Resolve is the containment primitive; call sites must not path.resolve user input alone.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(candidate);
  return { rootResolved, resolved };
}

/** True when `candidate` is `root` or a descendant (after resolve). */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const { rootResolved, resolved } = resolvePair(root, candidate);
  return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
}

/** Resolve `candidate` and throw when it escapes `root`. */
export function assertPathInsideRoot(root: string, candidate: string): string {
  const { rootResolved, resolved } = resolvePair(root, candidate);
  return assertResolvedInsideRoot(rootResolved, resolved);
}

/**
 * Reject a single path component that could escape or confuse joins.
 * Allows normal filenames; rejects empty, `.`, `..`, separators, and NUL.
 */
export function assertSafePathSegment(segment: string): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new PathEscapesRootError('path segment must be a non-empty string');
  }
  if (segment.includes('\0')) {
    throw new PathEscapesRootError('path segment contains NUL');
  }
  if (segment === '.' || segment === '..') {
    throw new PathEscapesRootError('path segment must not be . or ..');
  }
  if (segment.includes('/') || segment.includes('\\')) {
    throw new PathEscapesRootError('path segment must not contain separators');
  }
  if (path.isAbsolute(segment) || /^[a-zA-Z]:[\\/]/.test(segment)) {
    throw new PathEscapesRootError('path segment must not be absolute');
  }
  return segment;
}

function assertResolvedInsideRoot(rootResolved: string, candidate: string): string {
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${path.sep}`)) {
    throw new PathEscapesRootError();
  }
  return candidate;
}

/**
 * Join one or more single-component segments under `root` and assert the
 * result stays inside the resolved root.
 */
export function joinUnderRoot(root: string, ...segments: string[]): string {
  if (segments.length === 0) {
    throw new PathEscapesRootError('joinUnderRoot requires at least one segment');
  }
  const safeSegments = segments.map(assertSafePathSegment);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // Containment is enforced immediately after resolve; segments are validated above.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const candidate = path.resolve(rootResolved, ...safeSegments);
  return assertResolvedInsideRoot(rootResolved, candidate);
}

/**
 * Resolve a relative path (may contain `/` or `\`) under `root`.
 * Rejects absolute inputs, NUL, and any `..` segment.
 */
export function resolveUnderRoot(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new PathEscapesRootError('relative path must be a non-empty string');
  }
  if (relativePath.includes('\0')) {
    throw new PathEscapesRootError('relative path contains NUL');
  }
  if (
    path.isAbsolute(relativePath) ||
    /^[a-zA-Z]:[\\/]/.test(relativePath) ||
    relativePath.startsWith('\\\\')
  ) {
    throw new PathEscapesRootError('absolute paths are not allowed');
  }
  const normalizedPosix = relativePath.replace(/\\/g, '/');
  const parts = normalizedPosix.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new PathEscapesRootError('relative path has no segments');
  }
  if (parts.some((part) => part === '..')) {
    throw new PathEscapesRootError('path traversal is not allowed');
  }
  // '.' components are skipped; remaining parts go through assertSafePathSegment.
  const safeParts = parts.filter((part) => part !== '.').map(assertSafePathSegment);
  if (safeParts.length === 0) {
    throw new PathEscapesRootError('relative path has no segments');
  }
  return joinUnderRoot(root, ...safeParts);
}
