/** Soft callsign normalize + stable node-id hash for MeshCom (no hard ITU reject). */

/** Wire length for callsign+SSID (hyphen included); EXTUDP `dst` is tighter (1–9). */
export const MESHCOM_CALLSIGN_MAX_LEN = 11;
export const MESHCOM_EXTUDP_DST_MAX_LEN = 9;

/** Permissive soft-warn pattern — does not block Save/Send. */
export const MESHCOM_CALLSIGN_SOFT_PATTERN = /^[A-Z0-9]{1,7}-[0-9]{1,2}$/;

/**
 * Uppercase, trim, collapse leading SSID zero (`OE1KFR-02` → `OE1KFR-2`),
 * and clamp to wire length. Empty input stays empty.
 */
export function normalizeMeshcomCallsign(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return '';

  const hyphen = trimmed.lastIndexOf('-');
  let normalized: string;
  if (hyphen >= 0) {
    const base = trimmed.slice(0, hyphen).replace(/[^A-Z0-9]/g, '');
    const ssidRaw = trimmed.slice(hyphen + 1).replace(/[^0-9]/g, '');
    const ssid = ssidRaw.replace(/^0+(?=\d)/, '') || (ssidRaw.length > 0 ? '0' : '');
    normalized = ssid ? `${base}-${ssid}` : base;
  } else {
    normalized = trimmed.replace(/[^A-Z0-9]/g, '');
  }

  if (normalized.length > MESHCOM_CALLSIGN_MAX_LEN) {
    return normalized.slice(0, MESHCOM_CALLSIGN_MAX_LEN);
  }
  return normalized;
}

/** True when the normalized callsign fails the soft pattern (warn only). */
export function meshcomCallsignSoftWarn(callsign: string): boolean {
  const normalized = normalizeMeshcomCallsign(callsign);
  if (!normalized) return true;
  return !MESHCOM_CALLSIGN_SOFT_PATTERN.test(normalized);
}

/**
 * Stable uint32 hash of a normalized callsign (store key; callsign remains source of truth).
 * Avoids 0 (often used as unset / broadcast sentinel).
 */
export function callsignToNodeId(callsign: string): number {
  const key = normalizeMeshcomCallsign(callsign);
  if (!key) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

export interface MeshcomPathParse {
  /** First callsign in a comma-separated digipeater path. */
  origin: string;
  /** Remaining digipeater hops (already normalized). */
  digis: string[];
  /** Hop count derived from digi path length (origin excluded). */
  hopCount: number;
}

/** Parse EXTUDP / on-air `src` path (`CALL` or `CALL,DIGI1,DIGI2`). */
export function parseMeshcomSrcPath(src: string): MeshcomPathParse {
  const parts = src
    .split(',')
    .map((p) => normalizeMeshcomCallsign(p))
    .filter(Boolean);
  if (parts.length === 0) {
    return { origin: '', digis: [], hopCount: 0 };
  }
  const [origin, ...digis] = parts;
  return { origin, digis, hopCount: digis.length };
}
