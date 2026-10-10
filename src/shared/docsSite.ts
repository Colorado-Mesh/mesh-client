import type { MeshProtocol } from './meshProtocol';

/** Published MkDocs site (built from `docs/` by `.github/workflows/docs.yml`). */
export const DOCS_SITE_URL = 'https://charlottemeshtastic.github.io/mesh-client/';

/**
 * URL of a page on the docs site. `page` is the `docs/<page>.md` basename without
 * the extension; `anchor` is the GitHub-style heading slug (without `#`).
 */
export function docsSitePageUrl(page: string, anchor?: string): string {
  const base = page === '' || page === 'index' ? DOCS_SITE_URL : `${DOCS_SITE_URL}${page}/`;
  return anchor ? `${base}#${anchor}` : base;
}

/** Troubleshooting page for each protocol tab's Connection panel "Docs" link. */
export const TROUBLESHOOTING_PAGE_BY_PROTOCOL: Readonly<Record<MeshProtocol, string>> = {
  meshtastic: 'troubleshooting',
  meshcore: 'troubleshooting-meshcore',
};

export function troubleshootingDocsUrl(protocol: MeshProtocol): string {
  return docsSitePageUrl(TROUBLESHOOTING_PAGE_BY_PROTOCOL[protocol]);
}

export const DIAGNOSTICS_DOCS_URL = docsSitePageUrl('diagnostics');
