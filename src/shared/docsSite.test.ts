// @vitest-environment node
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { docsSitePageToRepoPath } from './docLinks';
import {
  CHAT_DOCS_URL,
  DIAGNOSTICS_DOCS_URL,
  DOCS_SITE_URL,
  docsSitePageUrl,
  FIRMWARE_DOCS_URL,
  MAPS_DOCS_URL,
  MESHCORE_DOCS_URL,
  MESHTASTIC_DOCS_URL,
  SETTINGS_DOCS_URL,
  TAK_DOCS_URL,
  TROUBLESHOOTING_PAGE_BY_PROTOCOL,
  troubleshootingDocsUrl,
} from './docsSite';
import { REGISTERED_MESH_PROTOCOLS } from './meshProtocol';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const NEW_USER_GUIDE_URLS: readonly (readonly [string, string])[] = [
  ['chat', CHAT_DOCS_URL],
  ['maps', MAPS_DOCS_URL],
  ['tak', TAK_DOCS_URL],
  ['firmware', FIRMWARE_DOCS_URL],
  ['meshtastic', MESHTASTIC_DOCS_URL],
  ['meshcore', MESHCORE_DOCS_URL],
  ['settings', SETTINGS_DOCS_URL],
];

describe('docsSitePageUrl', () => {
  it('builds MkDocs directory URLs with optional anchors', () => {
    expect(docsSitePageUrl('index')).toBe(DOCS_SITE_URL);
    expect(docsSitePageUrl('diagnostics')).toBe(
      'https://colorado-mesh.github.io/mesh-client/diagnostics/',
    );
    expect(docsSitePageUrl('troubleshooting', 'reporting-bugs')).toBe(
      'https://colorado-mesh.github.io/mesh-client/troubleshooting/#reporting-bugs',
    );
    expect(DIAGNOSTICS_DOCS_URL).toBe(docsSitePageUrl('diagnostics'));
  });

  it.each(NEW_USER_GUIDE_URLS)('%s docs URL maps to an existing page file', (page, url) => {
    expect(url).toBe(docsSitePageUrl(page));
    expect(existsSync(join(repoRoot, docsSitePageToRepoPath(page)))).toBe(true);
  });
});

describe('troubleshootingDocsUrl', () => {
  it.each(REGISTERED_MESH_PROTOCOLS)('%s links to an existing troubleshooting page', (protocol) => {
    const page = TROUBLESHOOTING_PAGE_BY_PROTOCOL[protocol];
    expect(troubleshootingDocsUrl(protocol)).toBe(`${DOCS_SITE_URL}${page}/`);
    expect(existsSync(join(repoRoot, docsSitePageToRepoPath(page)))).toBe(true);
  });
});
