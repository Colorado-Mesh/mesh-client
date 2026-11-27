import { isValidIpLiteral } from './ipLiteral';

/**
 * MeshCore reach check: a client for community "Mesh Health Check" servers
 * (github.com/yellowcooln/meshcore-health-check and forks). The server hands out a short code,
 * watches its configured test channel over MQTT observers, and counts which observers heard it.
 */

export type ReachCheckErrorCode =
  | 'invalid_url'
  | 'not_public'
  | 'network'
  | 'http_error'
  | 'turnstile_required'
  | 'rate_limited'
  | 'not_configured'
  | 'no_observers'
  | 'invalid_response'
  | 'session_not_found';

export interface ReachCheckServerInfo {
  /** Normalized origin the answer came from (`https://host`). */
  origin: string;
  /** Test channel name as the server reports it (lower case, no leading `#`). */
  channelName: string;
  /** First byte of SHA-256 of the channel key, two lower-case hex digits. */
  channelHash: string;
  /** The server wants a browser check (Cloudflare Turnstile) before it gives out codes. */
  turnstileRequired: boolean;
  version: string;
}

export type ReachCheckStatus = 'waiting' | 'active' | 'exhausted' | 'expired';

export interface ReachCheckSession {
  id: string;
  code: string;
  status: ReachCheckStatus;
  expiresAt: number;
  observedCount: number;
  expectedCount: number;
  repeaterCount: number;
  distanceText: string;
  /** `/share/<id>`; open it as the configured origin plus this path. */
  sharePath: string;
}

export type ReachCheckResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ReachCheckErrorCode; retryAfterSeconds?: number; httpStatus?: number };

export interface ReachCheckApi {
  bootstrap(origin: string): Promise<ReachCheckResult<ReachCheckServerInfo>>;
  createSession(origin: string): Promise<ReachCheckResult<ReachCheckSession>>;
  getSession(origin: string, id: string): Promise<ReachCheckResult<ReachCheckSession>>;
}

/** Server-sent values are checked against these before they are transmitted, stored or opened. */
export const REACH_CHECK_CODE_PATTERN = /^[A-Z0-9]{1,8}-[0-9A-F]{6,16}$/;
export const REACH_CHECK_CHANNEL_NAME_PATTERN = /^[a-z0-9_-]{1,30}$/;
export const REACH_CHECK_CHANNEL_HASH_PATTERN = /^[0-9a-f]{2}$/;
export const REACH_CHECK_SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
export const REACH_CHECK_SHARE_PATH_PATTERN = /^\/share\/[A-Za-z0-9-]{1,64}$/;

const URL_MAX_LENGTH = 2048;
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

export type ReachCheckOriginResult =
  { ok: true; origin: string } | { ok: false; error: 'invalid_url' | 'not_public' };

/**
 * Reduces a typed server address to its origin. Only public `https:` hosts on the default port are
 * accepted; `allowLocal` additionally admits `http://127.0.0.1:<port>` and `http://localhost:<port>`
 * (unpackaged development builds only). DNS answers are checked separately in main.
 */
export function normalizeReachCheckOrigin(
  raw: string,
  opts: { allowLocal: boolean },
): ReachCheckOriginResult {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > URL_MAX_LENGTH) return { ok: false, error: 'invalid_url' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // catch-no-log-ok shared validator: an unparsable address is an expected user input result
    return { ok: false, error: 'invalid_url' };
  }
  if (url.username || url.password) return { ok: false, error: 'invalid_url' };
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    if (opts.allowLocal && LOCAL_HOSTNAMES.has(host) && url.port) {
      return { ok: true, origin: url.origin };
    }
    return { ok: false, error: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'invalid_url' };
  if (url.port && url.port !== '443') return { ok: false, error: 'invalid_url' };
  if (
    !host.includes('.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isValidIpLiteral(host)
  ) {
    return { ok: false, error: 'not_public' };
  }
  return { ok: true, origin: url.origin };
}
