/**
 * Path containment helpers for Node scripts.
 *
 * Prefer these over raw `path.join` / `path.resolve` whenever any segment may
 * come from zip entries, filenames, argv, or other external input.
 */
import path from 'node:path';

export class PathEscapesRootError extends Error {
  /** @readonly */
  code = 'PATH_ESCAPES_ROOT';

  /**
   * @param {string} [message]
   */
  constructor(message = 'path escapes root directory') {
    super(message);
    this.name = 'PathEscapesRootError';
  }
}

/**
 * @param {string} root
 * @param {string} candidate
 */
function resolvePair(root, candidate) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(candidate);
  return { rootResolved, resolved };
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
export function isPathInsideRoot(root, candidate) {
  const { rootResolved, resolved } = resolvePair(root, candidate);
  return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {string}
 */
export function assertPathInsideRoot(root, candidate) {
  const { rootResolved, resolved } = resolvePair(root, candidate);
  return assertResolvedInsideRoot(rootResolved, resolved);
}

/**
 * @param {string} segment
 * @returns {string}
 */
export function assertSafePathSegment(segment) {
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

/**
 * @param {string} rootResolved
 * @param {string} candidate
 * @returns {string}
 */
function assertResolvedInsideRoot(rootResolved, candidate) {
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${path.sep}`)) {
    throw new PathEscapesRootError();
  }
  return candidate;
}

/**
 * @param {string} root
 * @param {...string} segments
 * @returns {string}
 */
export function joinUnderRoot(root, ...segments) {
  if (segments.length === 0) {
    throw new PathEscapesRootError('joinUnderRoot requires at least one segment');
  }
  const safeSegments = segments.map(assertSafePathSegment);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootResolved = path.resolve(root);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const candidate = path.resolve(rootResolved, ...safeSegments);
  return assertResolvedInsideRoot(rootResolved, candidate);
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {string}
 */
export function resolveUnderRoot(root, relativePath) {
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
  const safeParts = parts.filter((part) => part !== '.').map(assertSafePathSegment);
  if (safeParts.length === 0) {
    throw new PathEscapesRootError('relative path has no segments');
  }
  return joinUnderRoot(root, ...safeParts);
}
