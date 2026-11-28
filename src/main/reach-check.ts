import http from 'node:http';
import https from 'node:https';

import {
  normalizeReachCheckOrigin,
  REACH_CHECK_CHANNEL_HASH_PATTERN,
  REACH_CHECK_CHANNEL_NAME_PATTERN,
  REACH_CHECK_CODE_PATTERN,
  REACH_CHECK_SESSION_ID_PATTERN,
  REACH_CHECK_SHARE_PATH_PATTERN,
  type ReachCheckApi,
  type ReachCheckResult,
  type ReachCheckServerInfo,
  type ReachCheckSession,
  type ReachCheckStatus,
} from '../shared/reachCheck';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../shared/timeConstants';
import { pinnedLookup, resolvePublicAddress } from './public-address';
import { sanitizeLogMessage } from './sanitize-log-message';

const REQUEST_TIMEOUT_MS = 10 * MS_PER_SECOND;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_EXPIRY_AHEAD_MS = 30 * MS_PER_MINUTE;
const MAX_COUNT = 999;
const MAX_TEXT_LENGTH = 32;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const STATUSES: ReadonlySet<string> = new Set(['waiting', 'active', 'exhausted', 'expired']);
const NOT_PUBLIC_MESSAGE = 'Reach check servers must be on the public internet.';

/**
 * Sanitized error text for soft-catch debug logs. Catches log with `console.debug` directly, not
 * `logCaughtDebug`: that module pulls in the crash dialog and log service, which must not be
 * bundled a second time into the sibling `reach-check-handlers.js`.
 */
export function errorText(e: unknown): string {
  return sanitizeLogMessage(e instanceof Error ? e.message : String(e));
}

/** DNS resolved the server to a private, loopback or otherwise non-public address. */
export class ReachCheckNotPublicError extends Error {}

export interface ReachCheckHttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  /** Parsed JSON body, or `undefined` when the body was empty or not JSON. */
  json: unknown;
}

export type ReachCheckTransport = (
  url: URL,
  init: { method: 'GET' | 'POST'; body?: string },
) => Promise<ReachCheckHttpResponse>;

export interface ReachCheckClientDeps {
  request: ReachCheckTransport;
  allowLocal: boolean;
  now: () => number;
}

/** Local test servers are for unpackaged development builds only (`MESH_CLIENT_REACH_CHECK_LOCAL=1`). */
export function isLocalReachCheckAllowed(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return !isPackaged && env.MESH_CLIENT_REACH_CHECK_LOCAL === '1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function clampCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(value)));
}

function errorField(json: unknown): string {
  return isRecord(json) && typeof json.error === 'string' ? json.error : '';
}

function parseServerInfo(json: unknown, origin: string): ReachCheckResult<ReachCheckServerInfo> {
  if (!isRecord(json) || !isRecord(json.testChannel)) {
    return { ok: false, error: 'invalid_response' };
  }
  const channel = json.testChannel;
  if (channel.configured !== true || typeof channel.hash !== 'string' || channel.hash === '') {
    return { ok: false, error: 'not_configured' };
  }
  if (
    typeof channel.name !== 'string' ||
    !REACH_CHECK_CHANNEL_NAME_PATTERN.test(channel.name) ||
    !REACH_CHECK_CHANNEL_HASH_PATTERN.test(channel.hash)
  ) {
    return { ok: false, error: 'invalid_response' };
  }
  const turnstile = isRecord(json.turnstile) ? json.turnstile : {};
  const site = isRecord(json.site) ? json.site : {};
  return {
    ok: true,
    value: {
      origin,
      channelName: channel.name,
      channelHash: channel.hash,
      turnstileRequired: turnstile.enabled === true && turnstile.verified !== true,
      version: cleanText(site.version),
    },
  };
}

