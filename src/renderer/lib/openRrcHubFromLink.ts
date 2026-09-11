import { type ParsedRrcLink, parseRrcLinkUrl } from './rrcLink';

export const OPEN_RRC_HUB_EVENT = 'mesh-client:openRrcHub';

export type OpenRrcHubDetail = ParsedRrcLink;

/** Latest micron/deep-link open — survives until RrcPanel mounts and takes it. */
let pendingHubOpen: ParsedRrcLink | null = null;

/** Pending room join requested by an RRC link (consumed by RrcPanel when hub is live). */
let pendingLinkJoin: { hubHash: string; room: string } | null = null;

export function setPendingRrcLinkJoin(hubHash: string, room: string | null | undefined): void {
  const hub = hubHash.trim().toLowerCase();
  const roomNorm = room?.trim().replace(/^#+/, '').toLowerCase() || null;
  pendingLinkJoin = hub && roomNorm ? { hubHash: hub, room: roomNorm } : null;
}

/** Return and clear a pending join when it targets `hubHash`. */
export function consumePendingRrcLinkJoin(hubHash: string | null | undefined): string | null {
  const hub = hubHash?.trim().toLowerCase();
  if (!hub || pendingLinkJoin?.hubHash !== hub) return null;
  const room = pendingLinkJoin.room;
  pendingLinkJoin = null;
  return room;
}

export function peekPendingRrcLinkJoin(): { hubHash: string; room: string } | null {
  return pendingLinkJoin;
}

/** Take a pending hub open (event may have fired before RrcPanel mounted). */
export function takePendingRrcHubOpen(): ParsedRrcLink | null {
  const next = pendingHubOpen;
  pendingHubOpen = null;
  return next;
}

/**
 * Ask the app shell to switch to the RRC tab and open/join a hub from a micron link.
 * `App.tsx` owns tab switching; `RrcPanel` owns connect + optional room join.
 */
export function openRrcHubFromLink(url: string): boolean {
  const parsed = parseRrcLinkUrl(url);
  if (!parsed) return false;
  pendingHubOpen = parsed;
  setPendingRrcLinkJoin(parsed.hubHash, parsed.room);
  window.dispatchEvent(
    new CustomEvent<OpenRrcHubDetail>(OPEN_RRC_HUB_EVENT, {
      detail: parsed,
    }),
  );
  return true;
}
