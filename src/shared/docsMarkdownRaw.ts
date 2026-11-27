import { TROUBLESHOOTING_PAGE_BY_PROTOCOL } from './docsSite';
import type { MeshProtocol } from './meshProtocol';

/** Repo that publishes the MkDocs site — raw markdown for AI log grounding. */
export const DOCS_MARKDOWN_RAW_BASE =
  'https://raw.githubusercontent.com/Colorado-Mesh/mesh-client/main/docs';

/** Allowlisted raw markdown URL for a `docs/<page>.md` basename (no extension). */
export function docsMarkdownRawUrl(page: string): string {
  // Only path-safe basenames; callers must pass known TROUBLESHOOTING / log-analysis pages.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(page)) {
    throw new Error('Invalid docs page id');
  }
  return `${DOCS_MARKDOWN_RAW_BASE}/${page}.md`;
}

export function troubleshootingMarkdownRawUrl(protocol: MeshProtocol): string {
  return docsMarkdownRawUrl(TROUBLESHOOTING_PAGE_BY_PROTOCOL[protocol]);
}

const LOG_ANALYSIS_DOCS_PAGE = 'log-analysis';
export const LOG_ANALYSIS_MARKDOWN_RAW_URL = docsMarkdownRawUrl(LOG_ANALYSIS_DOCS_PAGE);
