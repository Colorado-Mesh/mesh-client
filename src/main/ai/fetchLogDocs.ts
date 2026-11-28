import { net } from 'electron';

import { selectDocsExcerpts } from '../../shared/aiLogDocsSelect';
import {
  LOG_ANALYSIS_MARKDOWN_RAW_URL,
  troubleshootingMarkdownRawUrl,
} from '../../shared/docsMarkdownRaw';
import { troubleshootingDocsUrl } from '../../shared/docsSite';
import type { MeshProtocol } from '../../shared/meshProtocol';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import { sanitizeLogMessage } from '../sanitize-log-message';

const FETCH_TIMEOUT_MS = 15 * MS_PER_SECOND;
const CACHE_TTL_MS = 10 * 60 * MS_PER_SECOND;
const MAX_RAW_BYTES = 512_000;

const ALLOWED_RAW_HOST = 'raw.githubusercontent.com';
const ALLOWED_RAW_PREFIX = '/Colorado-Mesh/mesh-client/main/docs/';

interface CacheEntry {
  text: string;
  fetchedAt: number;
}

const pageCache = new Map<string, CacheEntry>();

export class LogDocsUnavailableError extends Error {
  constructor(message = 'docsUnavailable') {
    super(message);
    this.name = 'LogDocsUnavailableError';
  }
}

function assertAllowlistedRawUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LogDocsUnavailableError();
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_RAW_HOST) {
    throw new LogDocsUnavailableError();
  }
  if (!parsed.pathname.startsWith(ALLOWED_RAW_PREFIX) || !parsed.pathname.endsWith('.md')) {
    throw new LogDocsUnavailableError();
  }
  if (parsed.pathname.includes('..')) throw new LogDocsUnavailableError();
  return parsed;
}

async function fetchRawMarkdown(
  url: string,
  fetchImpl: typeof fetch,
  isOnline: () => boolean,
): Promise<string> {
  if (!isOnline()) throw new LogDocsUnavailableError();
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.text;
  assertAllowlistedRawUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1' },
    });
    if (!response.ok) throw new LogDocsUnavailableError();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_RAW_BYTES) {
      throw new LogDocsUnavailableError();
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    pageCache.set(url, { text, fetchedAt: Date.now() });
    return text;
  } catch (error: unknown) {
    if (error instanceof LogDocsUnavailableError) throw error;
    console.debug(
      '[main/ai/fetchLogDocs] fetch failed',
      sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
    );
    throw new LogDocsUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchLogDocsResult {
  docsText: string;
  docsUrl: string;
  truncated: boolean;
}

export interface FetchLogDocsDeps {
  fetch?: typeof fetch;
  isOnline?: () => boolean;
}

/**
 * Fetch allowlisted troubleshooting (+ log-analysis) markdown and select sections
 * that match finding hints under a UTF-8 byte budget.
 */
export async function fetchLogDocsForAnalysis(
  protocol: MeshProtocol,
  findingHints: string[],
  maxDocsBytes: number,
  deps: FetchLogDocsDeps = {},
): Promise<FetchLogDocsResult> {
  const fetchImpl =
    deps.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      net.fetch(typeof input === 'string' || input instanceof Request ? input : input.href, init));
  const isOnline = deps.isOnline ?? (() => net.isOnline());
  const troubleshootingUrl = troubleshootingMarkdownRawUrl(protocol);
  const publishedUrl = troubleshootingDocsUrl(protocol);

  const troubleshooting = await fetchRawMarkdown(troubleshootingUrl, fetchImpl, isOnline);
  let combined = troubleshooting;
  try {
    const logAnalysis = await fetchRawMarkdown(LOG_ANALYSIS_MARKDOWN_RAW_URL, fetchImpl, isOnline);
    combined = `${troubleshooting}\n\n${logAnalysis}`;
  } catch (error: unknown) {
    // log-analysis is optional enrichment; troubleshooting is required.
    if (!(error instanceof LogDocsUnavailableError)) {
      console.debug(
        '[main/ai/fetchLogDocs] optional log-analysis skipped',
        sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const selected = selectDocsExcerpts(combined, findingHints, maxDocsBytes);
  if (!selected.text.trim()) throw new LogDocsUnavailableError();
  return {
    docsText: selected.text,
    docsUrl: publishedUrl,
    truncated: selected.truncated,
  };
}

/** Test helper — clears the in-memory page cache. */
export function clearLogDocsCacheForTests(): void {
  pageCache.clear();
}
