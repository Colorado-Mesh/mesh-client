// @vitest-environment node
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { docsSitePageToRepoPath } from './docLinks';
import {
  DIAGNOSTICS_DOCS_URL,
  DOCS_SITE_URL,
  docsSitePageUrl,
  TROUBLESHOOTING_PAGE_BY_PROTOCOL,
  troubleshootingDocsUrl,
} from './docsSite';
import { REGISTERED_MESH_PROTOCOLS } from './meshProtocol';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('docsSitePageUrl', () => {
  it('builds MkDocs directory URLs with optional anchors', () => {
    expect(docsSitePageUrl('index')).toBe(DOCS_SITE_URL);
    expect(docsSitePageUrl('diagnostics')).toBe(
      'https://charlottemeshtastic.github.io/mesh-client/diagnostics/',
    );
    expect(docsSitePageUrl('troubleshooting', 'reporting-bugs')).toBe(
      'https://charlottemeshtastic.github.io/mesh-client/troubleshooting/#reporting-bugs',
    );
    expect(DIAGNOSTICS_DOCS_URL).toBe(docsSitePageUrl('diagnostics'));
  });
});

describe('troubleshootingDocsUrl', () => {
  it.each(REGISTERED_MESH_PROTOCOLS)('%s links to an existing troubleshooting page', (protocol) => {
    const page = TROUBLESHOOTING_PAGE_BY_PROTOCOL[protocol];
    expect(troubleshootingDocsUrl(protocol)).toBe(`${DOCS_SITE_URL}${page}/`);
    expect(existsSync(join(repoRoot, docsSitePageToRepoPath(page)))).toBe(true);
  });
});
