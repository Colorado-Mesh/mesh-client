/**
 * Parse NomadNet-style RRC hub links (Browser.handle_rrc_link / expand_shorthands("rrc")).
 *
 * Accepted forms:
 * - `rrc://<hubHex>[:<destName>][/<room>]`
 * - `rrc@<hubHex>…` / `rrc.hub.session@<hubHex>…`
 */

const HUB_HASH_RE = /^[a-f0-9]{32}$/;

export interface ParsedRrcLink {
  hubHash: string;
  /** Optional destination/aspect name from `hex:name` (NomadNet find_hub hint). */
  destName: string | null;
  /** Room without leading `#`, lowercased when present. */
  room: string | null;
}

function stripRrcSchemePrefix(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('rrc://')) {
    return trimmed.slice('rrc://'.length);
  }
  if (lower.startsWith('rrc.hub.session@')) {
    return trimmed.slice('rrc.hub.session@'.length);
  }
  if (lower.startsWith('rrc@')) {
    return trimmed.slice('rrc@'.length);
  }
  // Micron may wrap shorthand as nomadnetwork://rrc@…
  if (lower.startsWith('nomadnetwork://')) {
    return stripRrcSchemePrefix(trimmed.slice('nomadnetwork://'.length));
  }
  return null;
}

/** True when the URL targets an RRC hub session (scheme or shorthand). */
export function isRrcLink(url: string): boolean {
  return stripRrcSchemePrefix(url) != null;
}

/**
 * Parse an RRC micron/chat link into hub hash + optional dest name + room.
 * Returns null when the payload is not an RRC link or the hub hash is invalid.
 */
export function parseRrcLinkUrl(url: string): ParsedRrcLink | null {
  const payload = stripRrcSchemePrefix(url);
  if (payload == null) return null;

  let rest = payload.trim();
  if (rest.startsWith('/')) rest = rest.slice(1);

  const slash = rest.indexOf('/');
  const hubPart = (slash >= 0 ? rest.slice(0, slash) : rest).trim();
  const roomRaw = slash >= 0 ? rest.slice(slash + 1).trim() : '';

  const colon = hubPart.indexOf(':');
  const hexPart = (colon >= 0 ? hubPart.slice(0, colon) : hubPart).trim().toLowerCase();
  const destName =
    colon >= 0
      ? hubPart
          .slice(colon + 1)
          .trim()
          .replace(/^\/+|\/+$/g, '') || null
      : null;

  const hubHash = hexPart;
  if (!HUB_HASH_RE.test(hubHash)) return null;

  const room = roomRaw.replace(/^#+/, '').trim();
  return {
    hubHash,
    destName,
    room: room ? room.toLowerCase() : null,
  };
}
