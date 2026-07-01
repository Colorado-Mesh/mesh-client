import { nomadPageProxyTimeoutMsFromApiPath } from '../shared/reticulumNomadTimeouts';

/** Allowed Reticulum sidecar HTTP paths for renderer IPC proxy. */
const RETICULUM_PROXY_PATH_PREFIX = '/api/v1/';

export const RETICULUM_PROXY_GET_TIMEOUT_MS = 10_000;

export function reticulumProxyGetTimeoutMs(apiPath: string): number {
  const trimmed = apiPath.trim();
  const pathOnly = trimmed.split('?')[0] ?? trimmed;
  const normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  if (
    normalized.includes('/api/v1/nomadnetwork/page/') ||
    normalized.includes('/api/v1/nomadnetwork/file/')
  ) {
    return nomadPageProxyTimeoutMsFromApiPath(trimmed);
  }
  return RETICULUM_PROXY_GET_TIMEOUT_MS;
}

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
  const pathOnly = trimmed.split('?')[0] ?? trimmed;
  const normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  if (!normalized.startsWith(RETICULUM_PROXY_PATH_PREFIX)) {
    throw new Error(`Reticulum proxy path must start with ${RETICULUM_PROXY_PATH_PREFIX}`);
  }
  if (normalized.includes('..') || normalized.includes('\\')) {
    throw new Error('Reticulum proxy path contains invalid segments');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
