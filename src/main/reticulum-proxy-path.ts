/** Allowed Reticulum sidecar HTTP paths for renderer IPC proxy. */
const RETICULUM_PROXY_PATH_PREFIX = '/api/v1/';

/**
 * Validates a sidecar proxy path before forwarding to localhost.
 * Failure point: malformed or traversal paths from a compromised renderer.
 * Fallback: reject with Error (caller surfaces to UI).
 */
export function assertReticulumProxyPath(apiPath: string): string {
  const trimmed = apiPath.trim();
  if (!trimmed) {
    throw new Error('Reticulum proxy path is required');
  }
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!normalized.startsWith(RETICULUM_PROXY_PATH_PREFIX)) {
    throw new Error(`Reticulum proxy path must start with ${RETICULUM_PROXY_PATH_PREFIX}`);
  }
  if (normalized.includes('..') || normalized.includes('\\')) {
    throw new Error('Reticulum proxy path contains invalid segments');
  }
  return normalized;
}
