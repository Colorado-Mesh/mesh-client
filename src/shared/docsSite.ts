import type { MeshProtocol } from './meshProtocol';

/** Published MkDocs site (built from `docs/` by `.github/workflows/docs.yml`). */
export const DOCS_SITE_URL = 'https://colorado-mesh.github.io/mesh-client/';

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
  reticulum: 'troubleshooting-reticulum',
};

export function troubleshootingDocsUrl(protocol: MeshProtocol): string {
  return docsSitePageUrl(TROUBLESHOOTING_PAGE_BY_PROTOCOL[protocol]);
}

export const DIAGNOSTICS_DOCS_URL = docsSitePageUrl('diagnostics');
export const CHAT_DOCS_URL = docsSitePageUrl('chat');
export const SCHEDULED_BROADCASTS_DOCS_URL = docsSitePageUrl('scheduled-broadcasts');
export const MAPS_DOCS_URL = docsSitePageUrl('maps');
export const TAK_DOCS_URL = docsSitePageUrl('tak');
export const FIRMWARE_DOCS_URL = docsSitePageUrl('firmware');
export const MESHTASTIC_DOCS_URL = docsSitePageUrl('meshtastic');
export const MESHCORE_DOCS_URL = docsSitePageUrl('meshcore');
/** MeshCore Rooms (BBS) section of the MeshCore user guide. */
export const MESHCORE_ROOMS_DOCS_URL = docsSitePageUrl('meshcore', 'rooms-bbs');
export const SETTINGS_DOCS_URL = docsSitePageUrl('settings');
/** Catch up / AI conversation summaries (User Guide). */
export const AI_CATCH_UP_DOCS_URL = docsSitePageUrl('ai-catch-up');
/** LetsMesh MQTT JWT / v1_ username auth (Engineering docs). */
export const LETSMESH_MQTT_AUTH_DOCS_URL = docsSitePageUrl('letsmesh-mqtt-auth');
