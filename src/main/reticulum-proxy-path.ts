import { isGamesApiPath } from '../shared/games-types';
import { isVoiceMemoApiPath } from '../shared/reticulum-voice-memo-types';
import { RETICULUM_LXMF_RECENT_API_PATH } from '../shared/reticulumApiPaths';
import { nomadPageProxyTimeoutMsFromApiPath } from '../shared/reticulumNomadTimeouts';
import { VOICE_AUDIO_API_PATH } from '../shared/voice-types';
import { isNomadContentSourceApiPath } from './reticulum-config-paths';
import { isRncpPickerGatedApiPath } from './reticulum-remote-paths';

/** Allowed Reticulum sidecar HTTP paths for renderer IPC proxy. */
const RETICULUM_PROXY_PATH_PREFIX = '/api/v1/';
const RETICULUM_INTERNAL_PATH_PREFIX = '/api/v1/internal/';

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
    normalized.includes('/api/v1/nomadnetwork/file/') ||
    normalized.includes('/api/v1/nomadnetwork/media/')
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

export interface ReticulumProxyPathOptions {
  allowFactoryReset?: boolean;
  /** Dedicated voice, games, RNCP, and Nomad handlers already authorized the route. */
  allowDedicatedRoutes?: boolean;
}

/**
 * Decode once, drop the fragment, and separate the query.
 * Denylists see the path with the query and trailing slash removed.
 * The query is kept so Nomad page and games session fetches still forward it.
 */
function splitReticulumProxyPath(apiPath: string): { path: string; query: string } {
  const trimmed = apiPath.trim();
  if (!trimmed) {
    throw new Error('Reticulum proxy path is required');
  }
  if (trimmed.length > 2048) {
    throw new Error('Reticulum proxy path is too long');
  }
  const withoutFragment = trimmed.split('#')[0] ?? trimmed;
  const queryAt = withoutFragment.indexOf('?');
  const rawPath = queryAt === -1 ? withoutFragment : withoutFragment.slice(0, queryAt);
  let query = queryAt === -1 ? '' : withoutFragment.slice(queryAt);
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  try {
    path = decodeURIComponent(path);
  } catch {
    throw new Error('Reticulum proxy path contains invalid encoding');
  }
  const decodedHash = path.indexOf('#');
  if (decodedHash !== -1) path = path.slice(0, decodedHash);
  const decodedQuery = path.indexOf('?');
  if (decodedQuery !== -1) {
    if (!query) query = path.slice(decodedQuery);
    path = path.slice(0, decodedQuery);
  }
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return { path, query };
}

function assertDedicatedProxyRoute(path: string): void {
  if (path === VOICE_AUDIO_API_PATH) {
    throw new Error('voice PCM ingest requires reticulum:voiceSendAudio');
  }
  if (isVoiceMemoApiPath(path)) {
    throw new Error('voice memo requires reticulum:voiceMemo* IPC channels');
  }
  if (isGamesApiPath(path)) {
    throw new Error('LRGP games require reticulum:games* IPC channels');
  }
  if (isRncpPickerGatedApiPath(path)) {
    throw new Error(
      'rncp send/fetch/listener changes require reticulum:rncpSend/rncpFetch/setRncpListener (picker-backed)',
    );
  }
  if (isNomadContentSourceApiPath(path)) {
    throw new Error(
      'Nomad content-source changes require reticulum:setNomadContentSource (picker-backed)',
    );
  }
}

/**
 * Validates a sidecar proxy path before forwarding to localhost.
 * Failure point: malformed, traversal, or denylisted paths from a compromised renderer.
 * Fallback: reject with Error (caller surfaces to UI).
 * Returns the decoded path plus the original query.
 */
export function assertReticulumProxyPath(
  apiPath: string,
  opts?: ReticulumProxyPathOptions,
): string {
  const { path, query } = splitReticulumProxyPath(apiPath);
  if (!path.startsWith(RETICULUM_PROXY_PATH_PREFIX)) {
    throw new Error(`Reticulum proxy path must start with ${RETICULUM_PROXY_PATH_PREFIX}`);
  }
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) {
    throw new Error('Reticulum proxy path contains invalid segments');
  }
  if (
    path === RETICULUM_INTERNAL_PATH_PREFIX.slice(0, -1) ||
    path.startsWith(RETICULUM_INTERNAL_PATH_PREFIX)
  ) {
    throw new Error('Reticulum internal routes are unavailable through the generic proxy');
  }
  // Destructive system routes must use dedicated IPC (confirmation + audit), not the generic proxy.
  if (path === RETICULUM_FACTORY_RESET_PATH && !opts?.allowFactoryReset) {
    throw new Error(
      'Reticulum factory reset requires electronAPI.reticulum.factoryReset (not generic proxy)',
    );
  }
  if (!opts?.allowDedicatedRoutes) assertDedicatedProxyRoute(path);
  return `${path}${query}`;
}
