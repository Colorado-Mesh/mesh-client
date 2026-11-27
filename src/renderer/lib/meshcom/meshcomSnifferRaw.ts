import { MESHCOM_MAX_TEXT_LEN } from '@/shared/meshcomConstants';

/**
 * Cap retained MeshCom sniffer/capture bytes. Chat UI already clamps text to
 * {@link MESHCOM_MAX_TEXT_LEN}; without this, a ~128 KiB KISS UI `info` field would be
 * re-encoded into every ring entry (and live-map snapshots).
 */
export const MESHCOM_SNIFFER_RAW_MAX_BYTES = MESHCOM_MAX_TEXT_LEN;

/**
 * Truncate capture bytes for the sniffer ring / expand hex (identity only).
 * Uses {@link Uint8Array.slice} (copy) — not `subarray` — so the ring never retains a view
 * into a larger NET Console / TCP line buffer.
 */
export function clampMeshcomSnifferRaw(raw: Uint8Array): Uint8Array {
  if (raw.byteLength <= MESHCOM_SNIFFER_RAW_MAX_BYTES) return raw;
  return raw.slice(0, MESHCOM_SNIFFER_RAW_MAX_BYTES);
}

/** Compact KISS capture for the sniffer; never retains more than {@link MESHCOM_SNIFFER_RAW_MAX_BYTES}. */
export function meshcomKissFrameRawSnippet(frame: {
  src: string;
  dest: string;
  info: string;
}): Uint8Array {
  const info =
    frame.info.length > MESHCOM_MAX_TEXT_LEN
      ? frame.info.slice(0, MESHCOM_MAX_TEXT_LEN)
      : frame.info;
  return clampMeshcomSnifferRaw(new TextEncoder().encode(`${frame.src}>${frame.dest}:${info}`));
}
