import { parseNomadNetworkLinkUrl } from './micronParser';

export const OPEN_NOMAD_PAGE_EVENT = 'mesh-client:openNomadPage';

export interface OpenNomadPageDetail {
  destinationHash: string;
  path: string;
}

/**
 * Ask the app shell to switch to the Nomad tab and browse a page address.
 * Caller does not need Nomad panel context; `App.tsx` owns tab + store wiring.
 */
export function openNomadPageFromLink(url: string): boolean {
  const parsed = parseNomadNetworkLinkUrl(url);
  if (!parsed?.destination_hash) return false;
  window.dispatchEvent(
    new CustomEvent<OpenNomadPageDetail>(OPEN_NOMAD_PAGE_EVENT, {
      detail: { destinationHash: parsed.destination_hash, path: parsed.path },
    }),
  );
  return true;
}
