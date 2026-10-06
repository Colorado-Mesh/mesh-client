import type { IpcMain } from 'electron';
import { app, net, shell } from 'electron';

import { decodeGithubApiBody } from '../../shared/fetchGithubReleases';
import { isNetworkClassFailure } from '../../shared/networkFailure';
import {
  matchesServiceAnnouncementAppVersion,
  parseHttpsUrl,
  parseServiceAnnouncementFeedText,
  SERVICE_ANNOUNCEMENT_FEED_URL,
  SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES,
  type ServiceAnnouncement,
  type ServiceAnnouncementFetchResult,
} from '../../shared/serviceAnnouncementFeed';
import { SERVICE_ANNOUNCEMENT_FETCH_TIMEOUT_MS } from '../../shared/timeConstants';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

const LOG_TAG = '[serviceAnnouncements]';
const ETAG_MAX = 256;
const MAX_LOGGED_REJECTIONS = 5;
const TRUSTED_FEED_HOST = 'raw.githubusercontent.com';

/** Final response URL, or the request URL when the runtime left `Response.url` empty. */
function isTrustedFeedResponse(responseUrl: string, requestUrl: string): boolean {
  const candidate = responseUrl.trim() !== '' ? responseUrl : requestUrl;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // catch-no-log-ok invalid URL is rejected by the caller
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === TRUSTED_FEED_HOST;
}

export interface ServiceAnnouncementFetcherDeps {
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
  appVersion?: () => string;
  feedUrl?: string;
}

export interface ServiceAnnouncementFetcher {
  /** Total: resolves to a result for every feed/network state, never rejects. */
  check(): Promise<ServiceAnnouncementFetchResult>;
  /** True when `href` is an announcement link from the last validated feed. */
  isKnownUrl(href: string): boolean;
}

function errText(e: unknown): string {
  return sanitizeLogMessage(e instanceof Error ? e.message : String(e));
}

function failure(e: unknown, stage: string): ServiceAnnouncementFetchResult {
  if (isNetworkClassFailure(e)) {
    console.debug(`${LOG_TAG} offline / network skip (${stage}): ${errText(e)}`);
    return { status: 'offline' };
  }
  console.warn(`${LOG_TAG} ${stage} failed: ${errText(e)}`);
  return { status: 'error' };
}

export function createServiceAnnouncementFetcher(
  deps: ServiceAnnouncementFetcherDeps = {},
): ServiceAnnouncementFetcher {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isOnline = deps.isOnline ?? (() => net.isOnline());
  const appVersion = deps.appVersion ?? (() => app.getVersion());
  const feedUrl = deps.feedUrl ?? SERVICE_ANNOUNCEMENT_FEED_URL;

  // Cache and ETag move together so a 304 always has a list to return.
  let cache: { etag: string | null; announcements: ServiceAnnouncement[] } | null = null;
  let knownUrls = new Set<string>();
  let inFlight: Promise<ServiceAnnouncementFetchResult> | null = null;

  const accept = (
    announcements: ServiceAnnouncement[],
    etag: string | null,
  ): ServiceAnnouncementFetchResult => {
    cache = { etag, announcements };
    knownUrls = new Set(announcements.flatMap((a) => (a.url ? [a.url] : [])));
    return { status: 'ok', announcements };
  };

  const run = async (): Promise<ServiceAnnouncementFetchResult> => {
    if (!isOnline()) {
      console.debug(`${LOG_TAG} offline / network skip: net.isOnline()===false`);
      return { status: 'offline' };
    }

    const headers: Record<string, string> = {
      'User-Agent': `mesh-client/${appVersion()}`,
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
    };
    if (cache?.etag) headers['If-None-Match'] = cache.etag;

    let res: Response;
    try {
      res = await fetchImpl(feedUrl, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(SERVICE_ANNOUNCEMENT_FETCH_TIMEOUT_MS),
      });
    } catch (e: unknown) {
      // catch-no-log-ok failure() logs debug/warn
      return failure(e, 'fetch');
    }

    if (!isTrustedFeedResponse(res.url, feedUrl)) {
      console.warn(`${LOG_TAG} ignored feed response from an untrusted URL`);
      return { status: 'error' };
    }

    if (res.status === 304) {
      if (cache) return { status: 'ok', announcements: cache.announcements };
      console.warn(`${LOG_TAG} 304 without a cached feed`);
      return { status: 'error' };
    }
    if (res.status === 404) {
      console.debug(`${LOG_TAG} feed not found (404); treating as no announcements`);
      return accept([], null);
    }
    if (!res.ok) {
      console.warn(`${LOG_TAG} feed responded with HTTP ${String(res.status)}`);
      return { status: 'error' };
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES) {
      console.warn(`${LOG_TAG} feed too large (${String(declared)} bytes)`);
      return { status: 'error' };
    }

    let text: string;
    try {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES) {
        console.warn(`${LOG_TAG} feed too large (${String(bytes.byteLength)} bytes)`);
        return { status: 'error' };
      }
      text = await decodeGithubApiBody(bytes, {
        maxOutputBytes: SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES,
      });
    } catch (e: unknown) {
      // catch-no-log-ok failure() logs debug/warn
      return failure(e, 'read body');
    }

    const parsed = parseServiceAnnouncementFeedText(text);
    if (!parsed.ok) {
      console.warn(`${LOG_TAG} feed ignored: ${sanitizeLogMessage(parsed.reason)}`);
      return { status: 'error' };
    }
    if (parsed.rejected.length > 0) {
      const detail = parsed.rejected
        .slice(0, MAX_LOGGED_REJECTIONS)
        .map((r) => `#${String(r.index)} ${r.reason}`)
        .join('; ');
      console.warn(
        `${LOG_TAG} skipped ${String(parsed.rejected.length)} invalid row(s): ${sanitizeLogMessage(detail)}`,
      );
    }

    const version = appVersion();
    const etagHeader = res.headers.get('etag');
    const etag = etagHeader && etagHeader.length <= ETAG_MAX ? etagHeader : null;
    return accept(
      parsed.announcements.filter((a) => matchesServiceAnnouncementAppVersion(a, version)),
      etag,
    );
  };

  return {
    check() {
      inFlight ??= run()
        .catch((e: unknown) => failure(e, 'check'))
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    isKnownUrl(href) {
      return knownUrls.has(href);
    },
  };
}

export interface ServiceAnnouncementIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  fetcher?: ServiceAnnouncementFetcher;
  openExternal?: (url: string) => Promise<void>;
}

/** Register `serviceAnnouncements:*` handlers. Call once at module load, not per window. */
export function registerServiceAnnouncementIpcHandlers({
  ipcMain,
  fetcher = createServiceAnnouncementFetcher(),
  openExternal = (url) => shell.openExternal(url),
}: ServiceAnnouncementIpcDeps): void {
  ipcMain.handle('serviceAnnouncements:fetch', async (event) => {
    assertIpcSender(event, 'serviceAnnouncements:fetch');
    return fetcher.check();
  });

  ipcMain.handle('serviceAnnouncements:open-url', async (event, url: unknown) => {
    assertIpcSender(event, 'serviceAnnouncements:open-url');
    const href = parseHttpsUrl(url);
    if (!href || !fetcher.isKnownUrl(href)) {
      console.warn(`${LOG_TAG} open-url rejected (not an https link from the feed)`);
      return false;
    }
    try {
      await openExternal(href);
      return true;
    } catch (e: unknown) {
      console.warn(`${LOG_TAG} open-url failed: ${errText(e)}`);
      return false;
    }
  });
}