function parseSession(json: unknown, now: number): ReachCheckSession | null {
  if (!isRecord(json)) return null;
  const { id, code, sharePath, expiresAt, status } = json;
  if (
    typeof id !== 'string' ||
    !REACH_CHECK_SESSION_ID_PATTERN.test(id) ||
    typeof code !== 'string' ||
    !REACH_CHECK_CODE_PATTERN.test(code) ||
    typeof sharePath !== 'string' ||
    !REACH_CHECK_SHARE_PATH_PATTERN.test(sharePath) ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return {
    id,
    code,
    status:
      typeof status === 'string' && STATUSES.has(status) ? (status as ReachCheckStatus) : 'expired',
    expiresAt: Math.min(expiresAt, now + MAX_EXPIRY_AHEAD_MS),
    observedCount: clampCount(json.observedCount),
    expectedCount: clampCount(json.expectedCount),
    repeaterCount: clampCount(json.repeaterCount),
    distanceText: cleanText(json.longestPacketDistanceText),
    sharePath,
  };
}

function retryAfterSeconds(response: ReachCheckHttpResponse): number | undefined {
  const header = response.headers['retry-after'];
  let seconds: number | undefined;
  if (header && /^[0-9]{1,9}$/.test(header.trim())) {
    seconds = Number(header.trim());
  } else if (isRecord(response.json) && typeof response.json.retryAfter === 'number') {
    seconds = response.json.retryAfter;
  }
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
}

function sessionResult(
  response: ReachCheckHttpResponse,
  now: number,
): ReachCheckResult<ReachCheckSession> {
  const session = parseSession(response.json, now);
  return session ? { ok: true, value: session } : { ok: false, error: 'invalid_response' };
}

export function createReachCheckClient(deps: ReachCheckClientDeps): ReachCheckApi {
  async function send(
    rawOrigin: string,
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<ReachCheckResult<{ origin: string; response: ReachCheckHttpResponse }>> {
    const parsed = normalizeReachCheckOrigin(rawOrigin, { allowLocal: deps.allowLocal });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    try {
      const response = await deps.request(new URL(path, parsed.origin), init);
      return { ok: true, value: { origin: parsed.origin, response } };
    } catch (e: unknown) {
      console.debug('[main/reach-check] request failed: %s', errorText(e));
      return { ok: false, error: e instanceof ReachCheckNotPublicError ? 'not_public' : 'network' };
    }
  }

  return {
    async bootstrap(rawOrigin) {
      const sent = await send(rawOrigin, '/api/bootstrap', { method: 'GET' });
      if (!sent.ok) return sent;
      const { origin, response } = sent.value;
      if (response.status !== 200) {
        return { ok: false, error: 'http_error', httpStatus: response.status };
      }
      return parseServerInfo(response.json, origin);
    },

    async createSession(rawOrigin) {
      const sent = await send(rawOrigin, '/api/sessions', { method: 'POST', body: '{}' });
      if (!sent.ok) return sent;
      const { response } = sent.value;
      if (response.status === 200 || response.status === 201) {
        return sessionResult(response, deps.now());
      }
      const error = errorField(response.json);
      if (response.status === 403 && error === 'turnstile_required') {
        return { ok: false, error: 'turnstile_required' };
      }
      if (response.status === 429) {
        const seconds = retryAfterSeconds(response);
        return seconds === undefined
          ? { ok: false, error: 'rate_limited' }
          : { ok: false, error: 'rate_limited', retryAfterSeconds: seconds };
      }
      if (response.status === 400 && error === 'no_observers_in_geographic_scope') {
        return { ok: false, error: 'no_observers' };
      }
      return { ok: false, error: 'http_error', httpStatus: response.status };
    },

    async getSession(rawOrigin, id) {
      if (!REACH_CHECK_SESSION_ID_PATTERN.test(id)) return { ok: false, error: 'invalid_response' };
      const sent = await send(rawOrigin, `/api/sessions/${encodeURIComponent(id)}`, {
        method: 'GET',
      });
      if (!sent.ok) return sent;
      const { response } = sent.value;
      if (response.status === 200) return sessionResult(response, deps.now());
      if (response.status === 404) return { ok: false, error: 'session_not_found' };
      return { ok: false, error: 'http_error', httpStatus: response.status };
    },
  };
}

function readJsonResponse(
  response: http.IncomingMessage,
  resolve: (value: ReachCheckHttpResponse) => void,
  reject: (reason: Error) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) {
      response.destroy(new Error('Reach check answer exceeded the size limit.'));
      return;
    }
    chunks.push(chunk);
  });
  response.on('error', reject);
  response.on('end', () => {
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(response.headers)) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
    let json: unknown;
    const text = Buffer.concat(chunks).toString('utf8');
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch (e: unknown) {
        console.debug('[main/reach-check] answer is not JSON: %s', errorText(e));
        json = undefined;
      }
    }
    resolve({ status: response.statusCode ?? 0, headers, json });
  });
}

/**
 * Real transport: HTTPS to the DNS-checked public address (pinned, so a second answer cannot
 * rebind), 10 s timeout, 256 KiB cap, redirects not followed. Plain HTTP is only reachable for an
 * origin `normalizeReachCheckOrigin` accepted with `allowLocal`.
 */
export const defaultReachCheckTransport: ReachCheckTransport = async (url, init) => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(init.body));
  }
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (url.protocol === 'http:') {
    return new Promise<ReachCheckHttpResponse>((resolve, reject) => {
      const request = http.request(url, { method: init.method, headers, signal }, (response) => {
        readJsonResponse(response, resolve, reject);
      });
      request.on('error', reject);
      request.end(init.body);
    });
  }
  let address;
  try {
    address = await resolvePublicAddress(url.hostname, {
      timeout: 'Reach check server DNS lookup timed out.',
      notPublic: NOT_PUBLIC_MESSAGE,
    });
  } catch (e: unknown) {
    console.debug('[main/reach-check] DNS check failed: %s', errorText(e));
    // Only a non-public answer is "not public"; timeouts and unknown hosts stay network errors.
    if (e instanceof Error && e.message === NOT_PUBLIC_MESSAGE) {
      throw new ReachCheckNotPublicError(NOT_PUBLIC_MESSAGE);
    }
    throw e;
  }
  return new Promise<ReachCheckHttpResponse>((resolve, reject) => {
    const request = https.request(
      url,
      { method: init.method, headers, signal, lookup: pinnedLookup(address) },
      (response) => {
        readJsonResponse(response, resolve, reject);
      },
    );
    request.on('error', reject);
    request.end(init.body);
  });
};
