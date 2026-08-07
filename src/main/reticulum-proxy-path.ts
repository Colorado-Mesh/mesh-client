import { RETICULUM_LXMF_RECENT_API_PATH } from '../shared/reticulumApiPaths';
import { nomadPageProxyTimeoutMsFromApiPath } from '../shared/reticulumNomadTimeouts';

/** Allowed Reticulum sidecar HTTP paths for renderer IPC proxy. */
const RETICULUM_PROXY_PATH_PREFIX = '/api/v1/';

/** Destructive system route — only via dedicated factoryReset IPC. */
export const RETICULUM_FACTORY_RESET_PATH = '/api/v1/system/factory-reset';

export const RETICULUM_PROXY_GET_TIMEOUT_MS = 10_000;

/** Routes that query the live RNS transport (path table, interface stats). */
export const RETICULUM_TRANSPORT_QUERY_GET_TIMEOUT_MS = 30_000;

const TRANSPORT_QUERY_GET_PATHS = [
  '/api/v1/peers',
  '/api/v1/interfaces',
  '/api/v1/topology',
  '/api/v1/packets',
  RETICULUM_LXMF_RECENT_API_PATH,
] as const;

function isReticulumTransportQueryGetPath(normalized: string): boolean {
  return TRANSPORT_QUERY_GET_PATHS.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

const proxyGetTimeoutCache = new Map<string, number>();

function computeReticulumProxyGetTimeoutMs(apiPath: string): number {
  const trimmed = apiPath.trim();
  const pathOnly = trimmed.split('?')[0] ?? trimmed;
  const normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  if (
    normalized.includes('/api/v1/nomadnetwork/page/') ||
    normalized.includes('/api/v1/nomadnetwork/file/')
  ) {
    return nomadPageProxyTimeoutMsFromApiPath(trimmed);
  }
  if (normalized === '/api/v1/rrc/status' || normalized === '/api/v1/rrc/rooms') {
    return RETICULUM_TRANSPORT_QUERY_GET_TIMEOUT_MS;
  }
  if (isReticulumTransportQueryGetPath(normalized)) {
    return RETICULUM_TRANSPORT_QUERY_GET_TIMEOUT_MS;
  }
  return RETICULUM_PROXY_GET_TIMEOUT_MS;
}

export function reticulumProxyGetTimeoutMs(apiPath: string): number {
  const cached = proxyGetTimeoutCache.get(apiPath);
  if (cached !== undefined) return cached;
  const timeout = computeReticulumProxyGetTimeoutMs(apiPath);
  proxyGetTimeoutCache.set(apiPath, timeout);
  return timeout;
}

/**
 * Validates a sidecar proxy path before forwarding to localhost.
 * Failure point: malformed or traversal paths from a compromised renderer.
 * Fallback: reject with Error (caller surfaces to UI).
 */
export function assertReticulumProxyPath(
  apiPath: string,
  opts?: { allowFactoryReset?: boolean },
): string {
  const trimmed = apiPath.trim();
  if (!trimmed) {
    throw new Error('Reticulum proxy path is required');
  }
  if (trimmed.length > 2048) {
    throw new Error('Reticulum proxy path is too long');
  }
  const withoutFragment = trimmed.split('#')[0] ?? trimmed;
  const pathOnly = withoutFragment.split('?')[0] ?? withoutFragment;
  let normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    throw new Error('Reticulum proxy path contains invalid encoding');
  }
  if (!normalized.startsWith(RETICULUM_PROXY_PATH_PREFIX)) {
    throw new Error(`Reticulum proxy path must start with ${RETICULUM_PROXY_PATH_PREFIX}`);
  }
  if (normalized.includes('..') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error('Reticulum proxy path contains invalid segments');
  }
  // Destructive system routes must use dedicated IPC (confirmation + audit), not the generic proxy.
  if (normalized === RETICULUM_FACTORY_RESET_PATH && !opts?.allowFactoryReset) {
    throw new Error(
      'Reticulum factory reset requires electronAPI.reticulum.factoryReset (not generic proxy)',
    );
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
