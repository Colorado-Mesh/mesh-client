/**
 * Meshtastic mesh.proto `Data.emoji` is a boolean stored as fixed32: non-zero means the UTF-8 `payload`
 * is a reaction glyph (tapback). Official clients use `1`; the scalar codepoint belongs in `payload`, not here.
 */
export const MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG = 1;

/** Coerce protobuf fixed32 / JSON wire values to uint32; returns undefined for 0 / null / non-finite. */
export function meshtasticWireUint32NonZero(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const u = n >>> 0;
  return u === 0 ? undefined : u;
}

/** Coerce mesh packet id (uint32); preserves 0 as a valid value (protobuf may use 0 for unset / no-ack). */
export function meshtasticWireUint32AllowZero(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n >>> 0;
}

/**
 * Clamp Meshtastic / DB reaction emoji fields to a valid Unicode scalar (not surrogate, not > U+10FFFF).
 * Returns undefined for out-of-range or non-finite values (callers typically omit the field or store null).
 */
export function sanitizeUnicodeReactionScalar(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  const t = Math.trunc(n);
  if (t < 1 || t > 0x10ffff) return undefined;
  if (t >= 0xd800 && t <= 0xdfff) return undefined;
  return t;
}
